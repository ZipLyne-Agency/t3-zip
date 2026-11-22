import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  countThreadStatusFilters,
  matchesThreadStatusFilter,
  openThreadStatusFromRow,
  resolveDoneSection,
  threadStatusSinceMs,
  type DoneSection,
  type OpenThreadStatus,
  type ThreadStatusFilterCounts,
} from "@t3tools/client-runtime/state/thread-status-filter";
import type { EnvironmentId } from "@t3tools/contracts";
import { isThreadMuted } from "@t3tools/shared/threadMute";

import type {
  ThreadDoneClears,
  ThreadListStatusFilter,
} from "../../persistence/mobile-preferences";
import {
  getThreadListV2OrderedSection,
  resolveThreadListV2RowStatus,
  resolveThreadListV2WokeAt,
  threadHasUnseenCompletion,
  type ThreadListV2Item,
  type ThreadListV2ListItem,
} from "./threadListV2";

/**
 * The thread list's status filters, by the desktop thread column's rules: Needs You (waiting on
 * you, or failed) lists the longest waiting first, Working the latest started first, and Done
 * keeps a finished thread under New until it is opened and under Opened until it is cleared.
 */

export interface ThreadStatusEntry {
  readonly thread: EnvironmentThreadShell;
  readonly key: string;
  readonly pinned: boolean;
  readonly status: OpenThreadStatus;
  readonly doneSection: DoneSection | null;
  readonly sinceMs: number;
}

export function threadStatusKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return `${thread.environmentId}:${thread.id}`;
}

/**
 * The open threads in scope, as the All list partitions them: not archived, settled or
 * snoozed where the environment supports those, with each one's status and Done section.
 * Until this device has a `reviewSince`, nothing lists as Opened, so history does not flood in.
 */
export function buildThreadStatusEntries(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: string;
  readonly clears: ThreadDoneClears | null;
  readonly settlementEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys?: ReadonlySet<string>;
}): ThreadStatusEntry[] {
  const nowMs = Date.parse(input.now);
  const section = (name: "pinned" | "active") =>
    getThreadListV2OrderedSection({
      threads: input.threads,
      section: name,
      now: input.now,
      ...(input.settlementEnvironmentIds
        ? { settlementEnvironmentIds: input.settlementEnvironmentIds }
        : {}),
      ...(input.snoozeEnvironmentIds ? { snoozeEnvironmentIds: input.snoozeEnvironmentIds } : {}),
      ...(input.queuedThreadKeys ? { queuedThreadKeys: input.queuedThreadKeys } : {}),
    });
  const reviewSince = input.clears?.reviewSince ?? null;
  return [
    ...section("pinned").map((thread) => ({ thread, pinned: true })),
    ...section("active").map((thread) => ({ thread, pinned: false })),
  ].map(({ thread, pinned }) => {
    const key = threadStatusKey(thread);
    const muted = isThreadMuted(thread, nowMs);
    const status = openThreadStatusFromRow({
      rowStatus: resolveThreadListV2RowStatus(thread),
      muted,
      unseenCompletion: threadHasUnseenCompletion(thread),
      thread,
    });
    const doneSection =
      reviewSince === null && status !== "done"
        ? null
        : resolveDoneSection(status, muted, thread, input.clears?.clearedAt[key], reviewSince);
    return {
      thread,
      key,
      pinned,
      status,
      doneSection,
      sinceMs:
        doneSection !== null
          ? threadStatusSinceMs(thread, "done")
          : status === "idle"
            ? Date.parse(thread.updatedAt) || 0
            : threadStatusSinceMs(thread, status),
    };
  });
}

export function countThreadStatusEntries(
  entries: ReadonlyArray<ThreadStatusEntry>,
): ThreadStatusFilterCounts {
  return countThreadStatusFilters(entries);
}

function byKey(left: ThreadStatusEntry, right: ThreadStatusEntry): number {
  return left.key < right.key ? -1 : 1;
}

/**
 * One filter's rows. Needs You and Working are one list each; Done is New, then Opened, each
 * under its heading, the first heading carrying Clear All. Each row swipes to Clear in Done.
 */
export function buildThreadStatusListItems(input: {
  readonly entries: ReadonlyArray<ThreadStatusEntry>;
  readonly filter: Exclude<ThreadListStatusFilter, "all">;
  readonly now: string;
  readonly decorate: (items: ReadonlyArray<ThreadListV2Item>) => ThreadListV2ListItem[];
}): ThreadListV2ListItem[] {
  const listed = input.entries.filter((entry) => matchesThreadStatusFilter(entry, input.filter));
  const toItem = (entry: ThreadStatusEntry): ThreadListV2Item => ({
    thread: entry.thread,
    variant: "card",
    snoozed: false,
    pinned: entry.pinned,
    wokeAt: resolveThreadListV2WokeAt(entry.thread, { now: input.now }),
    isLast: false,
  });
  if (input.filter !== "done") {
    const sorted = [...listed].sort(
      input.filter === "waiting"
        ? (left, right) => left.sinceMs - right.sinceMs || byKey(left, right)
        : (left, right) => right.sinceMs - left.sinceMs || byKey(left, right),
    );
    return withDividers(input.decorate(markLast(sorted.map(toItem))));
  }
  const newestFirst = (left: ThreadStatusEntry, right: ThreadStatusEntry) =>
    right.sinceMs - left.sinceMs || byKey(left, right);
  const sections = (["new", "opened"] as const).flatMap((section) => {
    const items = listed.filter((entry) => entry.doneSection === section).sort(newestFirst);
    return items.length === 0 ? [] : [{ section, items }];
  });
  const result: ThreadListV2ListItem[] = [];
  sections.forEach(({ section, items }, index) => {
    result.push({
      type: "v2-status-section",
      key: `v2-status-section:${section}`,
      section,
      count: items.length,
      clearAllCount: index === 0 ? listed.length : 0,
    });
    const rows = input
      .decorate(markLast(items.map(toItem), index === sections.length - 1))
      .map((row) => (row.type === "v2-thread" ? { ...row, doneSection: section } : row));
    result.push(...rows);
  });
  return withDividers(result);
}

function markLast(items: ThreadListV2Item[], last = true): ThreadListV2Item[] {
  const final = items.at(-1);
  if (!last || final === undefined) return items;
  return [...items.slice(0, -1), { ...final, isLast: true }];
}

/** A row draws its divider only above another row, never above a heading. */
function withDividers(items: ThreadListV2ListItem[]): ThreadListV2ListItem[] {
  return items.map((entry, index) => {
    if (entry.type !== "v2-thread" && entry.type !== "v2-pending") return entry;
    const next = items[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}

/** The thread keys the Done filter lists, for Clear All. */
export function threadStatusDoneThreads(
  entries: ReadonlyArray<ThreadStatusEntry>,
): ReadonlyArray<ThreadStatusEntry> {
  return entries.filter((entry) => entry.doneSection !== null);
}

/** The most clear marks this device keeps; the oldest go first. */
const MAX_CLEAR_MARKS = 500;

export function pruneClearMarks(clearedAt: Record<string, string>): Record<string, string> {
  const entries = Object.entries(clearedAt);
  if (entries.length <= MAX_CLEAR_MARKS) return clearedAt;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => (left < right ? 1 : left > right ? -1 : 0))
      .slice(0, MAX_CLEAR_MARKS),
  );
}

/** Marks set by one clear, and the marks they replaced, for Undo. */
export function applyClearMarks(
  current: ThreadDoneClears,
  keys: readonly string[],
  clearedAt: string,
): ThreadDoneClears {
  const next = { ...current.clearedAt };
  for (const key of keys) next[key] = clearedAt;
  return { ...current, clearedAt: pruneClearMarks(next) };
}

/** Undo puts back a mark only while it is still the one this clear set. */
export function restoreClearMarks(
  current: ThreadDoneClears,
  previous: ReadonlyMap<string, string | undefined>,
  clearedAt: string,
): ThreadDoneClears {
  const next = { ...current.clearedAt };
  for (const [key, before] of previous) {
    if (next[key] !== clearedAt) continue;
    if (before === undefined) delete next[key];
    else next[key] = before;
  }
  return { ...current, clearedAt: next };
}
