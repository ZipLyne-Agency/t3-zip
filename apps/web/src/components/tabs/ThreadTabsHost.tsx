import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  KeybindingCommand,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { msg, useMessages } from "gt-react";
import { useEffect } from "react";

import type { DraftId } from "../../composerDraftStore";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { m } from "../../i18n/messages";
import { useStableCallback } from "../../hooks/useStableCallback";
import { threadJumpIndexFromCommand, threadTraversalDirectionFromCommand } from "../../keybindings";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { type CommandHandlers, registerCommands } from "../../shortcuts/dispatcher";
import { useThreadActions } from "../../hooks/useThreadActions";
import { registerSettleAndAdvance } from "../../settleAndAdvance";
import { threadShortcutContext } from "../Sidebar.logic";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClientSettings } from "../../hooks/useSettings";
import { nextRailQueueKey } from "../rail/railQueue.logic";
import { useProjectRailStore } from "../rail/railStore";
import { useThreadColumnShown } from "../rail/useThreadColumn";
import { buildRailQueue, type RailQueueItem } from "../rail/useRailQueue";
import {
  adjacentTabKey,
  findThreadGroup,
  tabAfterClose,
  groupMemberKeys,
  nextNeedsYouKey,
  orderGroupsByRail,
} from "./threadTabs.logic";
import { ThreadTabStrip } from "./ThreadTabStrip";
import { reportThreadActionFailure } from "./useThreadMuteActions";
import {
  buildThreadTabEntries,
  type TabEntry,
  useDraftTabs,
  useOpenTab,
  useThreadTabsSource,
} from "./useThreadTabs";

const TAB_COMMANDS: ReadonlyArray<KeybindingCommand> = [
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
  "thread.previous",
  "thread.next",
  "thread.nextNeedsYou",
  "thread.nextDone",
];

/**
 * The thread tabs above the chat, shown with the Project Rail layout. It also owns the thread
 * jump shortcuts there, since the classic sidebar that otherwise handles them is not mounted.
 */
export function ThreadTabsHost(props: ThreadTabsProps) {
  // The rail's own test: Project Rail layout at desktop width. Below that width the classic
  // sidebar mounts and keeps the thread shortcuts.
  // Read defensively: a missing or unknown value still gets the strip.
  const sidebarLayout = useClientSettings((settings) => settings.sidebarLayout);
  const desktop = useMediaQuery("md");
  if (sidebarLayout === "classic" || !desktop) return null;
  return <ThreadTabs {...props} />;
}

interface ThreadTabsProps {
  readonly project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly routeThreadRef: ScopedThreadRef;
  /** Set on a new thread's draft route; its tab is the open one. */
  readonly routeDraftId: DraftId | null;
  /** The chat header's own New Thread action, so No Project and projects start threads alike. */
  readonly onNewThread: () => void;
}

function ThreadTabs(props: ThreadTabsProps) {
  const { routeThreadRef, routeDraftId } = props;
  const routeKey =
    routeDraftId === null ? scopedThreadKey(routeThreadRef) : `draft:${routeDraftId}`;
  const source = useThreadTabsSource();
  const columnShown = useThreadColumnShown();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openTab = useOpenTab();
  const group = findThreadGroup(source.groups, props.project);
  const projectKeys =
    group === null
      ? new Set([`${props.project.environmentId}:${props.project.projectId}`])
      : groupMemberKeys(group);
  const resolve = useMessages();
  const threadTabs = buildThreadTabEntries(source, projectKeys, resolve);
  const drafts = useDraftTabs(projectKeys, routeDraftId);
  const { pinnedCount } = threadTabs;
  // New threads open right after the pinned tabs, so drafts sit there too.
  const tabs: TabEntry[] = [
    ...threadTabs.tabs.slice(0, pinnedCount),
    ...drafts,
    ...threadTabs.tabs.slice(pinnedCount),
  ];
  const activeKey = tabs.some((tab) => tab.key === routeKey) ? routeKey : null;
  const doneQueue = buildRailQueue(source).done;

  // Opens a thread from the Done list in its own project, revealing that project in the rail.
  const openQueueItem = (item: RailQueueItem) => {
    if (item.projectKey !== null) useProjectRailStore.getState().revealProject(item.projectKey);
    void openTab(item.tab);
  };

  const openNextDone = () => {
    const key = nextRailQueueKey(doneQueue, routeKey);
    const item = doneQueue.find((entry) => entry.key === key);
    if (!item) return false;
    openQueueItem(item);
    return true;
  };

  const openTabKey = (key: string | null, list: ReadonlyArray<TabEntry>) => {
    const tab = key === null ? undefined : list.find((entry) => entry.key === key);
    if (!tab) return false;
    if (tab.key !== routeKey) void openTab(tab);
    return true;
  };

  // Projects in rail order, each project's tabs in tab order; reveals the project in the rail.
  const openNextNeedsYou = () => {
    const rail = useProjectRailStore.getState();
    const ordered = orderGroupsByRail(source.groups, rail.layout, rail.noProjectPosition);
    const all = ordered.flatMap((projectGroup) =>
      buildThreadTabEntries(source, groupMemberKeys(projectGroup), resolve).tabs.map((tab) => ({
        tab,
        projectKey: projectGroup.projectKey,
      })),
    );
    const key = nextNeedsYouKey(
      all.map((entry) => entry.tab.key),
      new Set(all.filter((entry) => entry.tab.status === "needs").map((entry) => entry.tab.key)),
      routeKey,
    );
    const target = all.find((entry) => entry.tab.key === key);
    if (!target) return false;
    rail.revealProject(target.projectKey);
    void openTab(target.tab);
    return true;
  };

  const runCommand = useStableCallback((command: KeybindingCommand) => {
    if (command === "thread.nextNeedsYou") return openNextNeedsYou();
    if (command === "thread.nextDone") return openNextDone();
    const keys = tabs.map((tab) => tab.key);
    const direction = threadTraversalDirectionFromCommand(command);
    if (direction !== null) return openTabKey(adjacentTabKey(keys, activeKey, direction), tabs);
    const index = threadJumpIndexFromCommand(command);
    return index === null ? false : openTabKey(keys[index] ?? null, tabs);
  });

  const readContext = useStableCallback(() => threadShortcutContext(routeThreadRef));

  // Settle from the thread itself (its shortcut or status line) moves on to the next tab, like
  // closing the tab, instead of leaving you on the settled thread.
  const { settleThread, confirmSettle } = useThreadActions();
  const settleAndAdvance = useStableCallback(async (ref: ScopedThreadRef) => {
    // Ask before moving to the next tab, so Cancel leaves you where you were.
    if (!(await confirmSettle([ref]))) return;
    const key = scopedThreadKey(ref);
    const closing = key === routeKey ? tabs.find((tab) => tab.key === key) : undefined;
    if (key === routeKey) {
      openTabKey(
        tabAfterClose(
          tabs.map((tab) => tab.key),
          key,
        ),
        tabs,
      );
    }
    const reopen = closing ? { onUndone: () => void openTab(closing) } : {};
    void settleThread(ref, { automationsConfirmed: true, ...reopen }).then((result) =>
      reportThreadActionFailure(m(msg("Failed to settle thread")), result),
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the tabs' settle handler in the module-level settleAndAdvance registry
  useEffect(() => registerSettleAndAdvance(settleAndAdvance), [settleAndAdvance]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the tab shortcuts with the app's keybinding dispatcher while the strip is mounted
  useEffect(() => {
    const handlers: CommandHandlers = {};
    for (const command of TAB_COMMANDS) {
      handlers[command] = (event) => {
        if (!runCommand(command)) return false;
        event.preventDefault();
        event.stopPropagation();
      };
    }
    return registerCommands(handlers, {
      when: (event) =>
        !event.repeat &&
        !isCommandPaletteOpen() &&
        !isModelPickerOpen() &&
        !(event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]")),
      context: readContext,
    });
  }, [runCommand, readContext]);

  // The thread column lists the same threads beside the rail, so the strip steps aside while
  // it shows. This component still owns the thread shortcuts, so it stays mounted.
  if (columnShown) return null;
  return (
    <ThreadTabStrip
      tabs={tabs}
      pinnedCount={pinnedCount}
      activeKey={activeKey}
      nowMs={source.nowMs}
      onOpen={(tab) => void openTab(tab)}
      doneQueue={doneQueue}
      routeKey={routeKey}
      onOpenQueueItem={openQueueItem}
      onNewThread={props.onNewThread}
      newThreadShortcut={shortcutLabelForCommand(keybindings, "chat.new")}
    />
  );
}
