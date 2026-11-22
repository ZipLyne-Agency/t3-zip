import { describe, expect, it } from "vite-plus/test";

import { buildDrawerThreadShelves } from "./drawer-shelves";

const NOW_MS = Date.parse("2026-11-22T10:00:00.000Z");

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    environmentId: "env-1",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    mutedAt: null,
    mutedUntil: null,
    title: id,
    updatedAt: "2026-11-22T09:00:00.000Z",
    latestUserMessageAt: null,
    ...overrides,
  } as never;
}

describe("drawer thread shelves", () => {
  it("lists snoozed, muted and settled threads by the desktop rail's rules", () => {
    const shelves = buildDrawerThreadShelves({
      threads: [
        thread("open"),
        thread("snoozed-late", { snoozedUntil: "2026-11-22T15:00:00.000Z" }),
        thread("snoozed-soon", { snoozedUntil: "2026-11-22T11:00:00.000Z" }),
        thread("woke", { snoozedUntil: "2026-11-22T09:00:00.000Z" }),
        thread("settled", { settledOverride: "settled" }),
        thread("archived", { settledOverride: "settled", archivedAt: "2026-11-21T00:00:00.000Z" }),
        thread("muted-forever", { mutedAt: "2026-11-22T08:00:00.000Z" }),
        thread("muted-soon", {
          mutedAt: "2026-11-22T08:00:00.000Z",
          mutedUntil: "2026-11-22T10:30:00.000Z",
        }),
        thread("unloaded", { environmentId: "env-2", settledOverride: "settled" }),
      ],
      nowMs: NOW_MS,
      configLoaded: (environmentId) => environmentId === "env-1",
    });
    expect(shelves.snoozed.map((entry) => (entry as { id: string }).id)).toEqual([
      "snoozed-soon",
      "snoozed-late",
    ]);
    expect(shelves.muted.map((entry) => (entry as { id: string }).id)).toEqual([
      "muted-soon",
      "muted-forever",
    ]);
    expect(shelves.settled.map((entry) => (entry as { id: string }).id)).toEqual(["settled"]);
  });
});
