import { useNowMinute } from "../../hooks/useNowMinute";
import { useProjectRailStore } from "./railStore";
import { activeSnoozedProjectKeys, wokenSnoozedProjectKeys } from "./railProjectSnooze.logic";

/** Projects snoozed right now, checked again each minute so they come back on time. */
export function useSnoozedProjectKeys(): ReadonlySet<string> {
  return useProjectSnoozeClock().active;
}

/**
 * Snoozed projects at this minute: the ones still away, and the ones whose time has come and
 * that are waiting to be put back.
 */
export function useProjectSnoozeClock(): {
  readonly active: ReadonlySet<string>;
  readonly woken: readonly string[];
} {
  const snoozed = useProjectRailStore((store) => store.snoozedProjects);
  // The minute tick re-renders callers; the time is read at that render.
  useNowMinute();
  // oxlint-disable-next-line react/purity -- Read on each minute tick so a snooze ends on time.
  const nowMs = Date.now();
  return {
    active: activeSnoozedProjectKeys(snoozed, nowMs),
    woken: wokenSnoozedProjectKeys(snoozed, nowMs),
  };
}
