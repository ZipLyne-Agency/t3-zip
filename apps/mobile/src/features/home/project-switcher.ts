import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  matchesThreadStatusFilter,
  type DoneSection,
  type OpenThreadStatus,
} from "@t3tools/client-runtime/state/thread-status-filter";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";

/** A thread's status entry as the status filters see it; see `buildThreadStatusEntries`. */
export interface ProjectSwitcherStatusEntry {
  readonly thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly status: OpenThreadStatus;
  readonly doneSection: DoneSection | null;
}

/**
 * How many open threads wait on the user (Needs You: waiting or failed), in all and per project
 * scope, by the same rule as the thread list's Needs You filter.
 */
export function countWaitingThreadsByScope(input: {
  readonly scopes: ReadonlyArray<{
    readonly key: string;
    readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  }>;
  readonly entries: ReadonlyArray<ProjectSwitcherStatusEntry>;
}): { readonly total: number; readonly byScope: ReadonlyMap<string, number> } {
  const scopeKeyByProject = new Map(
    input.scopes.flatMap((scope) =>
      scope.projectRefs.map(
        (ref) => [scopedProjectKey(ref.environmentId, ref.projectId), scope.key] as const,
      ),
    ),
  );
  const byScope = new Map<string, number>();
  let total = 0;
  for (const entry of input.entries) {
    if (!matchesThreadStatusFilter(entry, "waiting")) continue;
    total += 1;
    const scopeKey = scopeKeyByProject.get(
      scopedProjectKey(entry.thread.environmentId, entry.thread.projectId),
    );
    if (scopeKey !== undefined) byScope.set(scopeKey, (byScope.get(scopeKey) ?? 0) + 1);
  }
  return { total, byScope };
}

export interface ProjectSwitcherRow {
  /** The project filter key the row picks: null for every project. */
  readonly key: string | null;
  readonly kind: "all" | "none" | "project";
  readonly title: string;
  readonly waitingCount: number;
  /** When the scope was last active, for a project row. */
  readonly lastActiveMs: number | null;
  /** The project whose icon the row shows. */
  readonly project: EnvironmentProject | null;
}

/**
 * The drawer's rows: No Project (when that scope exists) and All Projects on top, then every
 * other project in the order given, which is most recently active first.
 */
export function buildProjectSwitcherRows(input: {
  readonly scopes: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly representative: EnvironmentProject;
    readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  }>;
  readonly noProjectKey: string | null;
  readonly entries: ReadonlyArray<ProjectSwitcherStatusEntry>;
  readonly activityByScope: ReadonlyMap<string, number>;
  readonly allTitle: string;
  readonly noProjectTitle: string;
}): { readonly fixed: ProjectSwitcherRow[]; readonly recent: ProjectSwitcherRow[] } {
  const counts = countWaitingThreadsByScope({ scopes: input.scopes, entries: input.entries });
  const fixed: ProjectSwitcherRow[] = [];
  const noProjectScope = input.scopes.find((scope) => scope.key === input.noProjectKey);
  if (noProjectScope) {
    fixed.push({
      key: noProjectScope.key,
      kind: "none",
      title: input.noProjectTitle,
      waitingCount: counts.byScope.get(noProjectScope.key) ?? 0,
      lastActiveMs: null,
      project: null,
    });
  }
  fixed.push({
    key: null,
    kind: "all",
    title: input.allTitle,
    waitingCount: counts.total,
    lastActiveMs: null,
    project: null,
  });
  const recent = input.scopes
    .filter((scope) => scope !== noProjectScope)
    .map((scope): ProjectSwitcherRow => {
      const activity = input.activityByScope.get(scope.key);
      return {
        key: scope.key,
        kind: "project",
        title: scope.title,
        waitingCount: counts.byScope.get(scope.key) ?? 0,
        lastActiveMs: activity !== undefined && Number.isFinite(activity) ? activity : null,
        project: scope.representative,
      };
    });
  return { fixed, recent };
}

/** Rows whose name contains the query, ignoring case; an empty query keeps every row. */
export function filterProjectSwitcherRows<Row extends { readonly title: string }>(
  rows: ReadonlyArray<Row>,
  query: string,
): Row[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => row.title.toLocaleLowerCase().includes(needle));
}
