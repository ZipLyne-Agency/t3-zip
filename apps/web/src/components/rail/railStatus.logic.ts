import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  openThreadStatusFromRow,
  type OpenThreadStatus,
} from "@t3tools/client-runtime/state/thread-status-filter";
import { isThreadMuted } from "@t3tools/shared/threadMute";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export {
  isAwaitingClear,
  resolveDoneSection,
  type DoneSection,
  type OpenThreadStatus,
} from "@t3tools/client-runtime/state/thread-status-filter";
import { hasUnseenCompletion, resolveSidebarRowStatus } from "../Sidebar.logic";

/**
 * A thread the rail and the tab strip count: not archived, snoozed or settled. Delegated
 * children are filtered before this, like the classic list. Snooze and settle only apply once
 * the environment's config is loaded, as in the classic sidebar.
 */
export function isRailOpenThread(
  thread: Parameters<typeof effectiveSnoozed>[0] &
    Pick<EnvironmentThreadShell, "archivedAt" | "settledOverride">,
  input: { readonly nowIso: string; readonly configLoaded: boolean },
): boolean {
  if (thread.archivedAt !== null) return false;
  if (!input.configLoaded) return true;
  if (thread.settledOverride === "settled") return false;
  return !effectiveSnoozed(thread, { now: input.nowIso });
}

/**
 * Commands and monitors still running after the agent's turn ended that it did not say it
 * waits on, such as a test run or a dev server. They do not make the thread Working, since a
 * dev server can run for days, but the thread list names them so they are not hidden.
 */
export function backgroundRunningCount(
  thread: Pick<EnvironmentThreadShell, "pendingBackgroundTasks">,
): number {
  const tasks = thread.pendingBackgroundTasks ?? [];
  if (backgroundWorkHoldsCompletion(tasks)) return 0;
  return tasks.filter((task) => task.kind === "command" || task.kind === "monitor").length;
}

/**
 * An open thread's status, from the sidebar's row status. One rule for the tabs, the rail's
 * counts and dots, and the filters, so they always agree. A muted thread is quiet everywhere,
 * even when it asks something; its own icon still shows what it is doing.
 */
export function resolveOpenThreadStatus(
  thread: Parameters<typeof resolveSidebarRowStatus>[0] &
    Parameters<typeof hasUnseenCompletion>[0] &
    Pick<EnvironmentThreadShell, "pendingBackgroundTasks">,
  muted: boolean,
): OpenThreadStatus {
  if (muted) return "idle";
  return openThreadStatusFromRow({
    rowStatus: resolveSidebarRowStatus(thread),
    muted,
    unseenCompletion: hasUnseenCompletion(thread),
    thread,
  });
}

export type RailThreadState = "needs" | "failed" | "working" | "done" | "quiet";

type RailThreadInput = Parameters<typeof resolveOpenThreadStatus>[0];

/**
 * What one open thread adds to its project's summary, by the shared status rule. */
export function resolveRailThreadState(thread: RailThreadInput, nowMs: number): RailThreadState {
  const status = resolveOpenThreadStatus(thread, isThreadMuted(thread, nowMs));
  return status === "idle" ? "quiet" : status;
}

/**
 * Commands and monitors running in the background across a project's open threads, by the
 * thread list's rule: a Working thread already says it is busy, so its tasks are not counted.
 */
export function railProjectRunningCount(
  threads: readonly RailThreadInput[],
  nowMs: number,
): number {
  let running = 0;
  for (const thread of threads) {
    if (resolveRailThreadState(thread, nowMs) !== "working") {
      running += backgroundRunningCount(thread);
    }
  }
  return running;
}

export interface RailCounts {
  readonly needs: number;
  readonly failed: number;
  readonly working: number;
  readonly done: number;
  readonly open: number;
}

export const EMPTY_RAIL_COUNTS: RailCounts = { needs: 0, failed: 0, working: 0, done: 0, open: 0 };

export function countRailStates(states: readonly RailThreadState[]): RailCounts {
  const counts = { ...EMPTY_RAIL_COUNTS, open: states.length };
  for (const state of states) {
    if (state !== "quiet") counts[state] += 1;
  }
  return counts;
}

export function addRailCounts(left: RailCounts, right: RailCounts): RailCounts {
  return {
    needs: left.needs + right.needs,
    failed: left.failed + right.failed,
    working: left.working + right.working,
    done: left.done + right.done,
    open: left.open + right.open,
  };
}

/** "1 needs you · 1 failed · 2 working · 2 done", "All quiet", or "No open threads". */
export function summarizeRailCounts(counts: RailCounts, resolve: MessageResolver = m): string {
  const parts: string[] = [];
  if (counts.needs > 0) {
    parts.push(
      resolve(
        msg("{count, plural, one {{count} needs you} other {{count} need you}}", {
          count: counts.needs,
        }),
      ),
    );
  }
  if (counts.failed > 0) {
    parts.push(resolve(msg("{count} failed", { count: counts.failed })));
  }
  if (counts.working > 0) {
    parts.push(resolve(msg("{count} working", { count: counts.working })));
  }
  if (counts.done > 0) parts.push(resolve(msg("{count} done", { count: counts.done })));
  if (parts.length > 0) return parts.join(" · ");
  return counts.open > 0 ? resolve(msg("All quiet")) : resolve(msg("No open threads"));
}

/** A folded folder says how many projects it holds and how many threads failed. */
export function summarizeRailFolder(
  projectCount: number,
  counts: RailCounts,
  resolve: MessageResolver = m,
): string {
  if (projectCount === 0) return resolve(msg("No projects"));
  const projects = resolve(
    msg("{count, plural, one {{count} project} other {{count} projects}}", {
      count: projectCount,
    }),
  );
  return counts.failed > 0
    ? resolve(msg("{projects} · {count} failed", { projects, count: counts.failed }))
    : projects;
}

/**
 * A project row's second line: how many threads are open and when one last changed, as
 * "3 open · 2h ago", "1 open · just now", or "No open threads".
 */
/** "just now", "12m ago", "5h ago" or "3d ago"; null when nothing is open to date it by. */
export function railProjectAge(
  lastActiveMs: number | null,
  nowMs: number,
  resolve: MessageResolver = m,
): string | null {
  if (lastActiveMs === null) return null;
  const minutes = Math.max(0, Math.floor((nowMs - lastActiveMs) / 60_000));
  if (minutes < 1) return resolve(msg("just now"));
  if (minutes < 60) return resolve(msg("{minutes}m ago", { minutes }));
  if (minutes < 24 * 60) return resolve(msg("{hours}h ago", { hours: Math.floor(minutes / 60) }));
  return resolve(msg("{days}d ago", { days: Math.floor(minutes / (24 * 60)) }));
}

export function railProjectDetail(
  open: number,
  lastActiveMs: number | null,
  nowMs: number,
  resolve: MessageResolver = m,
): string {
  if (open === 0) return resolve(msg("No open threads"));
  const age = railProjectAge(lastActiveMs, nowMs, resolve);
  return age === null
    ? resolve(msg("{open} open", { open }))
    : resolve(msg("{open} open · {age}", { open, age }));
}

export type RailDotState = "needs" | "failed" | "working" | "done" | "quiet";

/** The most dots a project row shows; the rest read as "+N". */
const RAIL_DOT_LIMIT = 8;

/**
 * One dot per open thread, most urgent first, so the dots that get cut are the quiet ones.
 * Quiet covers idle threads and stopped ones (an interrupted or cancelled run reads as idle).
 */
export function railStatusDots(
  counts: RailCounts,
  limit: number = RAIL_DOT_LIMIT,
): {
  readonly dots: ReadonlyArray<{ readonly key: string; readonly state: RailDotState }>;
  readonly overflow: number;
} {
  const quiet = Math.max(
    0,
    counts.open - counts.needs - counts.failed - counts.working - counts.done,
  );
  const perState: ReadonlyArray<readonly [RailDotState, number]> = [
    ["needs", counts.needs],
    ["failed", counts.failed],
    ["working", counts.working],
    ["done", counts.done],
    ["quiet", quiet],
  ];
  // Keyed by state and position within it, so a dot keeps its node while others come and go.
  const all = perState.flatMap(([state, count]) =>
    Array.from({ length: count }, (_, n) => ({ key: `${state}-${n}`, state })),
  );
  return { dots: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}

export function railNeedsLabel(needs: number, resolve: MessageResolver = m): string {
  return resolve(
    msg("{count, plural, one {{count} thread needs you} other {{count} threads need you}}", {
      count: needs,
    }),
  );
}

/**
 * The thread a project click opens: the one last viewed in that project while it is still
 * open, else the most recently visited, else the most recently updated.
 */
export function pickRailProjectThread<
  T extends Pick<EnvironmentThreadShell, "updatedAt" | "lastVisitedAt">,
>(
  openThreads: readonly T[],
  threadKey: (thread: T) => string,
  rememberedKey: string | null,
): T | null {
  if (rememberedKey !== null) {
    const remembered = openThreads.find((thread) => threadKey(thread) === rememberedKey);
    if (remembered) return remembered;
  }
  let best: T | null = null;
  let bestVisited = Number.NEGATIVE_INFINITY;
  let bestUpdated = Number.NEGATIVE_INFINITY;
  for (const thread of openThreads) {
    const visited = Date.parse(thread.lastVisitedAt ?? "");
    const updated = Date.parse(thread.updatedAt);
    const visitedMs = Number.isNaN(visited) ? Number.NEGATIVE_INFINITY : visited;
    const updatedMs = Number.isNaN(updated) ? Number.NEGATIVE_INFINITY : updated;
    if (
      best === null ||
      visitedMs > bestVisited ||
      (visitedMs === bestVisited && updatedMs > bestUpdated)
    ) {
      best = thread;
      bestVisited = visitedMs;
      bestUpdated = updatedMs;
    }
  }
  return best;
}

/** Muted threads, soonest to come back first; mutes that last until unmuted go last. */
export function sortRailMutedThreads<
  T extends Pick<EnvironmentThreadShell, "mutedAt" | "mutedUntil" | "title">,
>(threads: readonly T[], nowMs: number): T[] {
  const endsAt = (thread: T) => {
    const ms = thread.mutedUntil ? Date.parse(thread.mutedUntil) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return threads
    .filter((thread) => isThreadMuted(thread, nowMs))
    .toSorted(
      (left, right) => endsAt(left) - endsAt(right) || left.title.localeCompare(right.title),
    );
}

/**
 * How Undo after Unmute All mutes a thread again: until the same time, or until unmuted.
 * Null when that mute would have ended by now, so the thread stays unmuted.
 */
export function railRemuteInput(
  before: Pick<EnvironmentThreadShell, "mutedAt" | "mutedUntil">,
  nowMs: number,
): { readonly mutedUntil: string | undefined } | null {
  if (before.mutedUntil == null) return { mutedUntil: undefined };
  const endsAt = Date.parse(before.mutedUntil);
  return Number.isNaN(endsAt) || endsAt <= nowMs ? null : { mutedUntil: before.mutedUntil };
}

/** A project's status as the classic sidebar shows a thread's: its icon, label and color. */
export interface RailTopStatus {
  readonly icon: "working" | "input" | "request" | "approval" | "failed" | "done";
  readonly label: string;
  readonly className: string;
}

const RAIL_STATE_PRIORITY: readonly RailThreadState[] = ["needs", "failed", "done", "working"];

/**
 * The one status a project row shows, ranked as the classic folder dot ranks its threads:
 * needs you, then failed, then done, then working. Labels and colors match the classic rows.
 */
export function resolveRailTopStatus(
  threads: readonly RailThreadInput[],
  nowMs: number,
  resolve: MessageResolver = m,
): RailTopStatus | null {
  const states = threads.map((thread) => resolveRailThreadState(thread, nowMs));
  const state = RAIL_STATE_PRIORITY.find((candidate) => states.includes(candidate));
  if (state === undefined) return null;
  if (state === "failed") {
    return {
      icon: "failed",
      label: resolve(msg("Failed", { $context: "thread status label" })),
      className: "text-error-foreground",
    };
  }
  if (state === "done") {
    return {
      icon: "done",
      label: resolve(msg("Done", { $context: "thread status label" })),
      className: "text-success-foreground",
    };
  }
  const thread = threads[states.indexOf(state)]!;
  const status = resolveSidebarRowStatus(thread);
  if (state === "working") {
    return {
      icon: "working",
      label:
        status === "preparing"
          ? resolve(msg("Setting up", { $context: "thread status label" }))
          : resolve(msg("Working", { $context: "thread status label" })),
      className: "text-info-foreground",
    };
  }
  switch (status) {
    case "approval":
      return {
        icon: "approval",
        label: resolve(msg("Approval", { $context: "thread status label" })),
        className: "text-warning-foreground",
      };
    case "request":
      return {
        icon: "request",
        label: resolve(msg("Request", { $context: "thread status label" })),
        className: "text-guest-foreground",
      };
    case "limited":
      return {
        icon: "failed",
        label: resolve(msg("Limited", { $context: "thread status label" })),
        className: "text-warning-foreground",
      };
    default:
      return {
        icon: "input",
        label: resolve(msg("Input", { $context: "thread status label" })),
        className: "text-indigo-600 dark:text-indigo-300",
      };
  }
}
