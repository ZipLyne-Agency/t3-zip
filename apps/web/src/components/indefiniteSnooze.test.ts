import { effectiveSnoozed, pickSnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "vite-plus/test";

import {
  INDEFINITE_SNOOZE_ID,
  INDEFINITE_SNOOZE_PRESET,
  INDEFINITE_SNOOZE_UNTIL,
  isIndefiniteSnooze,
  timedSnoozePresets,
} from "./indefiniteSnooze";
import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const NOW = new Date("2026-11-16T13:45:00.000Z");
const HOUR = {
  id: "after:60",
  label: "In 1 hour",
  whenLabel: "2:45 PM",
  snoozedUntil: "2026-11-16T14:45:00.000Z",
};

describe("isIndefiniteSnooze", () => {
  it("tells an open-ended snooze from one with a wake time", () => {
    expect(isIndefiniteSnooze(INDEFINITE_SNOOZE_UNTIL)).toBe(true);
    expect(isIndefiniteSnooze("2027-01-01T09:00:00.000Z")).toBe(false);
    expect(isIndefiniteSnooze(null)).toBe(false);
    expect(isIndefiniteSnooze(undefined)).toBe(false);
    expect(isIndefiniteSnooze("not a date")).toBe(false);
  });
});

describe("the Until I wake it choice", () => {
  it("is picked like any shown choice and keeps its wake time", () => {
    const picked = pickSnoozePreset({
      shown: [INDEFINITE_SNOOZE_PRESET, HOUR],
      id: INDEFINITE_SNOOZE_ID,
      now: NOW,
    });
    expect(picked?.snoozedUntil).toBe(INDEFINITE_SNOOZE_UNTIL);
  });

  it("keeps the thread snoozed decades later", () => {
    const snoozed = { snoozedAt: NOW.toISOString(), snoozedUntil: INDEFINITE_SNOOZE_UNTIL };
    expect(effectiveSnoozed(snoozed as never, { now: "2099-01-01T00:00:00.000Z" })).toBe(true);
  });

  it("is left out of menus that end at a time", () => {
    expect(timedSnoozePresets([INDEFINITE_SNOOZE_PRESET, HOUR])).toEqual([HOUR]);
  });
});

describe("thread menu", () => {
  const state: ThreadActionMenuState = {
    canOperate: true,
    branch: null,
    projectFilter: null,
    isPinned: false,
    isSettled: false,
    autoSettleEnabled: true,
    isMuted: false,
    isSnoozed: false,
    canSnoozeNow: true,
    isRegeneratingTitle: false,
    isRunning: false,
    hasCompletedRun: true,
    supports: {
      settlement: true,
      autoSettleOptOut: true,
      mute: true,
      snooze: true,
      pinning: true,
      titleRegeneration: true,
    },
    snoozePresets: [INDEFINITE_SNOOZE_PRESET, HOUR],
  };
  const childIds = (id: string) =>
    buildThreadActionMenuItems(state)
      .find((item) => item.id === id)
      ?.children?.map((child) => child.id);

  it("offers Until I wake it under Snooze", () => {
    expect(childIds("snooze")).toEqual(["snooze:forever", "snooze:after:60", "snooze:custom"]);
  });

  it("lists Mute's own open-ended choice once", () => {
    expect(childIds("mute")).toEqual(["mute:forever", "mute:after:60", "mute:custom"]);
  });
});
