import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { isMutedCompletion } from "@t3tools/shared/threadMute";

import type { EnvironmentThreadShell } from "./models.ts";

/**
 * The status filters the desktop thread column and the mobile thread list share: one rule for
 * what Needs You, Working and Done hold and how many each counts, so both apps agree.
 */

/** A thread's row status, as both apps' thread lists derive it. */
export type ThreadRowStatus =
  | "approval"
  | "input"
  | "request"
  | "limited"
  | "failed"
  | "preparing"
  | "working"
  | "waiting"
  | "ready";

export type OpenThreadStatus = "needs" | "failed" | "working" | "done" | "idle";

/**
 * An open thread's status from its row status. A muted thread is quiet everywhere, even when it
 * asks something. Waiting on a child thread or on subagents the turn left running is still work;
 * a session that is simply idle is not. A finished run counts as done until the thread is opened.
 */
export function openThreadStatusFromRow(input: {
  readonly rowStatus: ThreadRowStatus;
  readonly muted: boolean;
  readonly unseenCompletion: boolean;
  readonly thread: Pick<EnvironmentThreadShell, "runtime" | "pendingBackgroundTasks">;
}): OpenThreadStatus {
  if (input.muted) return "idle";
  switch (input.rowStatus) {
    case "approval":
    case "input":
    case "request":
    // A usage limit waits on you.
    case "limited":
      return "needs";
    case "failed":
      return "failed";
    case "preparing":
    case "working":
      return "working";
    case "waiting":
      return input.thread.runtime?.status === "running" ||
        backgroundWorkHoldsCompletion(input.thread.pendingBackgroundTasks ?? [])
        ? "working"
        : "idle";
    case "ready":
      return input.unseenCompletion ? "done" : "idle";
  }
}

/**
 * A finished thread you opened but have not cleared, which Done keeps under Opened. Pass it a
 * thread whose status is idle: one Done counts as New has not been opened yet. Its latest run
 * must have completed after both the clear mark and `reviewSince`, the day this device began
 * keeping finished threads, and outside a mute, which keeps a thread quiet.
 */
export function isAwaitingClear(
  thread: Parameters<typeof isMutedCompletion>[0] & Pick<EnvironmentThreadShell, "latestRun">,
  clearedAt: string | undefined,
  reviewSince: string | null,
): boolean {
  const run = thread.latestRun;
  if (run?.status !== "completed" || !run.completedAt) return false;
  const completedMs = Date.parse(run.completedAt);
  if (Number.isNaN(completedMs)) return false;
  if (isMutedCompletion(thread, run.completedAt)) return false;
  const floors = [clearedAt, reviewSince].map((value) => (value ? Date.parse(value) : NaN));
  return floors.every((floor) => Number.isNaN(floor) || completedMs > floor);
}

/** Where Done lists a thread: New until you open it, then Opened until you clear it. */
export type DoneSection = "new" | "opened";

/**
 * Where Done lists a thread, or null when it is not there. A New thread leaves once it is
 * cleared, even before the server records the visit; an Opened one follows isAwaitingClear.
 * Threads finished before `reviewSince` but never opened still list as New, as they did.
 */
export function resolveDoneSection(
  status: OpenThreadStatus,
  muted: boolean,
  thread: Parameters<typeof isAwaitingClear>[0],
  clearedAt: string | undefined,
  reviewSince: string | null,
): DoneSection | null {
  if (muted) return null;
  if (status === "done") {
    const completedMs = Date.parse(thread.latestRun?.completedAt ?? "");
    const clearedMs = clearedAt ? Date.parse(clearedAt) : NaN;
    return Number.isNaN(clearedMs) || !(completedMs <= clearedMs) ? "new" : null;
  }
  if (status === "idle" && isAwaitingClear(thread, clearedAt, reviewSince)) return "opened";
  return null;
}

/** Every thread, the ones waiting on you (or failed), the running ones, or the finished ones. */
export type ThreadStatusFilter = "all" | "waiting" | "working" | "done";

/** Waiting is needs you or failed; Done keeps a finished thread until it is cleared. */
export function matchesThreadStatusFilter(
  item: { readonly status: OpenThreadStatus; readonly doneSection: DoneSection | null },
  filter: ThreadStatusFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "waiting":
      return item.status === "needs" || item.status === "failed";
    case "working":
      return item.status === "working";
    case "done":
      return item.doneSection !== null;
  }
}

export type ThreadStatusFilterCounts = Record<Exclude<ThreadStatusFilter, "all">, number>;

/** How many threads each filter lists; a thread counts once, in the first filter it matches. */
export function countThreadStatusFilters(
  items: ReadonlyArray<{
    readonly status: OpenThreadStatus;
    readonly doneSection: DoneSection | null;
  }>,
): ThreadStatusFilterCounts {
  const counts = { waiting: 0, working: 0, done: 0 };
  for (const item of items) {
    if (matchesThreadStatusFilter(item, "waiting")) counts.waiting += 1;
    else if (item.status === "working") counts.working += 1;
    else if (matchesThreadStatusFilter(item, "done")) counts.done += 1;
  }
  return counts;
}

type SinceInput = Pick<EnvironmentThreadShell, "latestRun" | "pendingUserInputAt" | "updatedAt">;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * When a thread began what its filter lists it for: waiting on you, running, or finished. Needs
 * You lists the longest waiting first, Working the latest started first, Done the newest first.
 */
export function threadStatusSinceMs(
  thread: SinceInput,
  status: "needs" | "failed" | "working" | "done",
): number {
  const run: Partial<
    Pick<
      NonNullable<EnvironmentThreadShell["latestRun"]>,
      "completedAt" | "startedAt" | "requestedAt"
    >
  > = thread.latestRun ?? {};
  const own =
    status === "needs"
      ? parseMs(thread.pendingUserInputAt)
      : status === "working"
        ? (parseMs(run.startedAt) ?? parseMs(run.requestedAt))
        : parseMs(run.completedAt);
  return own ?? parseMs(thread.updatedAt) ?? 0;
}
