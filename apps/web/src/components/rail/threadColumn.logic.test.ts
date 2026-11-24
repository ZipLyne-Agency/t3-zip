import { describe, expect, it } from "vite-plus/test";

import {
  ALL_PROJECTS_SCOPE,
  buildThreadColumnSections,
  buildWorkingDoneHalves,
  countThreadColumnFilters,
  groupThreadColumnItemsByProject,
  nextThreadAfterRemoval,
  resolveColumnDraftedKeys,
  resolveThreadColumnFilter,
  resolveThreadColumnScope,
  threadColumnFits,
  type ThreadColumnItem,
} from "./threadColumn.logic";

const known = new Set(["p:a", "p:b"]);

describe("resolveThreadColumnScope", () => {
  it("follows the open thread's project", () => {
    expect(
      resolveThreadColumnScope({
        choice: null,
        routeKey: "t1",
        routeProjectKey: "p:a",
        knownScopes: known,
      }),
    ).toBe("p:a");
  });

  it("keeps a project picked in the rail while the same thread stays open", () => {
    expect(
      resolveThreadColumnScope({
        choice: { scope: "p:b", madeUnder: "t1" },
        routeKey: "t1",
        routeProjectKey: "p:a",
        knownScopes: known,
      }),
    ).toBe("p:b");
  });

  it("returns to the open thread's project once another thread opens", () => {
    expect(
      resolveThreadColumnScope({
        choice: { scope: "p:b", madeUnder: "t1" },
        routeKey: "t2",
        routeProjectKey: "p:a",
        knownScopes: known,
      }),
    ).toBe("p:a");
  });

  it("keeps the last choice on a page with no thread", () => {
    expect(
      resolveThreadColumnScope({
        choice: { scope: ALL_PROJECTS_SCOPE, madeUnder: "t1" },
        routeKey: null,
        routeProjectKey: null,
        knownScopes: known,
      }),
    ).toBe(ALL_PROJECTS_SCOPE);
  });

  it("falls back to every project when the chosen project is gone", () => {
    expect(
      resolveThreadColumnScope({
        choice: { scope: "p:gone", madeUnder: null },
        routeKey: null,
        routeProjectKey: null,
        knownScopes: known,
      }),
    ).toBe(ALL_PROJECTS_SCOPE);
  });
});

describe("threadColumnFits", () => {
  it("needs room for the rail, the column and the chat", () => {
    expect(threadColumnFits(1152, false)).toBe(true);
    expect(threadColumnFits(1151, false)).toBe(false);
    // Folding the rail frees room for the column.
    expect(threadColumnFits(1008, true)).toBe(true);
    expect(threadColumnFits(1007, true)).toBe(false);
  });
});

const NOW = new Date(2026, 10, 17, 15, 0).getTime();
const HOUR = 3_600_000;

function item(key: string, overrides: Partial<ThreadColumnItem> = {}): ThreadColumnItem {
  return {
    key,
    kind: "thread",
    status: "idle",
    pinned: false,
    updatedMs: NOW - HOUR,
    sinceMs: NOW - HOUR,
    hasDraft: false,
    doneSection: overrides.status === "done" ? "new" : null,
    ...overrides,
  };
}

const ids = (sections: ReturnType<typeof buildThreadColumnSections>) =>
  sections.map((section) => [section.id, section.items.map((entry) => entry.key)]);

describe("buildThreadColumnSections", () => {
  const items = [
    item("old", { updatedMs: NOW - 72 * HOUR }),
    item("yesterday", { updatedMs: new Date(2026, 10, 16, 23, 0).getTime() }),
    item("today-early", { updatedMs: NOW - 5 * HOUR }),
    item("today-late", { updatedMs: NOW - HOUR, status: "done" }),
    item("pin", { pinned: true, updatedMs: NOW - 90 * HOUR }),
    item("ask-new", { status: "needs", sinceMs: NOW - HOUR }),
    item("ask-old", { status: "failed", sinceMs: NOW - 4 * HOUR }),
    item("run", { status: "working" }),
    item("draft", { kind: "draft" }),
    item("seen", { updatedMs: NOW - 2 * HOUR, doneSection: "opened" }),
  ];

  it("groups by what needs you, then by day, each in its order", () => {
    expect(ids(buildThreadColumnSections(items, "all", NOW))).toEqual([
      ["drafts", ["draft"]],
      ["needs", ["ask-old", "ask-new"]],
      ["working", ["run"]],
      ["pinned", ["pin"]],
      ["today", ["today-late", "seen", "today-early"]],
      ["yesterday", ["yesterday"]],
      ["earlier", ["old"]],
    ]);
  });

  it("puts the latest started run on top of Working", () => {
    const runs = [
      item("first", { status: "working", sinceMs: NOW - 3 * HOUR }),
      item("latest", { status: "working", sinceMs: NOW - HOUR }),
    ];
    expect(ids(buildThreadColumnSections(runs, "working", NOW))).toEqual([
      ["working", ["latest", "first"]],
    ]);
  });

  it("keeps only the filter's threads, with drafts on top", () => {
    expect(ids(buildThreadColumnSections(items, "waiting", NOW))).toEqual([
      ["drafts", ["draft"]],
      ["needs", ["ask-old", "ask-new"]],
    ]);
    expect(ids(buildThreadColumnSections(items, "done", NOW))).toEqual([
      ["drafts", ["draft"]],
      ["new", ["today-late"]],
      ["opened", ["seen"]],
    ]);
    expect(buildThreadColumnSections([item("quiet")], "working", NOW)).toEqual([]);
  });

  it("lists a thread with unsent text only under Drafts, under every filter", () => {
    const typed = item("typed", { status: "working", hasDraft: true });
    expect(ids(buildThreadColumnSections([typed, item("quiet")], "working", NOW))).toEqual([
      ["drafts", ["typed"]],
    ]);
    expect(ids(buildThreadColumnSections([typed, item("quiet")], "all", NOW))).toEqual([
      ["drafts", ["typed"]],
      ["today", ["quiet"]],
    ]);
  });

  it("counts each filter without drafts", () => {
    expect(countThreadColumnFilters(items)).toEqual({ waiting: 2, working: 1, done: 2 });
  });
});

describe("buildWorkingDoneHalves", () => {
  const items = [
    item("idle", { status: "idle" }),
    item("ask", { status: "needs" }),
    item("run-old", { status: "working", sinceMs: NOW - 2 * HOUR }),
    item("run-new", { status: "working", sinceMs: NOW - HOUR }),
    item("fresh", { status: "done" }),
    item("seen", { status: "idle", doneSection: "opened" }),
    item("draft", { kind: "draft" }),
    item("finished-with-text", { status: "done", hasDraft: true }),
  ];

  it("puts Done (New, then Opened) on top and Working with its drafts below", () => {
    const halves = buildWorkingDoneHalves(items, NOW);
    expect(ids(halves.done)).toEqual([
      ["new", ["fresh"]],
      ["opened", ["seen"]],
    ]);
    expect(ids(halves.working)).toEqual([
      ["working", ["run-new", "run-old"]],
      ["drafts", ["draft", "finished-with-text"]],
    ]);
  });

  it("lists a draft once, and leaves out what neither half holds", () => {
    const halves = buildWorkingDoneHalves(items, NOW);
    const listed = [...halves.done, ...halves.working].flatMap((section) =>
      section.items.map((entry) => entry.key),
    );
    expect(listed).toHaveLength(new Set(listed).size);
    expect(listed).not.toContain("idle");
    expect(listed).not.toContain("ask");
  });

  it("leaves a half empty when it has nothing", () => {
    const halves = buildWorkingDoneHalves([item("run", { status: "working" })], NOW);
    expect(halves.done).toEqual([]);
    expect(ids(halves.working)).toEqual([["working", ["run"]]]);
  });
});

describe("resolveThreadColumnFilter", () => {
  it("combines Working or Done into one tab in a single project", () => {
    for (const filter of ["working", "done"] as const) {
      expect(
        resolveThreadColumnFilter({
          picked: { scope: "p:a", filter },
          scope: "p:a",
        }),
      ).toBe("workingDone");
    }
  });

  it("combines Working or Done into one tab in All Projects and No Project too", () => {
    for (const scope of [ALL_PROJECTS_SCOPE, "p:scratch"]) {
      for (const filter of ["working", "done", "workingDone"] as const) {
        expect(resolveThreadColumnFilter({ picked: { scope, filter }, scope })).toBe("workingDone");
      }
    }
  });

  it("opens another scope on All, or on Waiting for All Projects", () => {
    const picked = { scope: "p:a", filter: "workingDone" } as const;
    expect(resolveThreadColumnFilter({ picked, scope: "p:b" })).toBe("all");
    expect(resolveThreadColumnFilter({ picked, scope: ALL_PROJECTS_SCOPE })).toBe("waiting");
    expect(
      resolveThreadColumnFilter({
        picked: { scope: ALL_PROJECTS_SCOPE, filter: "all" },
        scope: ALL_PROJECTS_SCOPE,
      }),
    ).toBe("waiting");
  });
});

describe("resolveColumnDraftedKeys", () => {
  /** Opens threads in turn, as clicking rows does, and lists Drafts after each. */
  function clickThrough(steps: ReadonlyArray<{ route: string | null; unsent: string[] }>) {
    let latch: Parameters<typeof resolveColumnDraftedKeys>[2] = null;
    return steps.map(({ route, unsent }) => {
      const result = resolveColumnDraftedKeys(new Set(unsent), route, latch);
      latch = result.latch;
      return [...result.draftedKeys].toSorted();
    });
  }

  it("keeps a drafted thread under Drafts when it is clicked and when another row is", () => {
    expect(
      clickThrough([
        { route: null, unsent: ["a"] },
        { route: "a", unsent: ["a"] },
        { route: "b", unsent: ["a"] },
        { route: "a", unsent: ["a"] },
      ]),
    ).toEqual([["a"], ["a"], ["a"], ["a"]]);
  });

  it("does not move the open thread while you type in it or send", () => {
    expect(
      clickThrough([
        // Opened with no draft, then typed in: it stays where it was until you leave it.
        { route: "c", unsent: [] },
        { route: "c", unsent: ["c"] },
        { route: "b", unsent: ["c"] },
        // Opened from Drafts, then sent: it stays under Drafts until you leave it.
        { route: "c", unsent: ["c"] },
        { route: "c", unsent: [] },
        { route: "b", unsent: [] },
      ]),
    ).toEqual([[], [], ["c"], ["c"], ["c"], []]);
  });

  it("returns the same latch while the open thread stays", () => {
    const first = resolveColumnDraftedKeys(new Set(["a"]), "a", null);
    expect(resolveColumnDraftedKeys(new Set(["a", "b"]), "a", first.latch).latch).toBe(first.latch);
  });
});

describe("groupThreadColumnItemsByProject", () => {
  it("splits by project in the order each project first appears", () => {
    const groups = groupThreadColumnItemsByProject([
      { key: "1", projectKey: "b" },
      { key: "2", projectKey: "a" },
      { key: "3", projectKey: "b" },
    ]);
    expect(groups.map((group) => [group.projectKey, group.items.map((x) => x.key)])).toEqual([
      ["b", ["1", "3"]],
      ["a", ["2"]],
    ]);
  });
});

describe("nextThreadAfterRemoval", () => {
  const listed = ["a", "b", "c", "d"].map((key) => ({ key }));
  const next = (removed: string[], open: string | null) =>
    nextThreadAfterRemoval(listed, new Set(removed), open)?.key ?? null;

  it("moves to the next thread below that stays", () => {
    expect(next(["b"], "b")).toBe("c");
    expect(next(["b", "c"], "b")).toBe("d");
  });

  it("falls back to the nearest thread above at the end of the list", () => {
    expect(next(["c", "d"], "d")).toBe("b");
  });

  it("stays put when the open thread is not removed, or nothing is left", () => {
    expect(next(["a"], "b")).toBeNull();
    expect(next(["a", "b", "c", "d"], "b")).toBeNull();
    expect(next(["b"], null)).toBeNull();
  });
});
