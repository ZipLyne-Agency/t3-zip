import { describe, expect, it } from "vite-plus/test";

import { activeSnoozedProjectKeys, wokenSnoozedProjectKeys } from "./projectRailSnooze.ts";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const snoozed = {
  "p:later": "2026-11-19T13:00:00.000Z",
  "p:forever": "9999-12-31T23:59:59.000Z",
  "p:past": "2026-11-19T11:00:00.000Z",
  "p:exact": "2026-11-19T12:00:00.000Z",
  "p:broken": "not a time",
};

describe("project snooze", () => {
  it("keeps a project snoozed until its time, and forever ones always", () => {
    expect([...activeSnoozedProjectKeys(snoozed, now)].toSorted()).toEqual([
      "p:forever",
      "p:later",
    ]);
  });

  it("wakes projects whose time has come, and ones with an unreadable time", () => {
    expect(wokenSnoozedProjectKeys(snoozed, now).toSorted()).toEqual([
      "p:broken",
      "p:exact",
      "p:past",
    ]);
  });
});
