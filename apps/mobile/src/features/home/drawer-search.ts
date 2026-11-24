import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { isListedThreadLineage } from "@t3tools/contracts";
import { foldSearchQuery } from "@t3tools/shared/paletteSearch";

import { rankThreadTitleMatches } from "../threads/threadListV2";
import {
  railProjectAway,
  searchRailProjects,
  type ProjectDrawerModel,
  type RailProjectAway,
  type SharedProjectRail,
} from "./project-drawer";
import type { ProjectSwitcherRow } from "./project-switcher";

export interface DrawerProjectResult {
  readonly row: ProjectSwitcherRow;
  /** Why the project is not in the list, or null when it is. */
  readonly away: RailProjectAway | null;
}

/**
 * Projects whose names match the search, ranked as desktop ranks them, with list order (fixed
 * rows, the rail whatever Favorites Only shows, then hidden and snoozed projects) breaking
 * ties. Without a shared rail every match is listed.
 */
export function drawerProjectResults(input: {
  readonly model: ProjectDrawerModel;
  readonly rail: SharedProjectRail | null;
  readonly query: string;
  readonly nowMs: number;
}): DrawerProjectResult[] {
  const { model, rail } = input;
  const seen = new Set<string | null>();
  const candidates = [
    ...model.fixed,
    ...model.items.flatMap((item) => (item.kind === "project" ? [item.row] : [])),
    ...model.hidden,
    ...model.snoozed.map(({ row }) => row),
  ].filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
  return searchRailProjects(candidates, input.query, (row) => row.title).map((row) => ({
    row,
    away: rail === null || row.key === null ? null : railProjectAway(rail, row.key, input.nowMs),
  }));
}

export interface DrawerThreadResult {
  readonly thread: EnvironmentThreadShell;
  /** Listed for a message, not its title: the row shows the message and opens at it. */
  readonly contentOnly: boolean;
}

/**
 * Threads that match the search, as the thread list finds them: title matches by rank, then
 * threads matched only by a message, in the order of `messageMatchKeys`. Archived threads and
 * child threads are left out.
 */
export function drawerThreadResults(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly query: string;
  readonly nowMs: number;
  readonly messageMatchKeys: Iterable<string>;
}): DrawerThreadResult[] {
  const query = foldSearchQuery(input.query);
  if (query.length === 0) return [];
  const listed = input.threads.filter(
    (thread) => thread.archivedAt === null && isListedThreadLineage(thread.lineage),
  );
  const ranked = rankThreadTitleMatches(listed, query, input.nowMs);
  const rankedSet = new Set(ranked);
  const threadByKey = new Map(
    listed.map((thread) => [
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread,
    ]),
  );
  const contentOnly = [...input.messageMatchKeys].flatMap((key) => {
    const thread = threadByKey.get(key);
    return thread && !rankedSet.has(thread) ? [thread] : [];
  });
  return [
    ...ranked.map((thread) => ({ thread, contentOnly: false })),
    ...contentOnly.map((thread) => ({ thread, contentOnly: true })),
  ];
}
