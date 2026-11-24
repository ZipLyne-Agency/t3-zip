import { describe, expect, it } from "@effect/vitest";

import {
  countThreadStatusFilters,
  matchesThreadStatusFilter,
  normalizeThreadStatusFilter,
  threadStatusFilters,
  type ThreadStatusFilter,
} from "./threadStatusFilter.ts";

describe("threadStatusFilters", () => {
  it("combines Working and Done into one tab for thread lists", () => {
    expect(threadStatusFilters(true)).toEqual(["all", "waiting", "workingDone"]);
  });

  it("keeps Working and Done apart for the rail's own queue", () => {
    expect(threadStatusFilters(false)).toEqual(["all", "waiting", "working", "done"]);
  });
});

describe("normalizeThreadStatusFilter", () => {
  const cases: ReadonlyArray<[ThreadStatusFilter, boolean, ThreadStatusFilter]> = [
    ["working", true, "workingDone"],
    ["done", true, "workingDone"],
    ["workingDone", true, "workingDone"],
    ["all", true, "all"],
    ["waiting", true, "waiting"],
    ["workingDone", false, "working"],
    ["working", false, "working"],
    ["done", false, "done"],
    ["all", false, "all"],
    ["waiting", false, "waiting"],
  ];
  it.each(cases)("%s with combined %s becomes %s", (filter, single, expected) => {
    expect(normalizeThreadStatusFilter(filter, single)).toBe(expected);
  });

  it("always lands on a tab the list shows", () => {
    for (const single of [true, false]) {
      const tabs = threadStatusFilters(single);
      for (const filter of ["all", "waiting", "working", "done", "workingDone"] as const) {
        expect(tabs).toContain(normalizeThreadStatusFilter(filter, single));
      }
    }
  });
});

describe("matchesThreadStatusFilter workingDone", () => {
  it("matches working threads and threads Done lists, nothing else", () => {
    const match = (item: Parameters<typeof matchesThreadStatusFilter>[0]) =>
      matchesThreadStatusFilter(item, "workingDone");
    expect(match({ status: "working", doneSection: null })).toBe(true);
    expect(match({ status: "done", doneSection: "new" })).toBe(true);
    expect(match({ status: "idle", doneSection: "opened" })).toBe(true);
    expect(match({ status: "idle", doneSection: null })).toBe(false);
    expect(match({ status: "needs", doneSection: null })).toBe(false);
    expect(match({ status: "failed", doneSection: null })).toBe(false);
  });

  it("leaves the counts keyed by waiting, working and done", () => {
    expect(
      countThreadStatusFilters([
        { status: "working", doneSection: null },
        { status: "done", doneSection: "new" },
        { status: "needs", doneSection: null },
      ]),
    ).toEqual({ waiting: 1, working: 1, done: 1 });
  });
});
