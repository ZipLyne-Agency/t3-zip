import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  BellOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { m } from "../../i18n/messages";
import { useComposerDraftStore, useThreadHasUnsentDraft } from "../../composerDraftStore";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useThreadActions } from "../../hooks/useThreadActions";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../../localApi";
import { useProject } from "../../state/entities";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { canShareWithGuestAtom } from "../chat/guestShareAvailability";
import {
  draftPenClassName,
  draftSurfaceClassName,
  TopStatusIcon,
} from "../sidebar/SidebarThreadRow";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { RailQueueItem } from "../rail/useRailQueue";
import { AllTabsMenu } from "./AllTabsMenu";
import { DoneQueueMenu } from "./DoneQueueMenu";
import { muteCopy } from "./threadMute.logic";
import { resolveTabRename, tabAfterClose } from "./threadTabs.logic";
import { reportThreadActionFailure, useThreadMuteActions } from "./useThreadMuteActions";
import type { DraftTabEntry, TabEntry, ThreadTabEntry } from "./useThreadTabs";

const EDGE_TOLERANCE = 2;

interface ScrollEdges {
  readonly left: boolean;
  readonly right: boolean;
}

export interface MenuRequest {
  readonly id: number;
  readonly tab: ThreadTabEntry;
  readonly position: { readonly x: number; readonly y: number };
}

export function ThreadTabStrip(props: {
  readonly tabs: ReadonlyArray<TabEntry>;
  readonly pinnedCount: number;
  readonly activeKey: string | null;
  readonly nowMs: number;
  readonly onOpen: (tab: TabEntry) => void;
  /** Finished threads in every project, oldest first. */
  readonly doneQueue: ReadonlyArray<RailQueueItem>;
  /** The open thread or draft, even when its tab is not in this strip. */
  readonly routeKey: string;
  readonly onOpenQueueItem: (item: RailQueueItem) => void;
  readonly onNewThread: () => void;
  readonly newThreadShortcut: string | null;
}) {
  const { tabs, pinnedCount, activeKey, nowMs, onOpen } = props;
  const { settleThread, confirmSettle } = useThreadActions();
  const { formatTime } = useThreadMuteActions();
  const gt = useGT();
  const resolve = useMessages();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });
  const [menuRequest, setMenuRequest] = useState<MenuRequest | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const attachViewport = (viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
    if (!viewport) return;
    const update = () => {
      const overflow = viewport.scrollWidth - viewport.clientWidth > EDGE_TOLERANCE;
      const left = overflow && viewport.scrollLeft > EDGE_TOLERANCE;
      const right =
        overflow &&
        viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - EDGE_TOLERANCE;
      setEdges((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };
    // A vertical mouse wheel scrolls the strip sideways. Horizontal input scrolls natively.
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= viewport.clientWidth;
      const before = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === before) return;
      event.preventDefault();
    };
    const content = viewport.firstElementChild;
    const stopObserving = observeResize(content ? [viewport, content] : viewport, update);
    viewport.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    update();
    return () => {
      viewportRef.current = null;
      stopObserving();
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", handleWheel);
    };
  };

  // The open thread's tab can sit outside the scrolled strip after a jump or a new thread.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the active tab's DOM node into view when the open thread changes
  useEffect(() => {
    if (activeKey === null) return;
    const tab = viewportRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  const scrollBy = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const closeTab = async (tab: TabEntry) => {
    if (tab.kind === "draft") {
      // The tab or its menu may outlive the draft's promotion to a thread; discarding then
      // would strand the send, as the classic sidebar's draft menu guards against.
      const session = useComposerDraftStore.getState().getDraftSession(tab.draftId);
      if (!session || session.promotedTo) return;
    }
    // Ask before moving to the next tab, so Cancel leaves you where you were.
    if (tab.kind !== "draft" && !(await confirmSettle([tab.ref]))) return;
    const wasOpen = tab.key === activeKey;
    if (wasOpen) {
      const nextKey = tabAfterClose(
        tabs.map((entry) => entry.key),
        tab.key,
      );
      const next = tabs.find((entry) => entry.key === nextKey);
      if (next) onOpen(next);
    }
    if (tab.kind === "draft") {
      discardComposerDraft(tab.draftId);
      return;
    }
    // Undo (mod+z or the sidebar's Undo) brings the tab back, and reopens it if it was open.
    reportThreadActionFailure(
      m(msg("Failed to settle thread")),
      await settleThread(tab.ref, {
        automationsConfirmed: true,
        ...(wasOpen ? { onUndone: () => onOpen(tab) } : {}),
      }),
    );
  };

  // The tab list is one Tab stop, on the open tab. Arrow keys move focus along the tabs, Home
  // and End jump to the ends, Enter or Space opens the focused tab and Delete closes it.
  const tabStopKey = tabs.some((tab) => tab.key === activeKey) ? activeKey : (tabs[0]?.key ?? null);
  const onTabListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const focused = event.target instanceof HTMLElement ? event.target : null;
    if (focused?.getAttribute("role") !== "tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']")];
    const index = buttons.indexOf(focused);
    if (event.key === "Delete") {
      const key = focused.closest<HTMLElement>("[data-tab-key]")?.dataset.tabKey;
      const tab = tabs.find((entry) => entry.key === key);
      if (!tab) return;
      event.preventDefault();
      // Focus moves to a neighbor first, so it is not lost with the closed tab.
      (buttons[index + 1] ?? buttons[index - 1])?.focus();
      void closeTab(tab);
      return;
    }
    const target =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    buttons[(target + buttons.length) % buttons.length]?.focus();
  };

  const openDraftMenu = async (tab: DraftTabEntry, position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        [{ id: "discard", label: m(msg("Discard Draft")), destructive: true }],
        position,
      ),
    );
    if (clicked._tag === "Success" && clicked.value === "discard") await closeTab(tab);
  };

  const onTabContextMenu = (tab: TabEntry) => (event: ReactMouseEvent) => {
    event.preventDefault();
    const position = { x: event.clientX, y: event.clientY };
    if (tab.kind === "draft") {
      void openDraftMenu(tab, position);
      return;
    }
    setMenuRequest((current) => ({ id: (current?.id ?? 0) + 1, tab, position }));
  };

  return (
    <div
      data-thread-tabs
      className="flex h-10 shrink-0 items-center gap-1 bg-background ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)"
    >
      {edges.left ? (
        <Button
          aria-label={gt("Scroll Tabs Left")}
          className="shrink-0"
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => scrollBy(-1)}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      <div
        ref={attachViewport}
        className="h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex h-full w-max min-w-full items-center gap-1">
          <div
            role="tablist"
            aria-label={gt("Open Threads")}
            className="flex h-full items-center gap-1"
            onKeyDown={onTabListKeyDown}
          >
            {tabs.map((tab, index) => {
              const chipProps = {
                active: tab.key === activeKey,
                tabStop: tab.key === tabStopKey,
                // Pinned tabs stand apart from the rest by a wider gap.
                gapBefore: index === pinnedCount && pinnedCount > 0,
                muteLabel:
                  tab.mute === null ? null : muteCopy(tab.mute, nowMs, formatTime, resolve).title,
                renaming: tab.key === renamingKey,
                onRenameDone: () => setRenamingKey(null),
                onOpen: () => onOpen(tab),
                onClose: () => void closeTab(tab),
                onContextMenu: onTabContextMenu(tab),
              };
              return tab.kind === "thread" ? (
                <ThreadTabChip key={tab.key} tab={tab} {...chipProps} />
              ) : (
                <TabChip key={tab.key} tab={tab} hasUnsentDraft {...chipProps} />
              );
            })}
          </div>
          {/* Sits right after the last tab, like a browser's, outside the tab list itself. */}
          <NewThreadTabButton onClick={props.onNewThread} shortcut={props.newThreadShortcut} />
        </div>
      </div>
      {edges.right ? (
        <Button
          aria-label={gt("Scroll Tabs Right")}
          className="shrink-0"
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => scrollBy(1)}
        >
          <ChevronRightIcon />
        </Button>
      ) : null}
      <DoneQueueMenu
        items={props.doneQueue}
        activeKey={props.routeKey}
        nowMs={nowMs}
        onOpen={props.onOpenQueueItem}
      />
      <AllTabsMenu tabs={tabs} activeKey={activeKey} nowMs={nowMs} onOpen={onOpen} />
      {menuRequest ? (
        <TabActionMenu
          key={menuRequest.id}
          request={menuRequest}
          onStartRename={() => setRenamingKey(menuRequest.tab.key)}
        />
      ) : null}
    </div>
  );
}

/** Opens the same thread menu as the sidebar and header for one tab, once per right-click. */
export function TabActionMenu(props: {
  readonly request: MenuRequest;
  readonly onStartRename: () => void;
}) {
  const { tab, position } = props.request;
  const { environmentId, projectId } = tab.thread;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(environmentId));
  const { openMenu } = useThreadActionMenu({
    threadRef: tab.ref,
    projectCwd: project?.workspaceRoot ?? null,
    onStartRename: props.onStartRename,
    canShareWithGuest,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- shows the native menu once per right-click; a new right-click remounts this under a new key
  useEffect(() => openMenu(position), []);
  return null;
}

interface TabChipProps {
  readonly tab: TabEntry;
  /** A draft-only tab is itself an unsent draft. */
  readonly hasUnsentDraft: boolean;
  readonly active: boolean;
  /** The one tab the Tab key reaches; the arrow keys reach the rest. */
  readonly tabStop: boolean;
  readonly gapBefore: boolean;
  readonly muteLabel: string | null;
  readonly renaming: boolean;
  readonly onRenameDone: () => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
}

function TabChip(props: TabChipProps) {
  const { tab, active } = props;
  // As in the sidebar, the open thread does not flag its own draft.
  const hasDraft = props.hasUnsentDraft && !active;
  const gt = useGT();
  const closeLabel = tab.kind === "draft" ? gt("Discard Draft") : gt("Settle Thread");
  const statusLabel = tab.kind === "thread" && tab.icon !== null ? tab.icon.label : null;
  const leading =
    tab.kind === "thread" && tab.icon !== null ? (
      <TopStatusIcon icon={tab.icon.icon} className={cn("size-3.5", tab.icon.className)} />
    ) : null;
  const markers: ReactNode = (
    <>
      {props.muteLabel ? (
        <Tooltip>
          <TooltipTrigger
            render={<span role="img" className="inline-flex shrink-0" />}
            aria-label={props.muteLabel}
          >
            <BellOffIcon aria-hidden className="size-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{props.muteLabel}</TooltipPopup>
        </Tooltip>
      ) : null}
      {hasDraft ? (
        <Tooltip>
          <TooltipTrigger
            render={<span role="img" className="inline-flex shrink-0" />}
            aria-label={gt("Unsent draft")}
          >
            <SquarePenIcon aria-hidden className={draftPenClassName} />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <T>Unsent draft</T>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
  const accessibleName = [
    tab.title,
    statusLabel,
    props.muteLabel,
    hasDraft ? gt("Unsent draft") : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

  return (
    <div
      data-tab-key={tab.key}
      data-active-tab={active ? "true" : "false"}
      onContextMenu={props.onContextMenu}
      className={cn(
        "group/tab flex h-7 max-w-60 shrink-0 items-center rounded-md text-sm transition duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
        props.gapBefore && "ms-2",
        active
          ? "bg-accent text-foreground"
          : hasDraft
            ? cn(draftSurfaceClassName, "text-muted-foreground hover:text-foreground")
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {props.renaming && tab.kind === "thread" ? (
        <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 ps-2.5 pe-1">
          {leading}
          <TabRenameInput tab={tab} onDone={props.onRenameDone} />
        </div>
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          aria-label={accessibleName}
          aria-keyshortcuts="Delete"
          tabIndex={props.tabStop ? 0 : -1}
          onClick={props.onOpen}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md ps-2.5 pe-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {leading}
          <span className={cn("min-w-0 truncate", tab.mute !== null && !active && "opacity-75")}>
            {tab.title}
          </span>
          {markers}
        </button>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`${closeLabel}: ${tab.title}`}
              // Delete on the tab does this from the keyboard, which keeps one Tab stop.
              tabIndex={-1}
              onClick={props.onClose}
              className={cn(
                "me-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none transition-opacity duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
                active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            />
          }
        >
          <XIcon aria-hidden className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{closeLabel}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Reads the thread's composer so a tab shows the sidebar's unsent-draft marker. */
function ThreadTabChip(
  props: Omit<TabChipProps, "hasUnsentDraft"> & { readonly tab: ThreadTabEntry },
) {
  return <TabChip {...props} hasUnsentDraft={useThreadHasUnsentDraft(props.tab.ref)} />;
}

/** Inline title editor: Enter saves, Escape cancels, and an empty title keeps the old one. */
export function TabRenameInput(props: {
  readonly tab: ThreadTabEntry;
  readonly onDone: () => void;
}) {
  const { tab, onDone } = props;
  const gt = useGT();
  const settledRef = useRef(false);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const finish = (typed: string | null) => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone();
    if (typed === null) return;
    const resolution = resolveTabRename(typed, tab.title);
    if (!resolution.save) return;
    if (!readEnvironmentScope(tab.ref.environmentId, AuthOrchestrationOperateScope)) return;
    void updateThreadMetadata({
      environmentId: tab.ref.environmentId,
      input: { threadId: tab.ref.threadId, title: resolution.title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: m(msg("Failed to rename thread")),
          description: error instanceof Error ? error.message : m(msg("An error occurred.")),
        });
      }
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    }
  };

  return (
    <input
      autoFocus
      aria-label={gt("Thread Title")}
      defaultValue={tab.title}
      data-keybinding-capture
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-5 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-foreground text-sm outline-none ring-1 ring-ring ring-inset"
    />
  );
}

function NewThreadTabButton(props: {
  readonly onClick: () => void;
  readonly shortcut: string | null;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={gt("New Thread")}
            className="shrink-0"
            size="icon-xs"
            variant="ghost-muted"
            onClick={props.onClick}
          />
        }
      >
        <PlusIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="flex items-center gap-2">
          <T>New Thread</T>
          {props.shortcut ? (
            <kbd className="font-sans text-muted-foreground">{props.shortcut}</kbd>
          ) : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
