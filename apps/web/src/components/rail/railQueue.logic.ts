import { threadStatusSinceMs } from "@t3tools/client-runtime/state/thread-status-filter";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

/** Waiting: needs you or failed. Working: running now. Done: finished and not cleared yet. */
export type RailQueueKind = "waiting" | "working" | "done";

export type RailQueueState = "needs" | "failed" | "working" | "done";

/** What a waiting thread wants, in the order the Waiting list shows its sections. */
const RAIL_WAITING_REASONS = ["approval", "input", "request", "limited", "failed"] as const;
export type RailWaitingReason = (typeof RAIL_WAITING_REASONS)[number];

const RAIL_WAITING_REASON_LABELS: Record<RailWaitingReason, string> = {
  approval: msg("Approvals"),
  input: msg("Questions"),
  request: msg("Requests"),
  limited: msg("Usage Limits"),
  failed: msg("Failed", { $context: "section of failed threads" }),
};

export interface RailQueueEntry<T> {
  readonly key: string;
  readonly thread: T;
  readonly state: RailQueueState;
  readonly projectKey: string | null;
  readonly projectName: string | null;
  /** When it started waiting on you, started running or finished; oldest first. */
  readonly sinceMs: number;
  /** Set on waiting threads: what it wants from you. */
  readonly reason: RailWaitingReason | null;
  /** A Done thread you have opened but not cleared; Done lists it under Opened. */
  readonly opened: boolean;
}

/**
 * When a thread joined its list. A finished or failed run dates from its end, a running one
 * from its start, and a question from when it was asked. An approval carries no time of its
 * own, so it uses the thread's last update, which is when the approval arrived.
 */
export function railQueueSinceMs(
  thread: Parameters<typeof threadStatusSinceMs>[0],
  state: RailQueueState,
): number {
  return threadStatusSinceMs(thread, state);
}

export function railQueueKind(state: RailQueueState): RailQueueKind {
  if (state === "done") return "done";
  if (state === "working") return "working";
  return "waiting";
}

/** Waiting threads in sections by what they want, each oldest first; empty sections left out. */
export function groupRailWaiting<E extends Pick<RailQueueEntry<unknown>, "reason">>(
  entries: readonly E[],
  resolve: MessageResolver = m,
): { readonly reason: RailWaitingReason; readonly label: string; readonly items: E[] }[] {
  return RAIL_WAITING_REASONS.flatMap((reason) => {
    const items = entries.filter((entry) => entry.reason === reason);
    return items.length === 0
      ? []
      : [{ reason, label: resolve(RAIL_WAITING_REASON_LABELS[reason]), items }];
  });
}

/** Oldest first, so the thread that has waited longest is the one to get to first. */
export function sortRailQueue<E extends RailQueueEntry<{ readonly title: string }>>(
  entries: readonly E[],
): E[] {
  return entries.toSorted(
    (left, right) =>
      left.sinceMs - right.sinceMs ||
      left.thread.title.localeCompare(right.thread.title) ||
      (left.key < right.key ? -1 : 1),
  );
}

/** The thread Next opens: the oldest one that is not the thread already open. */
export function nextRailQueueKey(
  entries: readonly Pick<RailQueueEntry<unknown>, "key">[],
  currentKey: string | null,
): string | null {
  return entries.find((entry) => entry.key !== currentKey)?.key ?? null;
}

/** "now", "5m", "3h", "2d": how long a thread has been waiting. */
export function railQueueAge(sinceMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
