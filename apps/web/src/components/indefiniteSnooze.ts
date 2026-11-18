import { msg } from "gt-react";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

/**
 * "Snooze until I wake it" (T3 Zip). A snooze always carries a wake time on the server, so an
 * open-ended one is a wake time so far ahead that it never arrives. Every server that supports
 * snooze accepts it, and Wake, Undo and a new message end it like any other snooze.
 */
export const INDEFINITE_SNOOZE_UNTIL = "9999-12-31T23:59:59.000Z";

export const INDEFINITE_SNOOZE_ID = "forever";

// Anything this far ahead was not picked from a clock or a calendar.
const INDEFINITE_FROM_MS = Date.UTC(9000, 0, 1);

export function isIndefiniteSnooze(snoozedUntil: string | null | undefined): boolean {
  return snoozedUntil != null && Date.parse(snoozedUntil) >= INDEFINITE_FROM_MS;
}

/** The menu choice. It names no time, so it has no time label beside it. */
export const INDEFINITE_SNOOZE_PRESET: SnoozePreset = {
  id: INDEFINITE_SNOOZE_ID,
  label: msg("Until I wake it"),
  whenLabel: "",
  snoozedUntil: INDEFINITE_SNOOZE_UNTIL,
};

/** Menu choices that end at a time, for menus that have their own open-ended choice (Mute). */
export function timedSnoozePresets(
  presets: ReadonlyArray<SnoozePreset>,
): ReadonlyArray<SnoozePreset> {
  return presets.filter((preset) => preset.id !== INDEFINITE_SNOOZE_ID);
}
