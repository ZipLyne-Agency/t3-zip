/**
 * T3 Zip: searching the project rail, and bringing a project back to it. Shared by the desktop
 * rail and the phone, so both list the same project results and make the same rail changes
 * when one is opened.
 */
import { foldSearchQuery, rankSearchItems, scoreSearchTerms } from "@t3tools/shared/paletteSearch";

import type { SnoozedProjects } from "./projectRailSnooze.ts";

/** The rail fields that say whether a project is away from it. */
interface RailAwayFields {
  readonly hiddenProjects: readonly string[];
  readonly snoozedProjects: SnoozedProjects;
}

/**
 * Projects whose name matches `query`, best match first, as the command palette ranks names.
 * Matches of the same quality keep the order they were given in (pass them in rail order).
 */
export function searchRailProjects<P>(
  projects: readonly P[],
  query: string,
  nameOf: (project: P) => string,
): P[] {
  const normalizedQuery = foldSearchQuery(query);
  if (normalizedQuery.length === 0) return [];
  return rankSearchItems(projects, (project, options) =>
    scoreSearchTerms(normalizedQuery, [nameOf(project)], options),
  ).map(({ item }) => item);
}

/** Why a project is not in the rail: hidden, or snoozed until a time. Null when it is there. */
export type RailProjectAway =
  | { readonly kind: "hidden" }
  | { readonly kind: "snoozed"; readonly until: string };

/** Hidden wins over snoozed; a snooze whose time has passed no longer keeps a project away. */
export function railProjectAway(
  rail: RailAwayFields,
  projectKey: string,
  nowMs: number,
): RailProjectAway | null {
  if (rail.hiddenProjects.includes(projectKey)) return { kind: "hidden" };
  const until = rail.snoozedProjects[projectKey];
  return until !== undefined && Date.parse(until) > nowMs ? { kind: "snoozed", until } : null;
}

/**
 * What bringing a project back to the rail changes: a hidden project is shown and a snoozed one
 * woken (both, when it is both). Null when it is already in the rail. Any snooze entry counts,
 * so one that ran out but is not cleared yet is cleared too.
 */
export function railProjectReturn(
  rail: RailAwayFields,
  projectKey: string,
): { readonly show: boolean; readonly wake: boolean } | null {
  const show = rail.hiddenProjects.includes(projectKey);
  const wake = projectKey in rail.snoozedProjects;
  return show || wake ? { show, wake } : null;
}

/**
 * The rail projects holding any of `memberKeys` (`environmentId:projectId`), in `groups` order:
 * the projects a message was sent in, or the project of a thread opened from search. A member
 * project no group holds (a thread with no project) gives nothing.
 */
export function railProjectKeysForMembers(
  groups: Iterable<{
    readonly projectKey: string;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  }>,
  memberKeys: Iterable<string>,
): string[] {
  const wanted = new Set(memberKeys);
  if (wanted.size === 0) return [];
  const keys: string[] = [];
  for (const group of groups) {
    if (
      group.memberProjectRefs.some((ref) => wanted.has(`${ref.environmentId}:${ref.projectId}`))
    ) {
      keys.push(group.projectKey);
    }
  }
  return keys;
}
