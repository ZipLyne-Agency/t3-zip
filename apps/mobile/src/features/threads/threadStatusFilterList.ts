import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
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
import type { HomeProjectScope } from "../home/homeThreadList";
import { scopedProjectKey } from "../../lib/scopedEntities";
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
 * Working and Done share one tab only inside a single project. All Projects and No Project give
 * each its own tab, since across many threads one half of the screen is too short for either.
 */
export function combinesWorkingAndDone(
  scope: Pick<HomeProjectScope, "representative"> | null,
): boolean {
  return scope !== null && scope.representative.isScratch !== true;
}

/** The project a Done thread lists under when every project is shown. */
export interface ThreadStatusProjectGroup {
  readonly key: string;
  readonly title: string;
  readonly project: EnvironmentProject;
  readonly scratch: boolean;
}

/** Each project's group, by `environmentId:projectId`, from the scopes the project filter offers. */
export function buildThreadStatusProjectGroups(
  scopes: ReadonlyArray<HomeProjectScope>,
): ReadonlyMap<string, ThreadStatusProjectGroup> {
  const groups = new Map<string, ThreadStatusProjectGroup>();
  for (const scope of scopes) {
    const group = {
      key: scope.key,
      title: scope.title,
      project: scope.representative,
      scratch: scope.representative.isScratch === true,
    };
    for (const ref of scope.projectRefs) {
      groups.set(scopedProjectKey(ref.environmentId, ref.projectId), group);
    }
  }
  return groups;
}

/**
 * One filter's rows. Done is New, then Opened, the first heading carrying Clear All. With
 * `projectGroups` (every project shown) each heading splits by project as the desktop column
 * does: projects in the order of their newest thread, threads newest first.
 */
export function buildThreadStatusListItems(input: {
  readonly entries: ReadonlyArray<ThreadStatusEntry>;
  readonly filter: "waiting" | "working" | "done";
  readonly now: string;
  readonly decorate: (items: ReadonlyArray<ThreadListV2Item>) => ThreadListV2ListItem[];
  readonly projectGroups?: ReadonlyMap<string, ThreadStatusProjectGroup> | null;
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
  const projectGroups = input.projectGroups ?? null;
  const result: ThreadListV2ListItem[] = [];
  sections.forEach(({ section, items }, index) => {
    result.push({
      type: "v2-status-section",
      key: `v2-status-section:${section}`,
      section,
      count: items.length,
      clearAllCount: index === 0 ? listed.length : 0,
    });
    const lastSection = index === sections.length - 1;
    const pushRows = (entries: ReadonlyArray<ThreadStatusEntry>, last: boolean) => {
      const rows = input
        .decorate(markLast(entries.map(toItem), last))
        .map((row) => (row.type === "v2-thread" ? { ...row, doneSection: section } : row));
      result.push(...rows);
    };
    if (projectGroups === null) {
      pushRows(items, lastSection);
      return;
    }
    const byProject = groupByProject(items, projectGroups);
    byProject.forEach(({ key, group, entries }, groupIndex) => {
      result.push({
        type: "v2-status-project",
        key: `v2-status-project:${section}:${key}`,
        title: group?.title ?? null,
        project: group?.project ?? null,
        scratch: group?.scratch ?? false,
        count: entries.length,
      });
      pushRows(entries, lastSection && groupIndex === byProject.length - 1);
    });
  });
  return withDividers(result);
}

/**
 * A status tab's rows. Working leads with the tasks about to run. The combined tab, shown for
 * one project, keeps Done and Working as two lists, Done first, and lists both in `items`.
 */
export function buildThreadStatusFilterRows(input: {
  readonly entries: ReadonlyArray<ThreadStatusEntry>;
  readonly filter: Exclude<ThreadListStatusFilter, "all">;
  readonly now: string;
  readonly decorate: (items: ReadonlyArray<ThreadListV2Item>) => ThreadListV2ListItem[];
  readonly projectGroups: ReadonlyMap<string, ThreadStatusProjectGroup> | null;
  readonly pendingRows: () => ThreadListV2ListItem[];
}): {
  readonly items: ThreadListV2ListItem[];
  readonly split: {
    readonly done: ThreadListV2ListItem[];
    readonly working: ThreadListV2ListItem[];
  } | null;
} {
  const rowsFor = (filter: "waiting" | "working" | "done") => {
    const rows = buildThreadStatusListItems({ ...input, filter });
    return filter === "working" ? [...input.pendingRows(), ...rows] : rows;
  };
  if (input.filter !== "workingDone") return { items: rowsFor(input.filter), split: null };
  const split = { done: rowsFor("done"), working: rowsFor("working") };
  return { items: [...split.done, ...split.working], split };
}

const UNKNOWN_PROJECT_KEY = "unknown";

/** Projects in the order of their first thread here, each keeping its threads' order. */
function groupByProject(
  entries: ReadonlyArray<ThreadStatusEntry>,
  projectGroups: ReadonlyMap<string, ThreadStatusProjectGroup>,
) {
  const groups = new Map<
    string,
    { key: string; group: ThreadStatusProjectGroup | null; entries: ThreadStatusEntry[] }
  >();
  for (const entry of entries) {
    const group =
      projectGroups.get(scopedProjectKey(entry.thread.environmentId, entry.thread.projectId)) ??
      null;
    const key = group?.key ?? UNKNOWN_PROJECT_KEY;
    const existing = groups.get(key);
    if (existing) existing.entries.push(entry);
    else groups.set(key, { key, group, entries: [entry] });
  }
  return [...groups.values()];
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
