import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import { isThreadMuted, threadMuteEndsAt, type ThreadMuteFields } from "@t3tools/shared/threadMute";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

/** The mute in effect now: `until` is null while it lasts until unmuted. Null when not muted. */
export type ActiveMute = { readonly until: number | null } | null;

export function activeMute(thread: ThreadMuteFields, nowMs: number): ActiveMute {
  const endsAt = threadMuteEndsAt(thread, nowMs);
  return endsAt === undefined ? null : { until: endsAt };
}

/** "In 3 hours" reads "In 3 Hours": menu rows are Title Case, the shared presets are not. */
export function titleCaseLabel(label: string): string {
  return label.replace(
    /(^|\s)(\p{Ll})/gu,
    (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`,
  );
}

/** "6:00 PM" today, "Tue 9:00 AM" on another day. */
export function muteEndLabel(
  untilMs: number,
  nowMs: number,
  formatTime: (date: Date) => string,
): string {
  const end = new Date(untilMs);
  const time = formatTime(end);
  if (end.toDateString() === new Date(nowMs).toDateString()) return time;
  return `${end.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** "4 h 15 min left", "45 min left", "3 days left". */
export function muteTimeLeftLabel(
  untilMs: number,
  nowMs: number,
  resolve: MessageResolver = m,
): string {
  const minutes = Math.max(1, Math.ceil((untilMs - nowMs) / 60_000));
  if (minutes >= 2 * 24 * 60) {
    return resolve(
      msg("{days, plural, one {{days} day left} other {{days} days left}}", {
        days: Math.round(minutes / (24 * 60)),
      }),
    );
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return resolve(msg("{rest} min left", { rest }));
  if (rest === 0) return resolve(msg("{hours} h left", { hours }));
  return resolve(msg("{hours} h {rest} min left", { hours, rest }));
}

export type MuteMenuId = "mute:forever" | `mute:${string}` | "mute:custom";

export interface MutePresetRow {
  readonly id: MuteMenuId;
  readonly label: string;
  /** When alerts come back, empty for Until I Unmute. */
  readonly when: string;
  readonly checked: boolean;
}

/**
 * The mute choices with the exact time each one ends, from the same presets the sidebar's
 * Mute submenu uses. The choice the thread is muted with is checked.
 */
export function buildMutePresetRows(
  presets: ReadonlyArray<SnoozePreset>,
  mute: ActiveMute,
  resolve: MessageResolver = m,
): ReadonlyArray<MutePresetRow> {
  const minute = (ms: number) => Math.floor(ms / 60_000);
  return [
    {
      id: "mute:forever",
      label: resolve(msg("Until I Unmute")),
      when: "",
      checked: mute !== null && mute.until === null,
    },
    ...presets.map((preset) => ({
      id: `mute:${preset.id}` as const,
      label: titleCaseLabel(preset.label),
      when: preset.whenLabel,
      checked:
        mute !== null &&
        mute.until !== null &&
        minute(mute.until) === minute(Date.parse(preset.snoozedUntil)),
    })),
  ];
}

/** What a screen reader hears for a preset: "In 1 Hour (2:45 PM)". */
export function mutePresetName(row: Pick<MutePresetRow, "label" | "when">): string {
  return row.when ? `${row.label} (${row.when})` : row.label;
}

export interface MuteCopy {
  /** The header button. */
  readonly button: string;
  /** The menu's heading. */
  readonly title: string;
  readonly subtitle: string;
  /** The banner in the thread, null when not muted. */
  readonly banner: string | null;
}

export function muteCopy(
  mute: ActiveMute,
  nowMs: number,
  formatTime: (date: Date) => string,
  resolve: MessageResolver = m,
): MuteCopy {
  if (mute === null) {
    return {
      button: resolve(
        msg("Mute", { $context: "verb, button that mutes a thread's notifications" }),
      ),
      title: resolve(msg("Mute Notifications")),
      subtitle: resolve(msg("No alerts and no Done marker. The tab stays where it is.")),
      banner: null,
    };
  }
  if (mute.until === null) {
    return {
      button: resolve(msg("Muted", { $context: "adjective, button label for a muted thread" })),
      title: resolve(msg("Muted until you unmute")),
      subtitle: resolve(msg("Runs finish quietly until you turn alerts back on.")),
      banner: resolve(msg("Muted until you unmute. Runs finish quietly with no Done marker.")),
    };
  }
  const end = muteEndLabel(mute.until, nowMs, formatTime);
  const left = muteTimeLeftLabel(mute.until, nowMs, resolve);
  return {
    button: resolve(msg("Muted until {end}", { end })),
    title: resolve(msg("Muted until {end}", { end })),
    subtitle: resolve(msg("{left}. Alerts come back on their own.", { left })),
    banner: resolve(
      msg("Muted until {end} ({left}). Runs finish quietly with no Done marker.", { end, left }),
    ),
  };
}

/**
 * The command that undoes a mute change: put back the mute the thread had before, or unmute
 * when it had none. A timed mute that would already have ended by now is not brought back.
 */
export function muteUndoInput(
  before: { readonly mutedAt?: string | null; readonly mutedUntil?: string | null } | null,
  undoAtMs: number,
): { readonly muted: false } | { readonly muted: true; readonly mutedUntil?: string } {
  if (before === null || !isThreadMuted(before, undoAtMs)) return { muted: false };
  return before.mutedUntil == null
    ? { muted: true }
    : { muted: true, mutedUntil: before.mutedUntil };
}
