import { describe, expect, it } from "vite-plus/test";

import {
  activeMute,
  buildMutePresetRows,
  muteCopy,
  muteEndLabel,
  mutePresetName,
  muteTimeLeftLabel,
  muteUndoInput,
  titleCaseLabel,
} from "./threadMute.logic";

// Local times, so the labels hold in any time zone.
const NOW = new Date(2026, 10, 16, 13, 45).getTime();
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 10, day, hours, minutes).getTime();
const formatTime = (date: Date) =>
  `${((date.getHours() + 11) % 12) + 1}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() < 12 ? "AM" : "PM"}`;

describe("mute labels", () => {
  it("title-cases the shared preset labels", () => {
    expect(titleCaseLabel("In 3 hours")).toBe("In 3 Hours");
    expect(titleCaseLabel("This evening")).toBe("This Evening");
    expect(titleCaseLabel("Next week")).toBe("Next Week");
  });

  it("names the day only when the mute ends on another day", () => {
    expect(muteEndLabel(at(16, 18), NOW, formatTime)).toBe("6:00 PM");
    const tomorrow = muteEndLabel(at(17, 9), NOW, formatTime);
    expect(tomorrow).toMatch(/9:00 AM$/);
    expect(tomorrow).not.toBe("9:00 AM");
  });

  it.each([
    [at(16, 18), "4 h 15 min left"],
    [at(16, 14, 30), "45 min left"],
    [at(16, 15, 45), "2 h left"],
    [at(19, 13, 45), "3 days left"],
  ])("time left until %s reads %s", (until, expected) => {
    expect(muteTimeLeftLabel(until, NOW)).toBe(expected);
  });

  it("reads the button, menu and banner from the mute in effect", () => {
    expect(muteCopy(null, NOW, formatTime)).toMatchObject({ button: "Mute", banner: null });
    expect(muteCopy({ until: null }, NOW, formatTime)).toMatchObject({
      button: "Muted",
      title: "Muted until you unmute",
    });
    expect(muteCopy({ until: at(16, 18) }, NOW, formatTime)).toEqual({
      button: "Muted until 6:00 PM",
      title: "Muted until 6:00 PM",
      subtitle: "4 h 15 min left. Alerts come back on their own.",
      banner: "Muted until 6:00 PM (4 h 15 min left). Runs finish quietly with no Done marker.",
    });
  });
});

describe("buildMutePresetRows", () => {
  const presets = [
    {
      id: "after:60",
      label: "In 1 hour",
      whenLabel: "2:45 PM",
      snoozedUntil: new Date(at(16, 14, 45) + 30_000).toISOString(),
    },
    {
      id: "at:today:18:00",
      label: "This evening",
      whenLabel: "6:00 PM",
      snoozedUntil: new Date(at(16, 18)).toISOString(),
    },
  ];

  it("leads with Until I Unmute and shows each preset's exact return time", () => {
    const rows = buildMutePresetRows(presets, null);
    expect(rows.map(mutePresetName)).toEqual([
      "Until I Unmute",
      "In 1 Hour (2:45 PM)",
      "This Evening (6:00 PM)",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "mute:forever",
      "mute:after:60",
      "mute:at:today:18:00",
    ]);
    expect(rows.some((row) => row.checked)).toBe(false);
  });

  it("checks the choice the thread is muted with, to the minute", () => {
    expect(buildMutePresetRows(presets, { until: at(16, 18) }).map((row) => row.checked)).toEqual([
      false,
      false,
      true,
    ]);
    expect(buildMutePresetRows(presets, { until: null }).map((row) => row.checked)).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("mute state", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("ends a timed mute without an event", () => {
    const thread = { mutedAt: iso(at(16, 12)), mutedUntil: iso(at(16, 13)) };
    expect(activeMute(thread, NOW)).toBeNull();
    expect(activeMute({ mutedAt: iso(at(16, 12)), mutedUntil: null }, NOW)).toEqual({
      until: null,
    });
  });

  it("undoes a change by putting back the mute the thread had before", () => {
    expect(muteUndoInput(null, NOW)).toEqual({ muted: false });
    expect(muteUndoInput({ mutedAt: null, mutedUntil: null }, NOW)).toEqual({ muted: false });
    expect(muteUndoInput({ mutedAt: iso(at(16, 12)), mutedUntil: null }, NOW)).toEqual({
      muted: true,
    });
    expect(muteUndoInput({ mutedAt: iso(at(16, 12)), mutedUntil: iso(at(16, 18)) }, NOW)).toEqual({
      muted: true,
      mutedUntil: iso(at(16, 18)),
    });
    // The earlier mute would have ended by the time Undo is pressed.
    expect(muteUndoInput({ mutedAt: iso(at(16, 12)), mutedUntil: iso(at(16, 13)) }, NOW)).toEqual({
      muted: false,
    });
  });
});
