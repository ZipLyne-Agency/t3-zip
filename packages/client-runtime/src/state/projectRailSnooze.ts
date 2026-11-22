/**
 * Snoozed projects, by rail key, with when each comes back. "Until I wake it" is a time so far
 * ahead it never arrives, as for threads (see `INDEFINITE_SNOOZE_UNTIL`).
 */
export type SnoozedProjects = Readonly<Record<string, string>>;

/** Projects still snoozed at `nowMs`. */
export function activeSnoozedProjectKeys(snoozed: SnoozedProjects, nowMs: number): Set<string> {
  const keys = new Set<string>();
  for (const [projectKey, until] of Object.entries(snoozed)) {
    if (Date.parse(until) > nowMs) keys.add(projectKey);
  }
  return keys;
}

/** Projects whose snooze has run out at `nowMs`, or whose time cannot be read. */
export function wokenSnoozedProjectKeys(snoozed: SnoozedProjects, nowMs: number): string[] {
  return Object.entries(snoozed).flatMap(([projectKey, until]) => {
    const untilMs = Date.parse(until);
    return Number.isNaN(untilMs) || untilMs <= nowMs ? [projectKey] : [];
  });
}
