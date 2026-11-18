import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { useRouter } from "@tanstack/react-router";
import { msg, useMessages } from "gt-react";
import { useShallow } from "zustand/react/shallow";

import {
  composerDraftHasUserContent,
  type ComposerThreadDraftState,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { m, type MessageResolver } from "../../i18n/messages";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import {
  useDelegatedUnderParent,
  useQuietThreadShells,
  useServerConfigs,
} from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { activeMute } from "./threadMute.logic";
import {
  type DraftTabSource,
  draftTabTitle,
  orderThreadTabs,
  resolveThreadTabIcon,
  selectDraftTabs,
  selectOpenThreads,
  type ThreadTabIcon,
  threadTabKey,
  type ThreadTabView,
} from "./threadTabs.logic";
import { resolveOpenThreadStatus } from "../rail/railStatus.logic";

export interface ThreadTabEntry extends ThreadTabView {
  readonly kind: "thread";
  readonly ref: ScopedThreadRef;
  readonly thread: SidebarThreadSummary;
  readonly pinned: boolean;
  readonly icon: ThreadTabIcon | null;
}

/** A new thread that has not been sent yet, shown as a tab like the sidebar's draft rows. */
export interface DraftTabEntry extends ThreadTabView {
  readonly kind: "draft";
  readonly draftId: DraftId;
  readonly pinned: false;
}

export type TabEntry = ThreadTabEntry | DraftTabEntry;

/** The minute clock as epoch ms; mutes and Done markers are judged against it. */
export function useNowMinuteMs(): number {
  return Date.parse(`${useNowMinute()}:00.000Z`);
}

/** Everything the strip, All Tabs and the next-needs-you jump read, from one subscription. */
export function useThreadTabsSource() {
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const groups = useSidebarProjectGroups();
  const serverConfigs = useServerConfigs();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMs = useNowMinuteMs();
  return {
    threads,
    delegatedUnderParent,
    groups,
    loadedEnvironmentIds: new Set<EnvironmentId>(serverConfigs.keys()),
    lastVisitedById,
    nowMs,
  };
}

export type ThreadTabsSource = ReturnType<typeof useThreadTabsSource>;

/** The open threads of the given projects, in tab order, with what each tab shows. */
export function buildThreadTabEntries(
  source: ThreadTabsSource,
  projectKeys: ReadonlySet<string> | null,
  resolve: MessageResolver = m,
): { readonly tabs: ThreadTabEntry[]; readonly pinnedCount: number } {
  const open = selectOpenThreads({
    threads: source.threads,
    projectKeys,
    delegatedUnderParent: source.delegatedUnderParent,
    loadedEnvironmentIds: source.loadedEnvironmentIds,
    nowIso: new Date(source.nowMs).toISOString(),
  });
  const { tabs, pinnedCount } = orderThreadTabs(open);
  return {
    pinnedCount,
    tabs: tabs.map((thread) => {
      const key = threadTabKey(thread);
      const mute = activeMute(thread, source.nowMs);
      const visited = {
        ...thread,
        lastVisitedAt: resolveThreadLastVisitedAt(
          thread.lastVisitedAt,
          source.lastVisitedById[key],
        ),
      };
      const status = resolveOpenThreadStatus(visited, mute !== null);
      return {
        kind: "thread" as const,
        key,
        ref: scopeThreadRef(thread.environmentId, thread.id),
        thread,
        title: thread.title,
        pinned: thread.pinnedAt != null,
        mute,
        status,
        icon: resolveThreadTabIcon(resolveSidebarRowStatus(visited), status, resolve),
      };
    }),
  };
}

function composerPreview(composer: ComposerThreadDraftState, resolve: MessageResolver): string {
  const prompt = assistantCitationsToPlainText(
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label),
  );
  // images mirrors persistedAttachments once rehydration finishes, hence max, as in the sidebar.
  const attachments =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return draftTabTitle(prompt, attachments, resolve);
}

/** Unsent new-thread drafts of the given projects, as the sidebar's draft block lists them. */
export function useDraftTabs(
  projectKeys: ReadonlySet<string>,
  routeDraftId: DraftId | null,
): DraftTabEntry[] {
  const resolve = useMessages();
  const sessions = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const composers = useComposerDraftStore(
    useShallow((store) =>
      Object.fromEntries(
        Object.keys(store.draftThreadsByThreadKey).map(
          (key) => [key, store.draftsByThreadKey[key]] as const,
        ),
      ),
    ),
  );
  const sources = Object.entries(sessions).map(
    ([draftId, session]): DraftTabSource & { readonly id: DraftId } => {
      const composer = composers[draftId];
      return {
        id: DraftId.make(draftId),
        draftId,
        environmentId: session.environmentId,
        projectId: session.projectId,
        createdAt: session.createdAt,
        promoted: session.promotedTo != null,
        hasContent: composerDraftHasUserContent(composer),
        title: composer ? composerPreview(composer, resolve) : resolve(msg("New Thread")),
      };
    },
  );
  return selectDraftTabs(sources, projectKeys, routeDraftId).map((draft) => ({
    kind: "draft",
    key: `draft:${draft.draftId}`,
    draftId: draft.id,
    title: draft.title,
    status: "idle",
    mute: null,
    pinned: false,
  }));
}

export function useOpenTab() {
  const router = useRouter();
  return (tab: Pick<ThreadTabEntry, "kind" | "ref"> | Pick<DraftTabEntry, "kind" | "draftId">) =>
    tab.kind === "thread"
      ? router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(tab.ref),
        })
      : router.navigate({ to: "/draft/$draftId", params: { draftId: tab.draftId } });
}
