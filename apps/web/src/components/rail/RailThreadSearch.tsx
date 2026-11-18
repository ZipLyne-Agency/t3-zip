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
import type { ScopedThreadRef } from "@t3tools/contracts";
import { foldSearchQuery, rankMessageMatches } from "@t3tools/shared/paletteSearch";
import { useGT } from "gt-react";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

const resultId = (index: number) => `sidebar-thread-search-result-${index}`;

/**
 * The classic sidebar's thread search, for the rail: the same field, the same ranking of
 * titles and then message matches across environments, the same result rows, and the same
 * keys (Up and Down move, Enter opens, Escape clears). Results replace the project list while
 * a query is typed, as they replace the thread list in the classic sidebar.
 */
export function useRailThreadSearch(input: {
  readonly searchableThreads: readonly EnvironmentThreadShell[];
  readonly settledThreadKeys: ReadonlySet<string>;
  readonly routeThreadKey: string | null;
  readonly navigateToThread: (threadRef: ScopedThreadRef) => Promise<void> | void;
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
  const results = [...titleMatches, ...contentMatches];
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
  const resultKeys = results.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  // The highlight follows its thread, so rows that arrive late do not move it under Enter.
  const activeIndex = Math.max(0, highlightKey === null ? 0 : resultKeys.indexOf(highlightKey));

  const clear = () => {
    setQuery("");
    setHighlightKey(null);
  };
  const select = (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    // A row listed for a message match opens find on it, as the palette does.
    const match = matchByKey.get(
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    const matchQuery = threadSearch.query;
    clear();
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
      if (result) select(result);
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
        <ul
          id="sidebar-thread-search-results"
          role="listbox"
          aria-label={gt("Thread search results")}
          className="flex flex-col gap-px"
        >
          {results.map((thread, index) => {
            const threadKey = resultKeys[index]!;
            const memberKey = `${thread.environmentId}:${thread.projectId}` as const;
            return (
              <SidebarSearchResultRow
                key={threadKey}
                isSettled={input.settledThreadKeys.has(threadKey)}
                thread={thread}
                project={projectByKey.get(memberKey) ?? null}
                projectDisplayName={projectDisplayNameByKey.get(memberKey) ?? null}
                environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                environmentMachine={environmentMachineById.get(thread.environmentId) ?? "server"}
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
                onHighlight={() => setHighlightKey(threadKey)}
                onSelect={() => select(thread)}
                onFileDropThreads={onFileDropThreads}
              />
            );
          })}
        </ul>
      </DndContext>
    </TooltipProvider>
  ) : (
    <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      {threadSearch.isPending ? gt("Searching thread messages…") : gt("No threads found")}
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
