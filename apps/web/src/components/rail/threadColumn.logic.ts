import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import type { RailFilter } from "./railStore";
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

/**
 * The rail filter's rule for one thread: Waiting is needs you or failed, and Done keeps a
 * finished thread until it is cleared, opened or not.
 */
function matchesRailFilter(
  item: Pick<ThreadColumnItem, "status" | "doneSection">,
  filter: RailFilter,
): boolean {
  const { status } = item;
  switch (filter) {
    case "all":
      return true;
    case "waiting":
      return status === "needs" || status === "failed";
    case "working":
      return status === "working";
    case "done":
      return item.doneSection !== null;
  }
}

export function countThreadColumnFilters(
  items: ReadonlyArray<Pick<ThreadColumnItem, "kind" | "status" | "doneSection">>,
): Record<Exclude<RailFilter, "all">, number> {
  const counts = { waiting: 0, working: 0, done: 0 };
  for (const item of items) {
    if (item.kind !== "thread") continue;
    if (matchesRailFilter(item, "waiting")) counts.waiting += 1;
    else if (item.status === "working") counts.working += 1;
    else if (matchesRailFilter(item, "done")) counts.done += 1;
  }
  return counts;
}

function startOfLocalDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * Sections in reading order: drafts, needs you, working, pinned, then by day. Needs You and
 * Working list the longest waiting first; the rest the newest. Drafts (new threads and threads
 * with unsent text, listed only there) show under every filter. Empty
 * sections are left out.
 */
export function buildThreadColumnSections<T extends ThreadColumnItem>(
  items: readonly T[],
  filter: RailFilter,
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
    if (!matchesRailFilter(item, filter)) continue;
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
  const newestFirst = (left: T, right: T) =>
    right.updatedMs - left.updatedMs || (left.key < right.key ? -1 : 1);
  return (Object.keys(buckets) as ThreadColumnSectionId[]).flatMap((id) => {
    const list = buckets[id];
    if (list.length === 0) return [];
    const sorted = list.toSorted(id === "needs" || id === "working" ? oldestFirst : newestFirst);
    return [{ id, label: SECTION_LABELS[id], items: sorted }];
  });
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

/** "now", "5m", "3h", "2d" read as a time: "Now", "5m ago". */
export function threadColumnAge(age: string, resolve: MessageResolver = m): string {
  return age === "now"
    ? resolve(msg("Now", { $context: "age of a thread that just finished" }))
    : resolve(msg("{age} ago", { age }));
}
