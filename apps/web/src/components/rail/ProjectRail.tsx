import { useAtomValue } from "@effect/atom-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { msg, T, useGT } from "gt-react";
import {
  FolderPlusIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SquarePlusIcon,
  StarIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { randomUUID } from "~/lib/utils";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { m } from "../../i18n/messages";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarFolderDrop } from "../sidebar/SidebarFolderDrop";
import { useProjectGroupUpdate } from "../../hooks/useProjectGroupUpdate";
import { SidebarThreadHeader } from "../sidebar/SidebarThreadHeader";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RailCollapsed } from "./RailCollapsed";
import {
  RailEmptyFolderRow,
  RailFolderRow,
  RailNoProjectRow,
  RailAllProjectsRow,
  RailProjectRow,
  type RailRowActions,
} from "./RailRows";
import { RailFilterBar, RailQueueList } from "./RailFilters";
import { RailShelves } from "./RailShelves";
import { useRailThreadSearch } from "./RailThreadSearch";
import {
  applyRailDrop,
  buildRailEntries,
  createRailFolder,
  moveRailFolder,
  moveRailProject,
  railFolderEntry,
  railProjectEntry,
  railProjectOrder,
  railStepPlacement,
  removeRailFolder,
  renameRailFolder,
  resolveRailDrop,
  restoreRailFolder,
  setRailFolderCollapsed,
  snapshotRailFolder,
  type RailDragItem,
  type RailDrop,
  type RailDropRow,
  type RailLayoutState,
  type RailRowEntry,
} from "./railLayout.logic";
import {
  addRailCounts,
  EMPTY_RAIL_COUNTS,
  pickRailProjectThread,
  summarizeRailCounts,
} from "./railStatus.logic";
import { useProjectRailStore } from "./railStore";
import { railThreadKey, useRailModel, type RailProject } from "./useRailModel";
import { useOpenTab, useThreadTabsSource } from "../tabs/useThreadTabs";
import { firstColumnThread } from "./ThreadColumn";
import { ALL_PROJECTS_SCOPE, threadColumnFits } from "./threadColumn.logic";
import { useThreadColumnScope, useThreadColumnShown, useViewportWidth } from "./useThreadColumn";
import { useClearFromDone } from "./useClearFromDone";
import { useRailQueue, type RailQueueItem } from "./useRailQueue";

const RAIL_DRAG_DISTANCE = 6;

const entryId = (entry: RailRowEntry) =>
  entry.kind === "project" ? railProjectEntry(entry.projectKey) : railFolderEntry(entry.folderId);

function folderCounts(projectKeys: readonly string[], projects: ReadonlyMap<string, RailProject>) {
  return projectKeys.reduce(
    (total, key) => addRailCounts(total, projects.get(key)?.counts ?? EMPTY_RAIL_COUNTS),
    EMPTY_RAIL_COUNTS,
  );
}

function ProjectsHeader(props: {
  onNewProject: () => void;
  onNewFolder: () => void;
  favoritesOnly: boolean;
  favoriteCount: number;
  onFavoritesOnlyChange: (favoritesOnly: boolean) => void;
  /** Set while the thread list is hidden and the window has room to show it. */
  onShowThreadList: (() => void) | null;
}) {
  const gt = useGT();
  const starLabel = props.favoritesOnly
    ? gt("Show All Projects")
    : gt("Show Favorites Only ({count})", { count: props.favoriteCount });
  return (
    <div className="flex items-center justify-between gap-1 pt-3 pr-1 pb-1 pl-2">
      <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-muted-foreground">
        {props.favoritesOnly ? gt("Favorites") : gt("Projects")}
      </h2>
      {props.onShowThreadList ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={gt("Show Thread List")}
                onClick={props.onShowThreadList}
              />
            }
          >
            <PanelLeftOpenIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{gt("Show Thread List")}</TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={starLabel}
              aria-pressed={props.favoritesOnly}
              onClick={() => props.onFavoritesOnlyChange(!props.favoritesOnly)}
            />
          }
        >
          <StarIcon
            aria-hidden
            className={cn(props.favoritesOnly && "fill-current text-warning-foreground")}
          />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{starLabel}</TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Add a project or folder")}
            />
          }
        >
          <PlusIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom">
          <MenuItem onClick={props.onNewProject}>
            <SquarePlusIcon />
            <T>New Project…</T>
          </MenuItem>
          <MenuItem onClick={props.onNewFolder}>
            <FolderPlusIcon />
            <T>New Folder</T>
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

/**
 * The left rail in Project Rail layout: one row per project with what needs you, in an order
 * and folders the user sets, with No Project and the Snoozed, Muted and Settled lists. Folded,
 * it shows one badge per project.
 */
export function ProjectRail() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const gt = useGT();
  const router = useRouter();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [settledOpen, setSettledOpen] = useState(false);
  const model = useRailModel({ settledOpen });
  const layout = useProjectRailStore((store) => store.layout);
  const noProjectPosition = useProjectRailStore((store) => store.noProjectPosition);
  const lastThreadByProject = useProjectRailStore((store) => store.lastThreadByProject);
  const hiddenProjects = useProjectRailStore((store) => store.hiddenProjects);
  const shelvesCollapsed = useProjectRailStore((store) => store.shelvesCollapsed);
  const favoriteProjects = useProjectRailStore((store) => store.favoriteProjects);
  const favoritesOnly = useProjectRailStore((store) => store.favoritesOnly);
  const setFavoritesOnly = useProjectRailStore((store) => store.setFavoritesOnly);
  const setProjectFavorite = useProjectRailStore((store) => store.setProjectFavorite);
  const filter = useProjectRailStore((store) => store.filter);
  const setFilter = useProjectRailStore((store) => store.setFilter);
  const queue = useRailQueue();
  const clearFromDone = useClearFromDone();
  const column = useThreadColumnScope();
  const columnShown = useThreadColumnShown();
  const tabsSource = useThreadTabsSource();
  const openTab = useOpenTab();
  const threadColumnOpen = useProjectRailStore((store) => store.threadColumnOpen);
  const setThreadColumnOpen = useProjectRailStore((store) => store.setThreadColumnOpen);
  const viewportWidth = useViewportWidth();
  const setShelvesCollapsed = useProjectRailStore((store) => store.setShelvesCollapsed);
  const hideProject = useProjectRailStore((store) => store.hideProject);
  const showProject = useProjectRailStore((store) => store.showProject);
  const updateLayout = useProjectRailStore((store) => store.updateLayout);
  const setNoProjectPosition = useProjectRailStore((store) => store.setNoProjectPosition);
  const rememberThread = useProjectRailStore((store) => store.rememberThread);
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingProjectKey, setRenamingProjectKey] = useState<string | null>(null);
  const { updateProjectGroup } = useProjectGroupUpdate();
  // Read when a menu closes: a choice that opened a folder name keeps focus in the name.
  const renameFocusRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [drag, setDrag] = useState<RailDragItem | null>(null);
  const [drop, setDrop] = useState<RailDrop | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: RAIL_DRAG_DISTANCE } }),
  );

  const { projects, projectKeys, noProject, selectedProjectKey, routeThreadKey } = model;
  // Without the column, the rail keeps its own Waiting, Working and Done lists.
  const railFilter = columnShown ? "all" : filter;
  // With the thread column, the highlighted row is the list the column shows; without it, the
  // open thread's project, as before.
  const highlightKey = columnShown ? column.scope : selectedProjectKey;
  const entries = buildRailEntries(layout, projectKeys, hiddenProjects);
  const hiddenList = hiddenProjects.flatMap((key) => projects.get(key) ?? []);
  const topIds = entries.map(entryId);
  const folderChoices = entries.flatMap((entry) =>
    entry.kind === "folder" ? [{ folderId: entry.folderId, name: entry.name }] : [],
  );
  const folderOf = (projectKey: string) =>
    entries.find(
      (entry): entry is Extract<RailRowEntry, { kind: "folder" }> =>
        entry.kind === "folder" && entry.projectKeys.includes(projectKey),
    ) ?? null;
  const scratchEnvironment = scratchEnvironmentId(noProject?.group.environmentId ?? null);
  const showNoProject = noProject !== null || scratchEnvironment !== null;
  const newThreadShortcutLabel = shortcutLabelForCommand(keybindings, "chat.new");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the shown thread as its project's last viewed one; tabs, links, history and shortcuts change the route without the rail
  useEffect(() => {
    if (selectedProjectKey !== null && routeThreadKey !== null) {
      rememberThread(selectedProjectKey, routeThreadKey);
    }
  }, [rememberThread, routeThreadKey, selectedProjectKey]);

  const change = (update: (layout: RailLayoutState) => RailLayoutState) =>
    updateLayout(projectKeys, update);

  const navigateToThread = (threadRef: ScopedThreadRef) => {
    if (isMobile) setOpenMobile(false);
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };
  const search = useRailThreadSearch({
    searchableThreads: model.searchableThreads,
    settledThreadKeys: model.settledThreadKeys,
    routeThreadKey,
    navigateToThread,
  });

  const startThreadIn = (project: RailProject) => {
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(project.group.environmentId, project.group.id));
  };

  const openRailProject = (project: RailProject, startNew: () => void) => {
    const target = pickRailProjectThread(
      project.openThreads,
      railThreadKey,
      lastThreadByProject[project.group.projectKey] ?? null,
    );
    if (target === null) startNew();
    else void navigateToThread(scopeThreadRef(target.environmentId, target.id));
  };

  // With the thread column, a project click lists its threads there and opens the one at the
  // top, so the chat leaves the old project too. A project with no open thread starts one.
  // Clicking the project already open only brings its list back.
  const openInColumn = (project: RailProject, startNew: () => void) => {
    const projectKey = project.group.projectKey;
    if (projectKey === column.routeProjectKey) {
      column.choose(projectKey);
      return;
    }
    const first = firstColumnThread(tabsSource, project.group);
    if (first === null) {
      column.choose(projectKey);
      startNew();
      return;
    }
    column.chooseWhileOpening(projectKey, first.key);
    void openTab(first);
  };

  // Opening from Waiting or Done keeps that list up, so the next one is a click away.
  const openQueueItem = (item: RailQueueItem) => {
    if (item.projectKey !== null) useProjectRailStore.getState().revealProject(item.projectKey);
    void navigateToThread(item.tab.ref);
  };

  const newScratchThread = () => {
    if (scratchEnvironment !== null) {
      if (isMobile) setOpenMobile(false);
      void startScratchThread(scratchEnvironment);
    } else if (noProject !== null) {
      startThreadIn(noProject);
    }
  };

  const openNoProject = () => {
    if (noProject === null) newScratchThread();
    else if (columnShown) openInColumn(noProject, newScratchThread);
    else openRailProject(noProject, newScratchThread);
  };

  const newFolder = (projectKey?: string) => {
    const folderId = randomUUID();
    change((current) =>
      createRailFolder(current, {
        folderId,
        name: "New Folder",
        ...(projectKey === undefined ? {} : { projectKey }),
      }),
    );
    renameFocusRef.current = folderId;
    setRenamingFolderId(folderId);
  };

  const actions: RailRowActions = {
    openProject: (projectKey) => {
      const project = projects.get(projectKey);
      if (!project) return;
      if (columnShown) openInColumn(project, () => startThreadIn(project));
      else openRailProject(project, () => startThreadIn(project));
    },
    newThread: (projectKey) => {
      const project = projects.get(projectKey);
      if (project) startThreadIn(project);
    },
    stepProject: (projectKey, direction) => {
      const folder = folderOf(projectKey);
      const placement =
        folder === null
          ? railStepPlacement(topIds, railProjectEntry(projectKey), null, direction)
          : railStepPlacement(folder.projectKeys, projectKey, folder.folderId, direction);
      if (placement) change((current) => moveRailProject(current, projectKey, placement));
    },
    setProjectFolder: (projectKey, folderId) => {
      const current = folderOf(projectKey)?.folderId ?? null;
      if (current === folderId) return;
      change((state) =>
        moveRailProject(
          state,
          projectKey,
          folderId !== null
            ? { folderId, anchor: null }
            : { folderId: null, anchor: { item: railFolderEntry(current!), side: "after" } },
        ),
      );
    },
    newFolder,
    toggleFolder: (folderId) =>
      change((current) =>
        setRailFolderCollapsed(current, folderId, !current.folders[folderId]?.collapsed),
      ),
    stepFolder: (folderId, direction) => {
      const placement = railStepPlacement(topIds, railFolderEntry(folderId), null, direction);
      if (placement) change((current) => moveRailFolder(current, folderId, placement.anchor));
    },
    startRename: (folderId) => {
      renameFocusRef.current = folderId;
      setRenamingFolderId(folderId);
    },
    finishRename: (folderId, name) => {
      if (name !== null) change((current) => renameRailFolder(current, folderId, name));
      renameFocusRef.current = null;
      setRenamingFolderId(null);
    },
    startProjectRename: (projectKey) => {
      renameFocusRef.current = projectKey;
      setRenamingProjectKey(projectKey);
    },
    finishProjectRename: (projectKey, name) => {
      renameFocusRef.current = null;
      setRenamingProjectKey(null);
      const group = projects.get(projectKey)?.group;
      const title = name?.trim() ?? "";
      if (!group || title === "" || title === group.displayName) return;
      void updateProjectGroup(group.memberProjects, { title }, m(msg("Failed to rename project")));
    },
    removeFolder: (folderId) => {
      const removed = snapshotRailFolder(useProjectRailStore.getState().layout, folderId);
      if (removed === null) return;
      change((current) => removeRailFolder(current, folderId));
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: m(msg("Removed {name}", { name: removed.folder.name })),
          description: m(msg("Its projects stay in the list.")),
          actionProps: {
            children: m(msg("Undo")),
            onClick: () =>
              useProjectRailStore
                .getState()
                .updateLayout(projectKeys, (current) => restoreRailFolder(current, removed)),
          },
        }),
      );
    },
    hideProject: (projectKey) => {
      const name = projects.get(projectKey)?.group.displayName ?? m(msg("Project"));
      hideProject(projectKey);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: m(msg("Hid {name}", { name })),
          description: m(msg("Find it under Hidden at the bottom of the sidebar.")),
          actionProps: {
            children: m(msg("Undo")),
            onClick: () => useProjectRailStore.getState().showProject(projectKey),
          },
        }),
      );
    },
    setFavorite: (projectKey, favorite) => setProjectFavorite(projectKey, favorite),
    restoreMenuFocus: () => renameFocusRef.current === null,
    suppressClick: () => suppressClickRef.current,
  };

  const newThreadFromHeader = () => {
    const project =
      (highlightKey === null ? undefined : projects.get(highlightKey)) ??
      (noProject !== null && highlightKey === noProject.group.projectKey ? noProject : undefined);
    if (project) startThreadIn(project);
    else openCommandPalette({ open: "new-thread-in" });
  };

  const resetDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  const trackDrop = (event: DragMoveEvent) => {
    const row = event.over?.data.current as RailDropRow | undefined;
    if (drag === null || event.over === null || row === undefined) {
      setDrop(null);
      return;
    }
    const pointer = event.activatorEvent as PointerEvent;
    const pointerY = pointer.clientY + event.delta.y;
    const { top, height } = event.over.rect;
    const y = height > 0 ? Math.min(1, Math.max(0, (pointerY - top) / height)) : 0.5;
    setDrop(resolveRailDrop(drag, row, y));
  };

  if (state === "collapsed" && !isMobile) {
    return (
      <RailCollapsed
        entries={entries}
        projects={projects}
        noProject={noProject}
        showNoProject={showNoProject}
        noProjectPosition={noProjectPosition}
        selectedProjectKey={highlightKey}
        onOpenProject={actions.openProject}
        onOpenNoProject={openNoProject}
        onToggleFolder={actions.toggleFolder}
      />
    );
  }

  const noProjectRow = showNoProject ? (
    <div
      className={cn(
        "shrink-0 px-(--sidebar-content-inset)",
        noProjectPosition === "bottom" && "pb-(--sidebar-content-inset)",
      )}
    >
      <RailNoProjectRow
        project={noProject}
        selected={noProject !== null && highlightKey === noProject.group.projectKey}
        position={noProjectPosition}
        onOpen={openNoProject}
        onNewThread={newScratchThread}
        onPositionChange={setNoProjectPosition}
      />
    </div>
  ) : null;

  const rows: ReactNode[] = [];
  entries.forEach((entry, index) => {
    const canMoveUp = index > 0;
    const canMoveDown = index < entries.length - 1;
    if (entry.kind === "project") {
      const project = projects.get(entry.projectKey);
      if (!project) return;
      rows.push(
        <RailProjectRow
          key={railProjectEntry(entry.projectKey)}
          project={project}
          favorite={favoriteProjects.includes(entry.projectKey)}
          folderId={null}
          lastRowKey={railProjectEntry(entry.projectKey)}
          selected={highlightKey === entry.projectKey}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          folders={folderChoices}
          drop={drop}
          actions={actions}
          renaming={renamingProjectKey === entry.projectKey}
        />,
      );
      return;
    }
    const lastProjectKey = entry.projectKeys.at(-1);
    const lastRowKey = entry.collapsed
      ? railFolderEntry(entry.folderId)
      : lastProjectKey === undefined
        ? `e:${entry.folderId}`
        : railProjectEntry(lastProjectKey);
    rows.push(
      <RailFolderRow
        key={railFolderEntry(entry.folderId)}
        folderId={entry.folderId}
        name={entry.name}
        collapsed={entry.collapsed}
        projectCount={entry.projectKeys.length}
        counts={folderCounts(entry.projectKeys, projects)}
        lastRowKey={lastRowKey}
        renaming={renamingFolderId === entry.folderId}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        drop={drop}
        actions={actions}
      />,
    );
    if (entry.collapsed) return;
    if (entry.projectKeys.length === 0) {
      rows.push(
        <RailEmptyFolderRow key={`e:${entry.folderId}`} folderId={entry.folderId} drop={drop} />,
      );
      return;
    }
    entry.projectKeys.forEach((projectKey, position) => {
      const project = projects.get(projectKey);
      if (!project) return;
      rows.push(
        <RailProjectRow
          key={railProjectEntry(projectKey)}
          project={project}
          favorite={favoriteProjects.includes(projectKey)}
          folderId={entry.folderId}
          lastRowKey={lastRowKey}
          selected={highlightKey === projectKey}
          canMoveUp={position > 0}
          canMoveDown={position < entry.projectKeys.length - 1}
          folders={folderChoices}
          drop={drop}
          actions={actions}
          renaming={renamingProjectKey === projectKey}
        />,
      );
    });
  });

  // Favorites in rail order, without folders; moving and dragging stay in the All view.
  const favoriteRows = railProjectOrder(entries)
    .filter((projectKey) => favoriteProjects.includes(projectKey))
    .flatMap((projectKey) => {
      const project = projects.get(projectKey);
      if (!project) return [];
      return [
        <RailProjectRow
          key={railProjectEntry(projectKey)}
          project={project}
          favorite
          draggable={false}
          folderId={null}
          menuFolderId={folderOf(projectKey)?.folderId ?? null}
          lastRowKey={railProjectEntry(projectKey)}
          selected={highlightKey === projectKey}
          canMoveUp={false}
          canMoveDown={false}
          folders={folderChoices}
          drop={null}
          actions={actions}
          renaming={renamingProjectKey === projectKey}
        />,
      ];
    });

  const allCounts = addRailCounts(
    folderCounts(projectKeys, projects),
    noProject?.counts ?? EMPTY_RAIL_COUNTS,
  );
  const allRunning =
    projectKeys.reduce((sum, key) => sum + (projects.get(key)?.running ?? 0), 0) +
    (noProject?.running ?? 0);

  const draggedLabel =
    drag === null
      ? null
      : drag.kind === "project"
        ? (projects.get(drag.projectKey)?.group.displayName ?? null)
        : (folderChoices.find((folder) => folder.folderId === drag.folderId)?.name ?? null);

  return (
    <SidebarFolderDrop>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              hasProjects={projectKeys.length > 0}
              projectScope={null}
              onNewProject={() => openCommandPalette({ open: "add-project" })}
              onNewThread={newThreadFromHeader}
              newThreadDisabled={projectKeys.length === 0 && !showNoProject}
              newThreadShortcutLabel={newThreadShortcutLabel}
              newThreadInProjectShortcutLabel={undefined}
              showNewThreadInProjectHint={false}
              searchInputRef={search.inputRef}
              searchQuery={search.query}
              onSearchQueryChange={search.setQuery}
              onSearchKeyDown={search.onKeyDown}
              isSearching={search.isSearching}
              searchResultCount={search.resultCount}
              activeSearchResultIndex={search.activeIndex}
              onClearSearch={search.clear}
            />
          </SidebarGroup>
        }
      >
        {search.isSearching ? (
          <SidebarGroup className="flex-1" role="presentation">
            {search.resultsList}
          </SidebarGroup>
        ) : null}
        {noProjectPosition === "top" && !search.isSearching ? noProjectRow : null}
        <div className={cn("px-(--sidebar-content-inset)", search.isSearching && "hidden")}>
          {columnShown ? (
            <div className="pt-2">
              <RailAllProjectsRow
                counts={allCounts}
                running={allRunning}
                detail={summarizeRailCounts(allCounts)}
                selected={highlightKey === ALL_PROJECTS_SCOPE}
                onOpen={() => column.choose(ALL_PROJECTS_SCOPE)}
              />
            </div>
          ) : (
            <RailFilterBar
              filter={filter}
              onChange={setFilter}
              counts={{
                waiting: queue.waiting.length,
                working: queue.working.length,
                done: queue.done.length,
              }}
            />
          )}
          {railFilter === "all" ? (
            <ProjectsHeader
              onNewProject={() => openCommandPalette({ open: "add-project" })}
              onNewFolder={() => newFolder()}
              favoritesOnly={favoritesOnly}
              favoriteCount={favoriteRows.length}
              onFavoritesOnlyChange={setFavoritesOnly}
              onShowThreadList={
                !threadColumnOpen && threadColumnFits(viewportWidth, false)
                  ? () => setThreadColumnOpen(true)
                  : null
              }
            />
          ) : null}
        </div>
        {railFilter !== "all" ? (
          <div
            className={cn(
              "px-(--sidebar-content-inset) pb-(--sidebar-content-inset)",
              search.isSearching && "hidden",
            )}
          >
            <RailQueueList
              kind={railFilter}
              items={queue[railFilter]}
              nowMs={queue.nowMs}
              activeKey={routeThreadKey}
              onOpen={openQueueItem}
              onClear={(items) =>
                clearFromDone(items.map((item) => ({ tab: item.tab, unread: !item.opened })))
              }
            />
          </div>
        ) : null}
        <div
          className={cn(
            "px-(--sidebar-content-inset) pb-(--sidebar-content-inset)",
            (search.isSearching || railFilter !== "all") && "hidden",
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={(event) => {
              setDrag((event.active.data.current as RailDragItem | undefined) ?? null);
            }}
            onDragMove={trackDrop}
            onDragOver={trackDrop}
            onDragEnd={() => {
              if (drag !== null && drop !== null) {
                change((current) => applyRailDrop(current, drag, drop));
              }
              resetDrag();
              suppressClickRef.current = true;
              requestAnimationFrame(() => {
                suppressClickRef.current = false;
              });
            }}
            onDragCancel={resetDrag}
          >
            {favoritesOnly ? (
              favoriteRows.length === 0 ? (
                <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">
                  <T>No favorites yet. Right-click a project and choose Add to Favorites.</T>
                </p>
              ) : (
                <ul aria-label={gt("Favorite Projects")} className="flex flex-col gap-px pt-1">
                  {favoriteRows}
                </ul>
              )
            ) : rows.length === 0 ? (
              <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">
                <T>No projects yet. Add one with the + above.</T>
              </p>
            ) : (
              <ul aria-label={gt("Projects")} className="flex flex-col gap-px">
                {rows}
              </ul>
            )}
            <DragOverlay dropAnimation={null}>
              {draggedLabel === null ? null : (
                <div className="w-fit max-w-56 truncate rounded-md bg-sidebar-row-active px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border">
                  {draggedLabel}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
        {/* At the bottom it is the list's last row and scrolls with it, never pinned over it. */}
        {noProjectPosition === "bottom" && !search.isSearching && railFilter === "all"
          ? noProjectRow
          : null}
      </SidebarContent>
      <div className="shrink-0 px-(--sidebar-content-inset) py-1">
        <RailShelves
          model={model}
          settledOpen={settledOpen}
          onSettledOpenChange={setSettledOpen}
          onOpenThread={(threadRef) => void navigateToThread(threadRef)}
          hidden={hiddenList}
          onShowProject={showProject}
          onOpenProject={(project) => actions.openProject(project.group.projectKey)}
          collapsed={shelvesCollapsed}
          onCollapsedChange={setShelvesCollapsed}
        />
      </div>
      <SidebarChromeFooter />
    </SidebarFolderDrop>
  );
}
