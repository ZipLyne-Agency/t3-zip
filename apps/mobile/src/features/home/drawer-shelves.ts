import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId } from "@t3tools/contracts";
import { isThreadMuted } from "@t3tools/shared/threadMute";

/** The drawer's thread shelves, below the projects. */
export type DrawerShelfKind = "snoozed" | "muted" | "settled" | "hidden";

/**
 * The Snoozed, Muted and Settled thread lists by the desktop rail's rules (`buildRailProjects`):
 * archived threads are left out; snoozed and settled apply once the environment's settings are
 * loaded; every muted thread lists under Muted, whatever else it is.
 */
export function buildDrawerThreadShelves<
  T extends Pick<
    EnvironmentThreadShell,
    | "id"
    | "environmentId"
    | "archivedAt"
    | "settledOverride"
    | "snoozedUntil"
    | "mutedAt"
    | "mutedUntil"
    | "title"
    | "updatedAt"
  > &
    Parameters<typeof effectiveSnoozed>[0] &
    Parameters<typeof sortSettledThreads>[0][number],
>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly nowMs: number;
  /** Environments whose settings are loaded, so snooze and settle apply there. */
  readonly configLoaded: (environmentId: EnvironmentId) => boolean;
}): { readonly snoozed: T[]; readonly muted: T[]; readonly settled: T[] } {
  const nowIso = new Date(input.nowMs).toISOString();
  const visible = input.threads.filter((thread) => thread.archivedAt === null);
  const snoozed: T[] = [];
  const settled: T[] = [];
  for (const thread of visible) {
    if (!input.configLoaded(thread.environmentId)) continue;
    if (thread.settledOverride !== "settled" && effectiveSnoozed(thread, { now: nowIso })) {
      snoozed.push(thread);
    } else if (thread.settledOverride === "settled") {
      settled.push(thread);
    }
  }
  return {
    // Hermes has no `toSorted`.
    snoozed: snoozed.sort((left, right) => wakeMs(left) - wakeMs(right)),
    muted: sortMutedThreads(visible, input.nowMs),
    settled: sortSettledThreads(settled),
  };
}

function wakeMs(thread: { readonly snoozedUntil?: string | null }): number {
  const ms = thread.snoozedUntil ? Date.parse(thread.snoozedUntil) : Number.NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Muted threads, soonest to come back first; mutes that last until unmuted go last. */
function sortMutedThreads<
  T extends Pick<EnvironmentThreadShell, "mutedAt" | "mutedUntil" | "title">,
>(threads: ReadonlyArray<T>, nowMs: number): T[] {
  const endsAt = (thread: T) => {
    const ms = thread.mutedUntil ? Date.parse(thread.mutedUntil) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return threads
    .filter((thread) => isThreadMuted(thread, nowMs))
    .sort((left, right) => endsAt(left) - endsAt(right) || left.title.localeCompare(right.title));
}
