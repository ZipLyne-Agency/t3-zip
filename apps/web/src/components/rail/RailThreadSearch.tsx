import { useAtomValue } from "@effect/atom-react";
import { DndContext } from "@dnd-kit/core";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  nextShownOrder,
  threadSearchMatchKey,
  threadSearchSubject,
  type ShownOrder,
} from "@t3tools/client-runtime/state/thread-search";
import {
  searchRailProjects,
  type RailProjectAway,
} from "@t3tools/client-runtime/state/project-rail";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { foldSearchQuery, rankMessageMatches } from "@t3tools/shared/paletteSearch";
import { useGT } from "gt-react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useSidebarPendingFileDropStore } from "../../sidebarPendingFileDropStore";
import {
  useConnectedEnvironmentIds,
  useEnvironmentIdentities,
  useEnvironmentMachines,
} from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useThreadSearch } from "../../state/queries";
import { findForMessageMatch, openThreadFindOnQuery } from "../chat/threadFindStore";
import { searchSidebarThreads } from "../Sidebar.logic";
import { SidebarSearchResultRow } from "../sidebar/SidebarThreadRow";
import { TooltipProvider } from "../ui/tooltip";
import { EMPTY_RAIL_PROVIDER_ENTRIES, railProviderEntriesAtom } from "./railProviderEntries";
import { RailSearchProjectRow } from "./RailRows";
import type { RailProject } from "./useRailModel";

// The search field points at these ids (see `SidebarThreadHeader`), counting across both sections.
const resultId = (index: number) => `sidebar-thread-search-result-${index}`;
const projectResultKey = (projectKey: string) => `project:${projectKey}`;
const threadResultKey = (threadKey: string) => `thread:${threadKey}`;

type RailSearchResult =
  | { readonly kind: "project"; readonly key: string; readonly project: RailProject }
  | { readonly kind: "thread"; readonly key: string; readonly thread: EnvironmentThreadShell };

function RailSearchSection(props: { title: string; count: number; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col">
      <div
        id={headingId}
        className="flex h-6 items-center gap-1.5 px-2.5 text-xs font-medium text-sidebar-muted-foreground"
      >
        <span className="truncate">{props.title}</span>
        <span className="shrink-0 tabular-nums text-sidebar-muted-foreground/70">
          {props.count}
        </span>
      </div>
      <ul role="presentation" className="flex flex-col gap-px">
        {props.children}
      </ul>
    </div>
  );
}

/**
 * The rail's search: projects by name (hidden and snoozed too), then threads as the classic
 * sidebar finds them. Two sections, one list for the keys (Up and Down, Enter, Escape). Opening
 * a result hands it to the rail, which brings its project back.
 */
export function useRailThreadSearch(input: {
  readonly searchableThreads: readonly EnvironmentThreadShell[];
  readonly settledThreadKeys: ReadonlySet<string>;
  readonly routeThreadKey: string | null;
  readonly navigateToThread: (threadRef: ScopedThreadRef) => Promise<void> | void;
  /** Every project, hidden and snoozed ones too, in rail order. */
  readonly projects: readonly RailProject[];
  readonly favoriteProjectKeys: readonly string[];
  readonly selectedProjectKey: string | null;
  readonly projectAway: (projectKey: string) => RailProjectAway | null;
  readonly awayLabel: (away: RailProjectAway) => string;
  readonly openProject: (projectKey: string) => void;
  /** Called as a thread result opens, before the route changes. */
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const threadSearch = useThreadSearch(connectedEnvironmentIds, query);
  const projects = useProjects();
  const projectGroups = useSidebarProjectGroups();
  const environments = useEnvironmentIdentities();
  const environmentMachineById = useEnvironmentMachines();
  const providerEntriesByEnvironment = useAtomValue(railProviderEntriesAtom);
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const isSearching = query.trim().length > 0;

  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );

  // Ranked across environments as the palette ranks them; rows already shown keep their places
  // while slower environments answer. Mirrors the classic sidebar.
  const threadByMatchKey = new Map(
    input.searchableThreads.map((thread) => [
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread,
    ]),
  );
  const rankedServerMatches =
    threadSearch.matches.length === 0
      ? []
      : rankMessageMatches(
          threadSearch.matches,
          (match) => {
            const thread = threadByMatchKey.get(threadSearchMatchKey(match));
            return thread ? threadSearchSubject(thread, null) : undefined;
          },
          foldSearchQuery(query),
          // oxlint-disable-next-line react/purity -- Recency ranking samples the clock when the search matches change, as in the classic sidebar.
          Date.now(),
          { picks: false },
        );
  const serverMatchByKey = new Map(
    rankedServerMatches.map((match) => [threadSearchMatchKey(match), match] as const),
  );
  const [shownMessageOrder, setShownMessageOrder] = useState<ShownOrder | null>(null);
  const messageOrder = nextShownOrder(
    shownMessageOrder,
    threadSearch.query,
    [...serverMatchByKey.keys()],
    Number.POSITIVE_INFINITY,
  );
  if (messageOrder !== shownMessageOrder) setShownMessageOrder(messageOrder);
  const { titleMatches, contentMatches } = searchSidebarThreads(
    input.searchableThreads,
    query,
    new Set(messageOrder.keys),
  );
  const threadResults = [...titleMatches, ...contentMatches];
  const projectResults = isSearching
    ? searchRailProjects(input.projects, query, (project) => project.group.displayName)
    : [];
  const results: RailSearchResult[] = [
    ...projectResults.map((project) => ({
      kind: "project" as const,
      key: projectResultKey(project.group.projectKey),
      project,
    })),
    ...threadResults.map((thread) => ({
      kind: "thread" as const,
      key: threadResultKey(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      thread,
    })),
  ];
  const matchByKey = new Map(
    contentMatches.flatMap((thread) => {
      const key = threadSearchMatchKey({
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
      const match = serverMatchByKey.get(key);
      return match ? [[key, match] as const] : [];
    }),
  );
  const resultKeys = results.map((result) => result.key);
  // The highlight follows its row, so rows that arrive late do not move it under Enter.
  const activeIndex = Math.max(0, highlightKey === null ? 0 : resultKeys.indexOf(highlightKey));

  const clear = () => {
    setQuery("");
    setHighlightKey(null);
  };
  const selectProject = (project: RailProject) => {
    clear();
    input.openProject(project.group.projectKey);
  };
  const selectThread = (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    // A row listed for a message match opens find on it, as the palette does.
    const match = matchByKey.get(
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    const matchQuery = threadSearch.query;
    clear();
    input.onOpenThread(thread);
    void input.navigateToThread(ref);
    if (match) openThreadFindOnQuery(scopedThreadKey(ref), findForMessageMatch(match, matchQuery));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      event.stopPropagation();
      clear();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlightKey(resultKeys[(activeIndex + step + results.length) % results.length] ?? null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result?.kind === "project") selectProject(result.project);
      else if (result) selectThread(result.thread);
    }
  };
  const onFileDropThreads = (threadRef: ScopedThreadRef, files: File[]) => {
    const dropId = queuePendingFileDrop({ threadRef, files });
    void Promise.resolve(input.navigateToThread(threadRef)).catch(() =>
      clearPendingFileDrop(dropId),
    );
  };

  const resultsList = !isSearching ? null : results.length > 0 ? (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <DndContext autoScroll={false}>
        <div
          id="sidebar-thread-search-results"
          role="listbox"
          aria-label={gt("Search results")}
          className="flex flex-col gap-3"
        >
          {projectResults.length > 0 ? (
            <RailSearchSection title={gt("Projects")} count={projectResults.length}>
              {projectResults.map((project, index) => {
                const projectKey = project.group.projectKey;
                const away = input.projectAway(projectKey);
                return (
                  <RailSearchProjectRow
                    key={projectKey}
                    project={project}
                    favorite={input.favoriteProjectKeys.includes(projectKey)}
                    awayLabel={away === null ? null : input.awayLabel(away)}
                    resultId={resultId(index)}
                    highlighted={activeIndex === index}
                    selected={input.selectedProjectKey === projectKey}
                    onHighlight={() => setHighlightKey(projectResultKey(projectKey))}
                    onSelect={() => selectProject(project)}
                  />
                );
              })}
            </RailSearchSection>
          ) : null}
          {threadResults.length > 0 ? (
            <RailSearchSection title={gt("Threads")} count={threadResults.length}>
              {threadResults.map((thread, threadIndex) => {
                const index = projectResults.length + threadIndex;
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                const memberKey = `${thread.environmentId}:${thread.projectId}` as const;
                return (
                  <SidebarSearchResultRow
                    key={threadKey}
                    isSettled={input.settledThreadKeys.has(threadKey)}
                    thread={thread}
                    project={projectByKey.get(memberKey) ?? null}
                    projectDisplayName={projectDisplayNameByKey.get(memberKey) ?? null}
                    environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                    environmentMachine={
                      environmentMachineById.get(thread.environmentId) ?? "server"
                    }
                    providerEntryByInstanceId={
                      providerEntriesByEnvironment.get(thread.environmentId) ??
                      EMPTY_RAIL_PROVIDER_ENTRIES
                    }
                    isHighlighted={activeIndex === index}
                    isRouteActive={input.routeThreadKey === threadKey}
                    resultId={resultId(index)}
                    searchMatch={
                      matchByKey.get(
                        threadSearchMatchKey({
                          environmentId: thread.environmentId,
                          threadId: thread.id,
                        }),
                      ) ?? null
                    }
                    searchQuery={query}
                    searchMatchQuery={threadSearch.query}
                    onHighlight={() => setHighlightKey(threadResultKey(threadKey))}
                    onSelect={() => selectThread(thread)}
                    // The rail has no thread context menu; right-click on a result does nothing here.
                    onContextMenu={() => {}}
                    onFileDropThreads={onFileDropThreads}
                  />
                );
              })}
            </RailSearchSection>
          ) : null}
        </div>
      </DndContext>
    </TooltipProvider>
  ) : (
    <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      {threadSearch.isPending
        ? gt("Searching thread messages…")
        : gt("No projects or threads found")}
    </p>
  );

  return {
    inputRef,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      setHighlightKey(null);
    },
    isSearching,
    onKeyDown,
    clear,
    resultCount: results.length,
    activeIndex,
    resultsList,
  };
}
