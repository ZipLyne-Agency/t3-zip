import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useShownThreadRouteTarget } from "../../hooks/useShownThreadRouteTarget";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useQuietThreadShells } from "../../state/entities";
import { resolveActiveThreadRouteRef } from "../../threadRoutes";
import { findThreadGroup } from "../tabs/threadTabs.logic";
import { useSidebar } from "../ui/sidebar";
import { useProjectRailStore } from "./railStore";
import { resolveThreadColumnScope, threadColumnFits } from "./threadColumn.logic";

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribeToViewportWidth, () => window.innerWidth);
}

/** The open thread or draft, by the keys the tabs use, and the project it belongs to. */
function useThreadColumnRoute(groups: readonly SidebarProjectSnapshot[]) {
  const threads = useQuietThreadShells();
  const routeTarget = useShownThreadRouteTarget().shownTarget;
  const routeDraft = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeDraftRedirect = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getPromotedDraftRedirect(routeTarget.draftId) : null,
  );
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraft, routeDraftRedirect);
  const routeDraftId =
    routeTarget?.kind === "draft" && routeThreadRef === null ? routeTarget.draftId : null;
  const routeKey =
    routeThreadRef !== null
      ? scopedThreadKey(routeThreadRef)
      : routeDraftId !== null
        ? `draft:${routeDraftId}`
        : null;
  const routeThread =
    routeThreadRef === null
      ? undefined
      : threads.find(
          (thread) =>
            thread.environmentId === routeThreadRef.environmentId &&
            thread.id === routeThreadRef.threadId,
        );
  const member = routeThread ?? routeDraft ?? null;
  const routeProjectKey =
    member === null || member === undefined
      ? null
      : (findThreadGroup(groups, member)?.projectKey ?? null);
  return { routeKey, routeDraftId, routeProjectKey };
}

/**
 * What the thread column lists, shared by the rail (which highlights it) and the column.
 * `choose` records a pick under the open thread; `keepWhileOpening` re-records the current
 * scope under a thread the column is about to open, so opening it keeps the column in place.
 */
export function useThreadColumnScope() {
  const groups = pickableProjectGroups(useSidebarProjectGroups());
  const route = useThreadColumnRoute(groups);
  const choice = useProjectRailStore((store) => store.threadColumnScope);
  const chooseScope = useProjectRailStore((store) => store.chooseThreadColumnScope);
  const scope = resolveThreadColumnScope({
    choice,
    routeKey: route.routeKey,
    routeProjectKey: route.routeProjectKey,
    knownScopes: new Set(groups.map((group) => group.projectKey)),
  });
  return {
    scope,
    groups,
    ...route,
    choose: (next: string) => chooseScope(next, route.routeKey),
    /** Picks a project and keeps it while one of its threads opens. */
    chooseWhileOpening: (next: string, nextRouteKey: string) => chooseScope(next, nextRouteKey),
    keepWhileOpening: (nextRouteKey: string) => chooseScope(scope, nextRouteKey),
  };
}

/** True when the column shows: the person keeps it open and the window has room for it. */
export function useThreadColumnShown(): boolean {
  const open = useProjectRailStore((store) => store.threadColumnOpen);
  const { state, isMobile } = useSidebar();
  const viewportWidth = useViewportWidth();
  return open && !isMobile && threadColumnFits(viewportWidth, state === "collapsed");
}
