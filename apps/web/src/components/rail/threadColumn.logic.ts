import {
  countThreadStatusFilters,
  matchesThreadStatusFilter,
  normalizeThreadStatusFilter,
  type ThreadStatusFilter,
  type ThreadStatusFilterCounts,
} from "@t3tools/client-runtime/state/thread-status-filter";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import type { DoneSection, OpenThreadStatus } from "./railStatus.logic";
import {
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
} from "../threadSidebarWidth";

/** The thread column's width. The rail and the chat keep their own minimums beside it. */
export const THREAD_COLUMN_WIDTH = 19 * 16;
/** The folded rail's width, `--sidebar-width-icon` in the Project Rail layout. */
const FOLDED_RAIL_WIDTH = 4 * 16;

/** What the thread column lists: every project, or one project by its rail key. */
export const ALL_PROJECTS_SCOPE = "all";

/** A project the person picked in the rail, kept until the open thread changes. */
export interface ThreadColumnScopeChoice {
  readonly scope: string;
  /** The open thread or draft when the choice was made; null on a page with neither. */
  readonly madeUnder: string | null;
}

/**
 * The column's scope. It follows the open thread's project, so tabs, links and shortcuts
 * bring the column along. A project picked in the rail holds until the open thread changes,
 * and a thread opened from the column keeps the column where it was (the caller re-records
 * the choice under the new thread). A project that no longer exists falls back to every project.
 */
export function resolveThreadColumnScope(input: {
  readonly choice: ThreadColumnScopeChoice | null;
  readonly routeKey: string | null;
  readonly routeProjectKey: string | null;
  readonly knownScopes: ReadonlySet<string>;
}): string {
  const { choice } = input;
  const scope =
    choice !== null && choice.madeUnder === input.routeKey
      ? choice.scope
      : (input.routeProjectKey ?? choice?.scope ?? ALL_PROJECTS_SCOPE);
  return scope === ALL_PROJECTS_SCOPE || input.knownScopes.has(scope) ? scope : ALL_PROJECTS_SCOPE;
}

/**
 * Whether the column fits: the rail at its narrowest (or folded), the column, and the chat at
 * its minimum. A window narrower than that keeps the rail alone, as before the column existed.
 */
export function threadColumnFits(viewportWidth: number, railFolded: boolean): boolean {
  const rail = railFolded ? FOLDED_RAIL_WIDTH : resolveThreadSidebarMinimumWidth(0);
  return viewportWidth >= rail + THREAD_COLUMN_WIDTH + THREAD_MAIN_CONTENT_MIN_WIDTH;
}

export interface ThreadColumnItem {
  readonly key: string;
  readonly kind: "thread" | "draft";
  readonly status: OpenThreadStatus;
  readonly pinned: boolean;
  /** When the thread last changed. */
  readonly updatedMs: number;
  /** When it started waiting, started running or finished; the update time otherwise. */
  readonly sinceMs: number;
  /** A sent thread with unsent text in its composer. It also lists under Drafts. */
  readonly hasDraft: boolean;
  /** Where Done lists it: New (not opened yet), Opened (not cleared yet), or not at all. */
  readonly doneSection: DoneSection | null;
}

export type ThreadColumnSectionId =
  | "drafts"
  | "new"
  | "opened"
  | "needs"
  | "working"
  | "pinned"
  | "today"
  | "yesterday"
  | "earlier";

const SECTION_LABELS: Record<ThreadColumnSectionId, string> = {
  drafts: "Drafts",
  new: "New",
  opened: "Opened",
  needs: "Needs You",
  working: "Working",
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

export interface ThreadColumnSection<T> {
  readonly id: ThreadColumnSectionId;
  readonly label: string;
  readonly items: T[];
}

/** A filter one list shows; the combined Working and Done tab shows two, one per half. */
type ThreadColumnListFilter = Exclude<ThreadStatusFilter, "workingDone">;

export function countThreadColumnFilters(
  items: ReadonlyArray<Pick<ThreadColumnItem, "kind" | "status" | "doneSection">>,
): ThreadStatusFilterCounts {
  return countThreadStatusFilters(items.filter((item) => item.kind === "thread"));
}

/**
 * The filter the column shows. A filter belongs to the scope it was picked in; any other scope
 * opens on All, and All Projects, which has no All tab, on Waiting. The result is always a tab
 * the column shows: every scope combines Working and Done into one tab.
 */
export function resolveThreadColumnFilter(input: {
  readonly picked: { readonly scope: string; readonly filter: ThreadStatusFilter };
  readonly scope: string;
}): ThreadStatusFilter {
  const allScope = input.scope === ALL_PROJECTS_SCOPE;
  const picked = input.picked.scope === input.scope ? input.picked.filter : "all";
  const filter = allScope && picked === "all" ? "waiting" : picked;
  return normalizeThreadStatusFilter(filter, true);
}

function startOfLocalDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * Sections in reading order: drafts, needs you, working, pinned, then by day. Needs You lists
 * the longest waiting first, Working the latest started first, and the rest the newest. Drafts (new threads and threads
 * with unsent text, listed only there) show under every filter. Empty
 * sections are left out.
 */
export function buildThreadColumnSections<T extends ThreadColumnItem>(
  items: readonly T[],
  filter: ThreadColumnListFilter,
  nowMs: number,
): ThreadColumnSection<T>[] {
  const today = startOfLocalDay(nowMs);
  const yesterday = startOfLocalDay(today - 1);
  const buckets: Record<ThreadColumnSectionId, T[]> = {
    drafts: [],
    new: [],
    opened: [],
    needs: [],
    working: [],
    pinned: [],
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const item of items) {
    // A thread with unsent text lists once, under Drafts, which every filter shows.
    if (item.kind === "draft" || item.hasDraft) {
      buckets.drafts.push(item);
      continue;
    }
    if (!matchesThreadStatusFilter(item, filter)) continue;
    // Done splits by whether you have opened the thread; the other lists sort by day.
    if (filter === "done") buckets[item.doneSection ?? "new"].push(item);
    else if (item.status === "needs" || item.status === "failed") buckets.needs.push(item);
    else if (item.status === "working") buckets.working.push(item);
    else if (item.pinned) buckets.pinned.push(item);
    else if (item.updatedMs >= today) buckets.today.push(item);
    else if (item.updatedMs >= yesterday) buckets.yesterday.push(item);
    else buckets.earlier.push(item);
  }
  const oldestFirst = (left: T, right: T) =>
    left.sinceMs - right.sinceMs || (left.key < right.key ? -1 : 1);
  // Working puts the run you started last on top, the agent you just messaged.
  const latestStartFirst = (left: T, right: T) =>
    right.sinceMs - left.sinceMs || (left.key < right.key ? -1 : 1);
  const newestFirst = (left: T, right: T) =>
    right.updatedMs - left.updatedMs || (left.key < right.key ? -1 : 1);
  return (Object.keys(buckets) as ThreadColumnSectionId[]).flatMap((id) => {
    const list = buckets[id];
    if (list.length === 0) return [];
    const sorted = list.toSorted(
      id === "needs" ? oldestFirst : id === "working" ? latestStartFirst : newestFirst,
    );
    return [{ id, label: SECTION_LABELS[id], items: sorted }];
  });
}

/**
 * The combined Working and Done tab: Done on top (New, then Opened), Working below. Drafts list
 * once, in the Working half after the running threads, since the half's own heading names them.
 */
export function buildWorkingDoneHalves<T extends ThreadColumnItem>(
  items: readonly T[],
  nowMs: number,
): { readonly done: ThreadColumnSection<T>[]; readonly working: ThreadColumnSection<T>[] } {
  const working = buildThreadColumnSections(items, "working", nowMs);
  return {
    done: buildThreadColumnSections(items, "done", nowMs).filter(({ id }) => id !== "drafts"),
    working: [
      ...working.filter(({ id }) => id !== "drafts"),
      ...working.filter(({ id }) => id === "drafts"),
    ],
  };
}

export interface ThreadColumnProjectGroup<T> {
  readonly projectKey: string;
  readonly items: T[];
}

/**
 * One section's items split by project, for the column when it lists every project. Projects
 * keep the order of their first item, so the project that has waited longest stays on top.
 */
export function groupThreadColumnItemsByProject<T extends { readonly projectKey: string }>(
  items: readonly T[],
): ThreadColumnProjectGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.projectKey);
    if (list) list.push(item);
    else groups.set(item.projectKey, [item]);
  }
  return [...groups].map(([projectKey, list]) => ({ projectKey, items: list }));
}

/** Whether the open thread listed under Drafts when it was opened. */
export interface OpenThreadDraftLatch {
  readonly key: string | null;
  readonly hasDraft: boolean;
}

/**
 * Which threads list under Drafts: every thread with unsent text, open or not, so clicking a row
 * never moves it. The open thread keeps the place it was opened in until another opens, so typing
 * or sending does not move it either. Pass back the latch; it is stable while the route is.
 */
export function resolveColumnDraftedKeys(
  unsentKeys: ReadonlySet<string>,
  routeKey: string | null,
  latch: OpenThreadDraftLatch | null,
): { readonly draftedKeys: ReadonlySet<string>; readonly latch: OpenThreadDraftLatch } {
  const next =
    latch !== null && latch.key === routeKey
      ? latch
      : { key: routeKey, hasDraft: routeKey !== null && unsentKeys.has(routeKey) };
  if (next.key === null || unsentKeys.has(next.key) === next.hasDraft) {
    return { draftedKeys: unsentKeys, latch: next };
  }
  const draftedKeys = new Set(unsentKeys);
  if (next.hasDraft) draftedKeys.add(next.key);
  else draftedKeys.delete(next.key);
  return { draftedKeys, latch: next };
}

/** "now", "5m", "3h", "2d" read as a time: "Now", "5m ago". */
export function threadColumnAge(age: string, resolve: MessageResolver = m): string {
  return age === "now"
    ? resolve(msg("Now", { $context: "age of a thread that just finished" }))
    : resolve(msg("{age} ago", { age }));
}

/**
 * Where to go when threads leave a list while one of them is open: the next thread below the
 * open one that stays in the list, else the nearest one above it. Null when the open thread
 * stays, or nothing is left. `listed` is the list in the order it shows.
 */
export function nextThreadAfterRemoval<T extends { readonly key: string }>(
  listed: readonly T[],
  removedKeys: ReadonlySet<string>,
  openKey: string | null,
): T | null {
  if (openKey === null || !removedKeys.has(openKey)) return null;
  const at = listed.findIndex((item) => item.key === openKey);
  if (at === -1) return null;
  const kept = (item: T) => !removedKeys.has(item.key);
  return listed.slice(at + 1).find(kept) ?? listed.slice(0, at).findLast(kept) ?? null;
}
