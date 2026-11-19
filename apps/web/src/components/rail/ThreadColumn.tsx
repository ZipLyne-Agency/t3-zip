import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { msg, useGT, useMessages } from "gt-react";
import { useShallow } from "zustand/react/shallow";
import {
  BellOffIcon,
  CheckCheckIcon,
  CheckIcon,
  LayoutGridIcon,
  PanelLeftCloseIcon,
  PinIcon,
  SquarePenIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { Fragment, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { threadHasUnsentDraft, useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { m } from "../../i18n/messages";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { ProjectFavicon } from "../ProjectFavicon";
import { draftPenClassName, TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { TabActionMenu, TabRenameInput, type MenuRequest } from "../tabs/ThreadTabStrip";
import { muteCopy } from "../tabs/threadMute.logic";
import { groupMemberKeys } from "../tabs/threadTabs.logic";
import { reportThreadActionFailure, useThreadMuteActions } from "../tabs/useThreadMuteActions";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  buildThreadTabEntries,
  useDraftTabs,
  useOpenTab,
  useThreadTabsSource,
  type DraftTabEntry,
  type TabEntry,
  type ThreadTabEntry,
} from "../tabs/useThreadTabs";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ClearAllButton, RAIL_FILTER_EMPTY_COPY, RailFilterBar } from "./RailFilters";
import { NoProjectChip } from "./RailRows";
import { railQueueAge, railQueueSinceMs } from "./railQueue.logic";
import { type RailFilter, useProjectRailStore } from "./railStore";
import { useUiStateStore } from "../../uiStateStore";
import {
  backgroundRunningCount,
  resolveDoneSection,
  type DoneSection,
  type OpenThreadStatus,
} from "./railStatus.logic";
import {
  ALL_PROJECTS_SCOPE,
  buildThreadColumnSections,
  countThreadColumnFilters,
  groupThreadColumnItemsByProject,
  nextThreadAfterRemoval,
  THREAD_COLUMN_WIDTH,
  threadColumnAge,
  type ThreadColumnItem,
} from "./threadColumn.logic";
import { useClearFromDone } from "./useClearFromDone";
import { useSnoozedProjectKeys } from "./useProjectSnooze";
import { useThreadColumnScope, useThreadColumnShown } from "./useThreadColumn";
import "./projectRailDepth.css";

type ColumnEntry = ThreadColumnItem & {
  readonly tab: TabEntry;
  /** The rail key of the thread's project; drafts share one key since they list on their own. */
  readonly projectKey: string;
  /** The project, used for its name and favicon when the column lists every project. */
  readonly group: SidebarProjectSnapshot | null;
};

const DRAFT_PROJECT_KEY = "draft";

function parseMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function threadEntry(
  tab: ThreadTabEntry,
  group: SidebarProjectSnapshot | null,
  hasDraft: boolean,
  status: OpenThreadStatus = tab.status,
  doneSection: DoneSection | null = null,
): ColumnEntry {
  const updatedMs = parseMs(tab.thread.updatedAt);
  return {
    key: tab.key,
    kind: "thread",
    status,
    pinned: tab.pinned,
    updatedMs,
    sinceMs: status === "idle" ? updatedMs : railQueueSinceMs(tab.thread, status),
    hasDraft,
    doneSection,
    tab,
    projectKey: group?.projectKey ?? `${tab.thread.environmentId}:${tab.thread.projectId}`,
    group,
  };
}

function draftEntry(tab: DraftTabEntry): ColumnEntry {
  return {
    key: tab.key,
    kind: "draft",
    status: "idle",
    pinned: false,
    updatedMs: 0,
    sinceMs: 0,
    hasDraft: false,
    doneSection: null,
    tab,
    projectKey: DRAFT_PROJECT_KEY,
    group: null,
  };
}

/**
 * The thread at the top of a project's column under All: what needs you, then what is running,
 * pinned, and the newest. Null when the project has no open thread.
 */
export function firstColumnThread(
  source: ReturnType<typeof useThreadTabsSource>,
  group: SidebarProjectSnapshot,
): ThreadTabEntry | null {
  const tabs = buildThreadTabEntries(source, new Set(groupMemberKeys(group))).tabs;
  const sections = buildThreadColumnSections(
    tabs.map((tab) => threadEntry(tab, group, false)),
    "all",
    source.nowMs,
  );
  const first = sections[0]?.items[0];
  return first?.tab.kind === "thread" ? first.tab : null;
}

function groupName(group: SidebarProjectSnapshot, gt: ReturnType<typeof useGT>): string {
  return group.isScratch ? gt("No Project") : group.displayName;
}

/** A project's heading inside a section when the column lists every project. */
function ProjectSubheader(props: {
  readonly group: SidebarProjectSnapshot | null;
  readonly count: number;
}) {
  const gt = useGT();
  const name = props.group === null ? gt("Unknown Project") : groupName(props.group, gt);
  return (
    <h4 className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-2xs font-medium text-sidebar-muted-foreground">
      {props.group === null ? null : props.group.isScratch ? (
        <NoProjectChip className="size-3.5 text-3xs" />
      ) : (
        <ProjectFavicon project={props.group} className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="tabular-nums">{props.count}</span>
    </h4>
  );
}

function ScopeMark(props: { readonly group: SidebarProjectSnapshot | null }) {
  if (props.group === null) {
    return (
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-sidebar-row-active text-sidebar-muted-foreground"
      >
        <LayoutGridIcon className="size-3" />
      </span>
    );
  }
  if (props.group.isScratch) return <NoProjectChip className="size-5 text-3xs" />;
  return <ProjectFavicon project={props.group} className="size-5 shrink-0" />;
}

function HeaderButton(props: {
  readonly label: string;
  readonly shortcut?: string | null;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={props.label}
            className="shrink-0"
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="flex items-center gap-2">
          {props.label}
          {props.shortcut ? (
            <kbd className="font-sans text-muted-foreground">{props.shortcut}</kbd>
          ) : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

/** The row's one hover action, over its time: Settle, or Clear under Done. */
const HOVER_ACTION_CLASS_NAME =
  "absolute top-1.5 right-1.5 inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-sidebar-muted-foreground opacity-0 outline-none transition-opacity duration-100 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-hover/column-row:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100";

function ColumnRow(props: {
  readonly entry: ColumnEntry;
  readonly active: boolean;
  /** Whether the row names its project; off under a project heading. */
  readonly showProject: boolean;
  readonly nowMs: number;
  readonly muteLabel: string | null;
  readonly renaming: boolean;
  readonly onOpen: () => void;
  /** Settles the thread; undone with mod+z or the sidebar's Undo. Null for drafts. */
  readonly onSettle: (() => void) | null;
  /** Clears the thread from Done, which then offers this in place of Settle. */
  readonly onClear: (() => void) | null;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
  readonly onRenameDone: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const { entry, active } = props;
  const tab = entry.tab;
  const projectName = props.showProject && entry.group !== null ? groupName(entry.group, gt) : null;
  const icon = tab.kind === "thread" ? tab.icon : null;
  const shortAge = railQueueAge(entry.sinceMs, props.nowMs);
  const age = threadColumnAge(shortAge, resolve);
  const status =
    tab.kind === "draft"
      ? gt("Draft", { $context: "unsent thread" })
      : icon
        ? gt("{label} {age}", { label: icon.label, age: age.toLowerCase() })
        : age;
  // Working already says the thread is busy; otherwise name what is still running.
  const running =
    tab.kind === "thread" && entry.status !== "working" ? backgroundRunningCount(tab.thread) : 0;
  const runningLabel = running > 0 ? gt("{count} running in background", { count: running }) : null;
  const leading = (
    <span className="flex h-5 w-4 shrink-0 items-center justify-center">
      {tab.kind === "draft" ? (
        <SquarePenIcon aria-hidden className="size-3.5 text-sidebar-muted-foreground" />
      ) : icon ? (
        <TopStatusIcon icon={icon.icon} className={cn("size-3.5", icon.className)} />
      ) : null}
    </span>
  );
  const rowClassName = cn(
    "flex w-full items-start gap-2 rounded-md px-(--sidebar-row-content-inset) py-1.5 text-left",
    active
      ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
      : "text-sidebar-foreground hover:bg-sidebar-row-hover",
  );
  if (props.renaming && tab.kind === "thread") {
    return (
      <li className="list-none">
        <div className={rowClassName}>
          {leading}
          <TabRenameInput tab={tab} onDone={props.onRenameDone} />
        </div>
      </li>
    );
  }
  const detailParts: { readonly key: string; readonly node: ReactNode }[] = [];
  if (tab.kind === "draft") {
    detailParts.push({
      key: "draft",
      node: <span className="shrink-0">{gt("Draft", { $context: "unsent thread" })}</span>,
    });
  } else if (icon) {
    detailParts.push({ key: "status", node: <span className="shrink-0">{icon.label}</span> });
  }
  if (runningLabel !== null) {
    detailParts.push({
      key: "running",
      node: (
        <span className="flex shrink-0 items-center gap-1 text-info-foreground">
          <SquareTerminalIcon aria-hidden className="size-3" />
          {gt("{count} running", { count: running })}
        </span>
      ),
    });
  }
  if (projectName !== null) {
    detailParts.push({
      key: "project",
      node: <span className="min-w-0 truncate">{projectName}</span>,
    });
  }
  const accessibleName = [
    tab.title,
    status,
    runningLabel,
    projectName,
    entry.hasDraft ? gt("Unsent draft") : null,
    entry.pinned ? gt("Pinned") : null,
    props.muteLabel,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <li className="group/column-row relative list-none">
      <button
        type="button"
        aria-label={accessibleName}
        aria-current={active ? "page" : undefined}
        onClick={props.onOpen}
        onContextMenu={props.onContextMenu}
        className={cn(
          rowClassName,
          "cursor-pointer outline-none select-none transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
        )}
      >
        {leading}
        <span className="flex min-w-0 flex-1 flex-col">
          {/* The title and its time share the first line, as in a mail list. */}
          <span className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 text-sm leading-5",
                // A draft's title is its prompt, rewritten on every keystroke, so it stays on one
                // line; wrapping would grow the row while typing and shift the list below it.
                tab.kind === "draft"
                  ? "truncate text-sidebar-muted-foreground italic"
                  : "break-words",
              )}
            >
              {tab.title}
            </span>
            <span
              className={cn(
                "flex h-5 shrink-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground",
                // The Settle button takes this spot on hover.
                (props.onSettle !== null || props.onClear !== null) &&
                  "group-hover/column-row:invisible group-focus-within/column-row:invisible",
              )}
            >
              {entry.hasDraft ? (
                <SquarePenIcon
                  role="img"
                  aria-label={gt("Unsent draft")}
                  className={draftPenClassName}
                />
              ) : null}
              {entry.pinned ? (
                <PinIcon role="img" aria-label={gt("Pinned")} className="size-3" />
              ) : null}
              {props.muteLabel !== null ? (
                <BellOffIcon role="img" aria-label={props.muteLabel} className="size-3" />
              ) : null}
              {tab.kind === "thread" ? (
                <span className="tabular-nums">
                  {shortAge === "now"
                    ? gt("Now", { $context: "age of a thread that just finished" })
                    : shortAge}
                </span>
              ) : null}
            </span>
          </span>
          {/* A second line only when there is something to say beyond the time. */}
          {detailParts.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 text-xs leading-4 text-sidebar-muted-foreground">
              {detailParts.map((part, index) => (
                <Fragment key={part.key}>
                  {index > 0 ? <span aria-hidden>·</span> : null}
                  {part.node}
                </Fragment>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      {props.onClear !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Clear {title}", { title: tab.title })}
                onClick={props.onClear}
                className={HOVER_ACTION_CLASS_NAME}
              />
            }
          >
            <CheckCheckIcon aria-hidden className="size-3" />
            {gt("Clear", { $context: "button that clears a thread from Done" })}
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Clear from Done")}</TooltipPopup>
        </Tooltip>
      ) : props.onSettle !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Settle {title}", { title: tab.title })}
                onClick={props.onSettle}
                className={HOVER_ACTION_CLASS_NAME}
              />
            }
          >
            <CheckIcon aria-hidden className="size-3" />
            {gt("Settle", { $context: "button that settles a thread" })}
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Settle Thread")}</TooltipPopup>
        </Tooltip>
      ) : null}
    </li>
  );
}

/**
 * The second column of the Project Rail layout: the threads of the project picked in the rail
 * (or of every project), grouped by what needs you and then by day. It sits between the rail
 * and the chat, so folding the rail keeps it, and it hides when the window has no room for it.
 */
export function ThreadColumn() {
  const shown = useThreadColumnShown();
  if (!shown) return null;
  return <ThreadColumnPanel />;
}

function ThreadColumnPanel() {
  const gt = useGT();
  const resolve = useMessages();
  const column = useThreadColumnScope();
  const source = useThreadTabsSource();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openTab = useOpenTab();
  // A filter belongs to the project it was picked in. Any other project, whether picked in the
  // rail or reached through a tab or link, opens on All. All Projects has no All filter (every
  // thread at once is no help there), so it opens on Waiting.
  const [picked, setPicked] = useState<{ readonly scope: string; readonly filter: RailFilter }>({
    scope: column.scope,
    filter: "all",
  });
  const defaultFilter: RailFilter = column.scope === ALL_PROJECTS_SCOPE ? "waiting" : "all";
  const pickedFilter = picked.scope === column.scope ? picked.filter : defaultFilter;
  const filter =
    column.scope === ALL_PROJECTS_SCOPE && pickedFilter === "all" ? "waiting" : pickedFilter;
  const setFilter = (next: RailFilter) => setPicked({ scope: column.scope, filter: next });
  const setThreadColumnOpen = useProjectRailStore((store) => store.setThreadColumnOpen);
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const { formatTime } = useThreadMuteActions();
  const { settleThread } = useThreadActions();
  const [menuRequest, setMenuRequest] = useState<MenuRequest | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const clearedAtById = useUiStateStore((state) => state.threadDoneClearedAtById);
  const doneReviewSince = useUiStateStore((state) => state.doneReviewSince);
  const clearFromDone = useClearFromDone();
  const snoozedProjectKeys = useSnoozedProjectKeys();
  // Opening a Done thread from the column marks it seen, which would drop it from Done under
  // the cursor. The opened thread keeps the place it was clicked in while it stays open.
  const [held, setHeld] = useState<{ readonly key: string; readonly status: OpenThreadStatus }>();
  // Leaving the held thread lets it go, so coming back to it later shows where it really is.
  const [heldRoute, setHeldRoute] = useState(column.routeKey);
  if (heldRoute !== column.routeKey) {
    setHeldRoute(column.routeKey);
    if (held !== undefined && held.key !== column.routeKey) setHeld(undefined);
  }

  const allScope = column.scope === ALL_PROJECTS_SCOPE;
  const group = allScope
    ? null
    : (column.groups.find((candidate) => candidate.projectKey === column.scope) ?? null);
  const memberKeys = new Set(
    (group === null ? column.groups : [group]).flatMap((member) => [...groupMemberKeys(member)]),
  );
  const groupByMember = new Map<string, SidebarProjectSnapshot>();
  for (const member of column.groups) {
    for (const key of groupMemberKeys(member)) groupByMember.set(key, member);
  }
  // Muted threads stay off the column; the Muted shelf lists them. All Projects also leaves out
  // snoozed projects until they wake.
  const threadTabs = buildThreadTabEntries(
    source,
    allScope ? null : memberKeys,
    resolve,
  ).tabs.filter(
    (tab) =>
      tab.mute === null &&
      !(
        allScope &&
        snoozedProjectKeys.has(
          groupByMember.get(`${tab.thread.environmentId}:${tab.thread.projectId}`)?.projectKey ??
            "",
        )
      ),
  );
  const drafts = useDraftTabs(memberKeys, column.routeDraftId);
  // As in the sidebar and the tabs, the open thread does not flag its own draft.
  const draftedKeys = new Set(
    useComposerDraftStore(
      useShallow((state) =>
        threadTabs
          .filter((tab) => tab.key !== column.routeKey && threadHasUnsentDraft(state, tab.ref))
          .map((tab) => tab.key),
      ),
    ),
  );
  const entries: ColumnEntry[] = [
    ...drafts.map(draftEntry),
    ...threadTabs.map((tab) => {
      const status =
        held !== undefined &&
        held.key === tab.key &&
        tab.key === column.routeKey &&
        tab.status === "idle" &&
        tab.mute === null
          ? held.status
          : tab.status;
      return threadEntry(
        tab,
        groupByMember.get(`${tab.thread.environmentId}:${tab.thread.projectId}`) ?? null,
        draftedKeys.has(tab.key),
        status,
        resolveDoneSection(
          status,
          tab.mute !== null,
          tab.thread,
          clearedAtById[tab.key],
          doneReviewSince,
        ),
      );
    }),
  ];
  const sections = buildThreadColumnSections(entries, filter, source.nowMs);
  const counts = countThreadColumnFilters(entries);
  const renderRow = (entry: ColumnEntry, showProject: boolean) => (
    <ColumnRow
      key={entry.key}
      entry={entry}
      active={entry.key === column.routeKey}
      showProject={showProject}
      nowMs={source.nowMs}
      muteLabel={
        entry.tab.kind === "thread" && entry.tab.mute !== null
          ? muteCopy(entry.tab.mute, source.nowMs, formatTime).title
          : null
      }
      renaming={renamingKey === entry.key}
      onOpen={() => open(entry)}
      onSettle={entry.tab.kind === "thread" ? () => settle(entry) : null}
      onClear={filter === "done" && entry.doneSection !== null ? () => clear([entry]) : null}
      onContextMenu={onContextMenu(entry)}
      onRenameDone={() => setRenamingKey(null)}
    />
  );
  const openCount = threadTabs.length;

  const title = group === null ? gt("All Projects") : groupName(group, gt);
  const summary = [
    counts.waiting > 0
      ? gt("{count, plural, one {{count} needs you} other {{count} need you}}", {
          count: counts.waiting,
        })
      : null,
    counts.working > 0 ? gt("{count} working", { count: counts.working }) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const detail =
    summary !== ""
      ? summary
      : openCount === 0
        ? gt("No open threads")
        : gt("{count, plural, one {{count} open thread} other {{count} open threads}}", {
            count: openCount,
          });

  const newThread = () => {
    if (group === null) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    const scratchEnvironment = group.isScratch ? scratchEnvironmentId(group.environmentId) : null;
    if (scratchEnvironment !== null) void startScratchThread(scratchEnvironment);
    else void handleNewThread(scopeProjectRef(group.environmentId, group.id));
  };

  const open = (entry: ColumnEntry) => {
    // Opening a thread from the column keeps the column on the list it came from.
    column.keepWhileOpening(entry.key);
    setHeld({ key: entry.key, status: entry.status });
    void openTab(entry.tab);
  };

  // The list top to bottom as it shows: every project splits each section by project.
  const shownOrder = () =>
    sections
      .flatMap((section) =>
        allScope && section.id !== "drafts"
          ? groupThreadColumnItemsByProject(section.items).flatMap(
              (projectGroup) => projectGroup.items,
            )
          : section.items,
      )
      .filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index);

  const settle = (entry: ColumnEntry) => {
    if (entry.tab.kind !== "thread") return;
    const tab = entry.tab;
    const wasOpen = entry.key === column.routeKey;
    // Move to the next thread in the list, as closing a tab does.
    const next = nextThreadAfterRemoval(shownOrder(), new Set([entry.key]), column.routeKey);
    if (next !== null) open(next);
    void settleThread(tab.ref, wasOpen ? { onUndone: () => void openTab(tab) } : undefined).then(
      (result) => reportThreadActionFailure(m(msg("Failed to settle thread")), result),
    );
  };

  const clear = (cleared: readonly ColumnEntry[]) => {
    // A thread held in place after it was opened is let go, so clearing it takes effect now.
    if (held !== undefined && cleared.some((entry) => entry.key === held.key)) setHeld(undefined);
    // Clearing the open thread moves on to the next one in the list, as Settle does.
    const next = nextThreadAfterRemoval(
      shownOrder(),
      new Set(cleared.map((entry) => entry.key)),
      column.routeKey,
    );
    if (next !== null) open(next);
    clearFromDone(
      cleared.flatMap((entry) =>
        // The thread's own read state, not the status a held row shows.
        entry.tab.kind === "thread" && entry.doneSection !== null
          ? [{ tab: entry.tab, unread: entry.tab.status === "done" }]
          : [],
      ),
    );
  };

  const onContextMenu = (entry: ColumnEntry) => (event: ReactMouseEvent) => {
    if (entry.tab.kind !== "thread") return;
    event.preventDefault();
    const tab = entry.tab;
    setMenuRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      tab,
      position: { x: event.clientX, y: event.clientY },
    }));
  };

  const emptyCopy =
    filter === "all"
      ? group === null
        ? gt("No open threads in any project.")
        : gt("No open threads in this project.")
      : resolve(RAIL_FILTER_EMPTY_COPY[filter]);

  return (
    <aside
      {...workspaceAreaProps("thread-column", 1, gt("Thread List"))}
      data-thread-column=""
      style={{ width: THREAD_COLUMN_WIDTH }}
      className="flex h-dvh min-h-0 shrink-0 flex-col bg-sidebar surface-grain text-sidebar-foreground outline-none"
    >
      <header
        className={cn(
          "flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pr-2 pl-(--thread-column-header-left)",
          isElectron && "drag-region",
        )}
      >
        <ScopeMark group={group} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm leading-5 font-semibold">{title}</h2>
          <p className="truncate text-2xs leading-4 text-sidebar-muted-foreground">{detail}</p>
        </div>
        <HeaderButton
          label={gt("New Thread")}
          shortcut={shortcutLabelForCommand(keybindings, "chat.new")}
          onClick={newThread}
        >
          <SquarePenIcon aria-hidden />
        </HeaderButton>
        <HeaderButton label={gt("Hide Thread List")} onClick={() => setThreadColumnOpen(false)}>
          <PanelLeftCloseIcon aria-hidden />
        </HeaderButton>
      </header>
      <div className="shrink-0 border-b border-(--rail-divider,var(--sidebar-border)) px-2 pb-2">
        <RailFilterBar filter={filter} onChange={setFilter} counts={counts} showAll={!allScope} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-xs text-sidebar-muted-foreground">{emptyCopy}</p>
            {filter === "all" ? (
              <Button variant="outline" size="xs" onClick={newThread}>
                <SquarePenIcon aria-hidden />
                {gt("New Thread")}
              </Button>
            ) : null}
          </div>
        ) : (
          sections.map((section) => (
            <section key={section.id} aria-label={resolve(section.label)} className="pt-2">
              <h3 className="flex items-center justify-between gap-2 px-2 pb-1 text-xs font-medium text-sidebar-muted-foreground">
                <span>{resolve(section.label)}</span>
                <span className="flex items-center gap-2">
                  {section.id === "new" || section.id === "opened" ? (
                    <ClearAllButton
                      section={resolve(section.label)}
                      onClick={() => clear(section.items)}
                    />
                  ) : null}
                  <span className="tabular-nums">{section.items.length}</span>
                </span>
              </h3>
              {allScope && section.id !== "drafts" ? (
                // Every project is listed, so each section splits by project under its own heading.
                groupThreadColumnItemsByProject(section.items).map((projectGroup) => (
                  <section
                    key={projectGroup.projectKey}
                    aria-label={
                      projectGroup.items[0]?.group
                        ? groupName(projectGroup.items[0].group, gt)
                        : undefined
                    }
                  >
                    <ProjectSubheader
                      group={projectGroup.items[0]?.group ?? null}
                      count={projectGroup.items.length}
                    />
                    <ul className="flex flex-col gap-px">
                      {projectGroup.items.map((entry) => renderRow(entry, false))}
                    </ul>
                  </section>
                ))
              ) : (
                <ul className="flex flex-col gap-px">
                  {section.items.map((entry) => renderRow(entry, allScope))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
      {menuRequest ? (
        <TabActionMenu
          key={menuRequest.id}
          request={menuRequest}
          onStartRename={() => setRenamingKey(menuRequest.tab.key)}
        />
      ) : null}
    </aside>
  );
}
