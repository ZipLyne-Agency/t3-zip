import { describe, expect, it } from "vite-plus/test";

import {
  groupRailWaiting,
  nextRailQueueKey,
  railQueueAge,
  railQueueSinceMs,
  sortRailQueue,
  type RailQueueEntry,
} from "./railQueue.logic";

type SinceInput = Parameters<typeof railQueueSinceMs>[0];

const thread = (overrides: Partial<SinceInput> = {}): SinceInput =>
  ({
    latestRun: null,
    pendingUserInputAt: null,
    updatedAt: "2026-11-16T10:00:00.000Z",
    ...overrides,
  }) as SinceInput;

const run = (completedAt: string | null) =>
  ({ completedAt, status: "completed" }) as unknown as SinceInput["latestRun"];

const entry = (key: string, title: string, sinceMs: number): RailQueueEntry<{ title: string }> => ({
  key,
  thread: { title },
  state: "done",
  projectKey: null,
  projectName: null,
  sinceMs,
  reason: null,
  opened: false,
});

describe("railQueueSinceMs", () => {
  it("dates a finished or failed thread from when its run ended", () => {
    const finished = thread({ latestRun: run("2026-11-16T09:00:00.000Z") });
    expect(railQueueSinceMs(finished, "done")).toBe(Date.parse("2026-11-16T09:00:00.000Z"));
    expect(railQueueSinceMs(finished, "failed")).toBe(Date.parse("2026-11-16T09:00:00.000Z"));
  });

  it("dates a question from when it was asked, not from the last run", () => {
    const asking = thread({
      latestRun: run("2026-11-16T08:00:00.000Z"),
      pendingUserInputAt: "2026-11-16T09:30:00.000Z",
    });
    expect(railQueueSinceMs(asking, "needs")).toBe(Date.parse("2026-11-16T09:30:00.000Z"));
  });

  it("dates a running thread from when its run started", () => {
    const running = thread({
      latestRun: {
        completedAt: null,
        startedAt: "2026-11-16T09:15:00.000Z",
        requestedAt: "2026-11-16T09:14:00.000Z",
      } as unknown as SinceInput["latestRun"],
    });
    expect(railQueueSinceMs(running, "working")).toBe(Date.parse("2026-11-16T09:15:00.000Z"));
  });

  it("falls back to the last update when there is no better time", () => {
    expect(railQueueSinceMs(thread(), "needs")).toBe(Date.parse("2026-11-16T10:00:00.000Z"));
    expect(railQueueSinceMs(thread({ latestRun: run(null) }), "done")).toBe(
      Date.parse("2026-11-16T10:00:00.000Z"),
    );
  });
});

describe("sortRailQueue", () => {
  it("puts the longest-waiting thread first, then by title", () => {
    const sorted = sortRailQueue([
      entry("c", "Later", 300),
      entry("b", "Beta", 100),
      entry("a", "Alpha", 100),
    ]);
    expect(sorted.map((item) => item.key)).toEqual(["a", "b", "c"]);
  });
});

describe("nextRailQueueKey", () => {
  const items = [entry("a", "A", 1), entry("b", "B", 2)];

  it("opens the oldest thread", () => {
    expect(nextRailQueueKey(items, null)).toBe("a");
  });

  it("skips the thread already open", () => {
    expect(nextRailQueueKey(items, "a")).toBe("b");
  });

  it("has nothing to open when only the open thread is left", () => {
    expect(nextRailQueueKey([entry("a", "A", 1)], "a")).toBeNull();
    expect(nextRailQueueKey([], null)).toBeNull();
  });
});

describe("railQueueAge", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  it("reads as now, minutes, hours or days", () => {
    expect(railQueueAge(now - 20_000, now)).toBe("now");
    expect(railQueueAge(now - 5 * 60_000, now)).toBe("5m");
    expect(railQueueAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(railQueueAge(now - 50 * 3_600_000, now)).toBe("2d");
  });
});

describe("groupRailWaiting", () => {
  it("splits waiting threads by what they want and leaves out empty sections", () => {
    const failed = { ...entry("f", "F", 1), reason: "failed" as const };
    const approval = { ...entry("a", "A", 2), reason: "approval" as const };
    const question = { ...entry("q", "Q", 3), reason: "input" as const };
    const sections = groupRailWaiting([failed, question, approval]);
    expect(sections.map((section) => section.label)).toEqual(["Approvals", "Questions", "Failed"]);
    expect(sections[0]?.items).toEqual([approval]);
  });
});
