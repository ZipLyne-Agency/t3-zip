import type { EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import { msg } from "gt-react";
import { useState } from "react";

import { m } from "../../i18n/messages";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useShownThreadRouteTarget } from "../../hooks/useShownThreadRouteTarget";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  useDelegatedUnderParent,
  useQuietThreadShells,
  useServerConfigs,
} from "../../state/entities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { resolveActiveThreadRouteRef } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import {
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  resolveThreadLastVisitedAt,
  useSnoozeWakeClock,
} from "../Sidebar.logic";
import {
  countRailStates,
  isRailOpenThread,
  railProjectAge,
  railProjectDetail,
  railProjectRunningCount,
  resolveRailThreadState,
  resolveRailTopStatus,
  sortRailMutedThreads,
  summarizeRailCounts,
  type RailCounts,
  type RailTopStatus,
} from "./railStatus.logic";

export const railThreadKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export interface RailProject {
  readonly group: SidebarProjectSnapshot;
  readonly counts: RailCounts;
  /** Commands and monitors its open threads run in the background, as their rows name them. */
  readonly running: number;
  readonly summary: string;
  /** The status its row shows, as the classic sidebar shows a thread's. */
  readonly topStatus: RailTopStatus | null;
  /** Open threads with the local visit watermark applied, as their rows show it. */
  readonly openThreads: readonly EnvironmentThreadShell[];
  /** When an open thread last changed; null with none open. */
  readonly lastActiveMs: number | null;
  /** The second line of its row. */
  readonly detail: string;
  /** When an open thread last changed, as "5h ago"; null with nothing open. */
  readonly age: string | null;
}

export interface RailListedThread {
  readonly thread: EnvironmentThreadShell;
  readonly projectName: string | null;
}

const SETTLED_PAGE_SIZE = 30;

function buildRailProjects(input: {
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly configLoaded: (environmentId: EnvironmentId) => boolean;
  readonly localLastVisitedAtById: Readonly<Record<string, string>>;
  /** Changes with the minute and with each snooze wake, so the counts follow the clock. */
  readonly clockKey: string;
}) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const groups = pickableProjectGroups(input.groups);
  const groupByMember = new Map<string, SidebarProjectSnapshot>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      groupByMember.set(`${ref.environmentId}:${ref.projectId}`, group);
    }
  }
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  const openByProject = new Map<string, EnvironmentThreadShell[]>();
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  for (const shell of visible) {
    const configLoaded = input.configLoaded(shell.environmentId);
    if (isRailOpenThread(shell, { nowIso, configLoaded })) {
      const group = groupByMember.get(`${shell.environmentId}:${shell.projectId}`);
      if (group === undefined) continue;
      const thread = {
        ...shell,
        lastVisitedAt:
          resolveThreadLastVisitedAt(
            shell.lastVisitedAt,
            input.localLastVisitedAtById[railThreadKey(shell)],
          ) ?? null,
      };
      const list = openByProject.get(group.projectKey);
      if (list) list.push(thread);
      else openByProject.set(group.projectKey, [thread]);
    } else if (configLoaded && effectiveSnoozed(shell, { now: nowIso })) {
      snoozed.push(shell);
    } else if (configLoaded && shell.settledOverride === "settled") {
      settled.push(shell);
    }
  }
  const projects = new Map<string, RailProject>();
  let noProject: RailProject | null = null;
  const projectKeys: string[] = [];
  for (const group of groups) {
    const openThreads = openByProject.get(group.projectKey) ?? [];
    const counts = countRailStates(
      openThreads.map((thread) => resolveRailThreadState(thread, nowMs)),
    );
    const lastActiveMs = openThreads.reduce<number | null>((latest, thread) => {
      const updated = Date.parse(thread.updatedAt);
      if (Number.isNaN(updated)) return latest;
      return latest === null || updated > latest ? updated : latest;
    }, null);
    const project = {
      group,
      counts,
      running: railProjectRunningCount(openThreads, nowMs),
      summary: summarizeRailCounts(counts),
      topStatus: resolveRailTopStatus(openThreads, nowMs),
      openThreads,
      lastActiveMs,
      detail: railProjectDetail(openThreads.length, lastActiveMs, nowMs),
      age: railProjectAge(lastActiveMs, nowMs),
    };
    if (group.isScratch) {
      noProject = project;
    } else {
      projects.set(group.projectKey, project);
      projectKeys.push(group.projectKey);
    }
  }
  const projectNameOf = (thread: EnvironmentThreadShell) => {
    const group = groupByMember.get(`${thread.environmentId}:${thread.projectId}`);
    if (group === undefined) return null;
    return group.isScratch ? m(msg("No Project")) : group.displayName;
  };
  const listed = (threads: readonly EnvironmentThreadShell[]): RailListedThread[] =>
    threads.map((thread) => ({ thread, projectName: projectNameOf(thread) }));
  return {
    projects,
    projectKeys,
    noProject,
    groupByMember,
    visibleThreads: visible,
    muted: listed(sortRailMutedThreads(visible, nowMs)),
    snoozed: listed(
      snoozed.toSorted(
        (left, right) =>
          firstValidTimestampMs(left.snoozedUntil ?? null) -
          firstValidTimestampMs(right.snoozedUntil ?? null),
      ),
    ),
    settled: sortSettledThreads(settled),
    listed,
  };
}

/**
 * Everything the rail shows: one row per project with its open-thread counts, No Project,
 * the selected project, and the Snoozed, Muted and Settled lists across every project.
 */
export function useRailModel(input: { readonly settledOpen: boolean }) {
  const groups = useSidebarProjectGroups();
  const serverConfigs = useServerConfigs();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const nowMinute = useNowMinute();
  const snoozeWakeClock = useSnoozeWakeClock(threads);
  const model = buildRailProjects({
    groups,
    threads,
    delegatedUnderParent,
    configLoaded: (environmentId) => serverConfigs.has(environmentId),
    localLastVisitedAtById,
    clockKey: `${nowMinute}:${snoozeWakeClock}`,
  });

  // Older settled threads load in pages, as in the classic Settled shelf.
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_PAGE_SIZE);
  const settledShelf = useOlderSettledShelf({
    scopes: [...serverConfigs.keys()].map((environmentId) => ({ environmentId, projectIds: null })),
    expanded: input.settledOpen,
    visibleCount: settledVisibleCount,
  });
  const listedSettled = model.settled.filter(settledShelf.isListed);
  useOlderSettledShelfGrowth(settledShelf, listedSettled);
  const settledCount = model.settled.length + settledShelf.unloadedCount(model.visibleThreads);

  const routeTarget = useShownThreadRouteTarget().shownTarget;
  const routeDraft = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeDraftRedirect = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getPromotedDraftRedirect(routeTarget.draftId) : null,
  );
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraft, routeDraftRedirect);
  const routeThreadKey = routeThreadRef === null ? null : scopedThreadKey(routeThreadRef);
  const routeThread =
    routeThreadKey === null
      ? undefined
      : threads.find((thread) => railThreadKey(thread) === routeThreadKey);
  const routeProjectMember =
    routeThread !== undefined
      ? `${routeThread.environmentId}:${routeThread.projectId}`
      : routeDraft !== null && routeDraft !== undefined
        ? `${routeDraft.environmentId}:${routeDraft.projectId}`
        : null;
  const selectedProjectKey =
    routeProjectMember === null
      ? null
      : (model.groupByMember.get(routeProjectMember)?.projectKey ?? null);

  return {
    projects: model.projects,
    projectKeys: model.projectKeys,
    noProject: model.noProject,
    selectedProjectKey,
    /** The open thread in the route, when it is a saved thread the rail can return to. */
    routeThreadKey: routeThread === undefined ? null : routeThreadKey,
    muted: model.muted,
    snoozed: model.snoozed,
    /** Every thread the rail can list, for thread search. */
    searchableThreads: model.visibleThreads,
    settledThreadKeys: new Set(model.settled.map(railThreadKey)),
    settled: {
      threads: model.listed(listedSettled.slice(0, settledVisibleCount)),
      count: settledCount,
      hasMore:
        listedSettled.length > settledVisibleCount ||
        settledShelf.unloadedCount(model.visibleThreads) > 0,
      loading: settledShelf.loading,
      failed: settledShelf.failed,
      retry: settledShelf.retry,
      showMore: () => setSettledVisibleCount((count) => count + SETTLED_PAGE_SIZE),
    },
  };
}

export type RailModel = ReturnType<typeof useRailModel>;
