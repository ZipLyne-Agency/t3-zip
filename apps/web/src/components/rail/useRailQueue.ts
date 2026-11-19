import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarRowStatus } from "../Sidebar.logic";
import type { ThreadTabsSource, ThreadTabEntry } from "../tabs/useThreadTabs";
import { buildThreadTabEntries, useThreadTabsSource } from "../tabs/useThreadTabs";
import { findThreadGroup } from "../tabs/threadTabs.logic";
import {
  railQueueKind,
  railQueueSinceMs,
  sortRailQueue,
  type RailQueueEntry,
  type RailQueueState,
  type RailWaitingReason,
} from "./railQueue.logic";
import { resolveDoneSection } from "./railStatus.logic";
import { useSnoozedProjectKeys } from "./useProjectSnooze";

export type RailQueueItem = RailQueueEntry<ThreadTabEntry["thread"]> & {
  readonly tab: ThreadTabEntry;
};

export interface RailQueue {
  /** Needs you or failed, oldest first. */
  readonly waiting: readonly RailQueueItem[];
  /** Running now, the latest started first. */
  readonly working: readonly RailQueueItem[];
  /** Finished and not cleared, oldest first; opened ones are marked. */
  readonly done: readonly RailQueueItem[];
  readonly nowMs: number;
}

function waitingReason(tab: ThreadTabEntry): RailWaitingReason | null {
  if (tab.status === "failed") return "failed";
  if (tab.status !== "needs") return null;
  const status = resolveSidebarRowStatus(tab.thread);
  return status === "approval" || status === "request" || status === "limited" ? status : "input";
}

/** What Done needs to keep an opened thread until it is cleared. */
export interface RailDoneClears {
  readonly clearedAtById: Readonly<Record<string, string>>;
  readonly reviewSince: string | null;
}

/**
 * Every open thread waiting on you, running or finished, across all projects (hidden ones too,
 * so nothing that needs you goes unseen). It reads the same statuses the tabs show, and Done
 * keeps a finished thread you opened until you clear it. Without `clears` Done lists only
 * threads not opened yet, as the next-Done shortcut wants.
 */
export function buildRailQueue(source: ThreadTabsSource, clears?: RailDoneClears): RailQueue {
  const lists: Record<"waiting" | "working" | "done", RailQueueItem[]> = {
    waiting: [],
    working: [],
    done: [],
  };
  for (const tab of buildThreadTabEntries(source, null).tabs) {
    // Muted threads stay off the lists; the Muted shelf lists them.
    if (tab.mute !== null) continue;
    // Without clears, Done is only what you have not opened, as the next-Done shortcut wants.
    const section =
      clears === undefined
        ? tab.status === "done"
          ? "new"
          : null
        : resolveDoneSection(
            tab.status,
            tab.mute !== null,
            tab.thread,
            clears.clearedAtById[tab.key],
            clears.reviewSince,
          );
    if ((tab.status === "idle" || tab.status === "done") && section === null) continue;
    const opened = section === "opened";
    const state: RailQueueState = tab.status === "idle" ? "done" : tab.status;
    const group = findThreadGroup(source.groups, tab.thread);
    lists[railQueueKind(state)].push({
      key: tab.key,
      thread: tab.thread,
      tab,
      state,
      projectKey: group?.projectKey ?? null,
      projectName: group === null ? null : group.isScratch ? "No Project" : group.displayName,
      sinceMs: railQueueSinceMs(tab.thread, state),
      reason: waitingReason(tab),
      opened,
    });
  }
  return {
    waiting: sortRailQueue(lists.waiting),
    working: sortRailQueue(lists.working).toReversed(),
    done: sortRailQueue(lists.done),
    nowMs: source.nowMs,
  };
}

/** The rail's lists, without the threads of projects snoozed right now. */
export function useRailQueue(): RailQueue {
  const clearedAtById = useUiStateStore((state) => state.threadDoneClearedAtById);
  const reviewSince = useUiStateStore((state) => state.doneReviewSince);
  const snoozed = useSnoozedProjectKeys();
  const queue = buildRailQueue(useThreadTabsSource(), { clearedAtById, reviewSince });
  if (snoozed.size === 0) return queue;
  const awake = (item: RailQueueItem) => item.projectKey === null || !snoozed.has(item.projectKey);
  return {
    waiting: queue.waiting.filter(awake),
    working: queue.working.filter(awake),
    done: queue.done.filter(awake),
    nowMs: queue.nowMs,
  };
}
