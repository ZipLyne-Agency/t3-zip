import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectDrawerModel,
  editSharedProjectRail,
  effectiveProjectRail,
  favoriteProjectDrawerItems,
  primaryProjectRail,
  projectsToBringBack,
  visibleProjectDrawerItems,
  type ProjectRailChange,
  type SharedProjectRail,
} from "./project-drawer";
import type { ProjectSwitcherRow } from "./project-switcher";

const NOW_MS = Date.parse("2026-11-22T10:00:00.000Z");

function projectRow(key: string, waitingCount = 0): ProjectSwitcherRow & { key: string } {
  return { key, kind: "project", title: key, waitingCount, lastActiveMs: null, project: null };
}

const fixed: ProjectSwitcherRow[] = [
  {
    key: "scratch",
    kind: "none",
    title: "No Project",
    waitingCount: 0,
    lastActiveMs: null,
    project: null,
  },
  {
    key: null,
    kind: "all",
    title: "All Projects",
    waitingCount: 3,
    lastActiveMs: null,
    project: null,
  },
];

// Recent order on the phone: d, c, b, a, e.
const recent = [
  projectRow("d"),
  projectRow("c", 1),
  projectRow("b", 2),
  projectRow("a"),
  projectRow("e"),
];
const knownProjectKeys = recent.map((row) => row.key);

function rail(overrides: Partial<SharedProjectRail> = {}): SharedProjectRail {
  return {
    layout: {
      top: ["p:a", "f:work", "p:missing", "p:d"],
      folders: { work: { name: "Work", projects: ["b", "c"] } },
    },
    favoriteProjects: ["c"],
    hiddenProjects: [],
    snoozedProjects: {},
    updatedAt: "2026-11-22T09:00:00.000Z",
    ...overrides,
  };
}

function shape(model: ReturnType<typeof buildProjectDrawerModel>) {
  return model.items.map((item) =>
    item.kind === "folder"
      ? `[${item.name}${item.collapsed ? " folded" : ""} ${item.projectCount}/${item.waitingCount}]`
      : `${item.folderId === null ? "" : "  "}${item.row.key}${item.favorite ? "*" : ""}`,
  );
}

describe("project drawer rows", () => {
  it("follows the shared order, skips unknown keys and appends new projects", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: rail(),
      collapsedFolders: new Set(),
      nowMs: NOW_MS,
    });
    expect(model.shared).toBe(true);
    expect(model.fixed.map((row) => row.kind)).toEqual(["none", "all"]);
    expect(shape(model)).toEqual(["a", "[Work 2/3]", "  b", "  c*", "d", "e"]);
    expect(model.folders).toEqual([{ folderId: "work", name: "Work" }]);
  });

  it("leaves hidden and snoozed projects out but lists them for their shelves", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: rail({
        hiddenProjects: ["b"],
        snoozedProjects: {
          d: "2026-11-22T12:00:00.000Z",
          // Woken already: back in the list.
          e: "2026-11-22T08:00:00.000Z",
        },
      }),
      collapsedFolders: new Set(),
      nowMs: NOW_MS,
    });
    expect(shape(model)).toEqual(["a", "[Work 1/1]", "  c*", "e"]);
    expect(model.hidden.map((row) => row.key)).toEqual(["b"]);
    expect(model.snoozed.map((entry) => [entry.row.key, entry.until])).toEqual([
      ["d", "2026-11-22T12:00:00.000Z"],
    ]);
  });

  it("folds folders on this device", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: rail(),
      collapsedFolders: new Set(["work"]),
      nowMs: NOW_MS,
    });
    expect(
      visibleProjectDrawerItems(model.items).map((item) =>
        item.kind === "folder" ? `[${item.name}]` : item.row.key,
      ),
    ).toEqual(["a", "[Work]", "d", "e"]);
  });

  it("lists only favorites in rail order, folded folders included", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: rail({ favoriteProjects: ["d", "c", "missing"] }),
      collapsedFolders: new Set(["work"]),
      nowMs: NOW_MS,
    });
    const favorites = favoriteProjectDrawerItems(model.items);
    expect(
      visibleProjectDrawerItems(favorites).map((item) =>
        item.kind === "folder" ? `[${item.name}]` : item.row.key,
      ),
    ).toEqual(["c", "d"]);
    expect(favorites.every((item) => !item.canMoveUp && !item.canMoveDown)).toBe(true);
    // Each favorite keeps its folder for its menu.
    expect(favorites.map((item) => item.kind === "project" && item.folderId)).toEqual([
      "work",
      null,
    ]);
  });

  it("keeps recent order with no layout actions when the server has no shared rail", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: null,
      collapsedFolders: new Set(),
      nowMs: NOW_MS,
    });
    expect(model.shared).toBe(false);
    expect(shape(model)).toEqual(["d", "c", "b", "a", "e"]);
    expect(model.items.every((item) => !item.canMoveUp && !item.canMoveDown)).toBe(true);
    expect(model.hidden).toEqual([]);
  });

  it("offers Move Up and Move Down only where a row can move", () => {
    const model = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: rail(),
      collapsedFolders: new Set(),
      nowMs: NOW_MS,
    });
    const moves = model.items.map((item) =>
      [item.kind === "folder" ? item.name : item.row.key, item.canMoveUp, item.canMoveDown].join(
        ":",
      ),
    );
    expect(moves).toEqual([
      "a:false:true",
      "Work:true:true",
      "b:false:true",
      "c:true:false",
      "d:true:true",
      "e:true:false",
    ]);
  });
});

describe("project drawer menu actions", () => {
  const context = { knownProjectKeys, nowMs: NOW_MS };
  const edit = (change: ProjectRailChange, from = rail()) => {
    const next = editSharedProjectRail(from, change, context);
    if (next === null) throw new Error("expected a change");
    return next;
  };

  it("moves a loose project and keeps unknown keys in place", () => {
    const next = edit({ kind: "step-project", projectKey: "d", direction: "up" });
    // Every known project is placed first, as desktop does before a change; "missing" has no
    // project here, so d steps over the folder, the row above it on the phone.
    expect(next.layout.top).toEqual(["p:a", "p:d", "f:work", "p:missing", "p:e"]);
    const down = edit({ kind: "step-project", projectKey: "a", direction: "down" });
    expect(down.layout.top).toEqual(["f:work", "p:a", "p:missing", "p:d", "p:e"]);
  });

  it("moves a project inside its folder", () => {
    const next = edit({ kind: "step-project", projectKey: "c", direction: "up" });
    expect(next.layout.folders.work?.projects).toEqual(["c", "b"]);
  });

  it("moves over hidden projects without moving them", () => {
    const next = edit(
      { kind: "step-project", projectKey: "e", direction: "up" },
      rail({ hiddenProjects: ["d"] }),
    );
    expect(next.layout.top).toEqual(["p:a", "p:e", "f:work", "p:missing", "p:d"]);
    expect(next.hiddenProjects).toEqual(["d"]);
  });

  it("files a project in a folder and takes it out after the folder", () => {
    const filed = edit({ kind: "set-folder", projectKey: "a", folderId: "work" });
    expect(filed.layout.top).toEqual(["f:work", "p:missing", "p:d", "p:e"]);
    expect(filed.layout.folders.work?.projects).toEqual(["b", "c", "a"]);
    const out = edit({ kind: "set-folder", projectKey: "b", folderId: null });
    expect(out.layout.top).toEqual(["p:a", "f:work", "p:b", "p:missing", "p:d", "p:e"]);
    expect(out.layout.folders.work?.projects).toEqual(["c"]);
    expect(
      editSharedProjectRail(
        rail(),
        { kind: "set-folder", projectKey: "b", folderId: "work" },
        context,
      ),
    ).toBeNull();
  });

  it("makes a folder from a project in the project's place", () => {
    const next = edit({ kind: "new-folder", folderId: "new", name: "Clients", projectKey: "d" });
    expect(next.layout.top).toEqual(["p:a", "f:work", "p:missing", "f:new", "p:e"]);
    expect(next.layout.folders.new).toEqual({ name: "Clients", projects: ["d"] });
  });

  it("renames, moves and removes a folder, keeping its projects", () => {
    expect(
      edit({ kind: "rename-folder", folderId: "work", name: "  Jobs " }).layout.folders.work?.name,
    ).toBe("Jobs");
    expect(edit({ kind: "step-folder", folderId: "work", direction: "up" }).layout.top).toEqual([
      "f:work",
      "p:a",
      "p:missing",
      "p:d",
      "p:e",
    ]);
    const removed = edit({ kind: "remove-folder", folderId: "work" });
    expect(removed.layout.top).toEqual(["p:a", "p:b", "p:c", "p:missing", "p:d", "p:e"]);
    expect(removed.layout.folders).toEqual({});
  });

  it("favorites, hides, shows, snoozes and wakes without touching the order", () => {
    const before = rail();
    const favorite = edit({ kind: "favorite", projectKey: "a", favorite: true });
    expect(favorite.favoriteProjects).toEqual(["c", "a"]);
    expect(edit({ kind: "favorite", projectKey: "c", favorite: false }).favoriteProjects).toEqual(
      [],
    );
    const hidden = edit({ kind: "hide", projectKey: "b" });
    expect(hidden.hiddenProjects).toEqual(["b"]);
    expect(hidden.layout.folders.work?.projects).toEqual(before.layout.folders.work?.projects);
    expect(edit({ kind: "show", projectKey: "b" }, hidden).hiddenProjects).toEqual([]);
    const snoozed = edit({ kind: "snooze", projectKey: "d", until: "2026-11-23T09:00:00.000Z" });
    expect(snoozed.snoozedProjects).toEqual({ d: "2026-11-23T09:00:00.000Z" });
    expect(snoozed.layout.top).toContain("p:d");
    expect(edit({ kind: "wake", projectKey: "d" }, snoozed).snoozedProjects).toEqual({});
  });

  it("stamps each write later than the value it replaces", () => {
    const ahead = rail({ updatedAt: "2026-11-22T11:00:00.000Z" });
    const next = edit({ kind: "hide", projectKey: "a" }, ahead);
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(ahead.updatedAt));
    expect(edit({ kind: "hide", projectKey: "a" }).updatedAt).toBe(new Date(NOW_MS).toISOString());
  });
});

describe("project drawer writes", () => {
  it("shows the edit until the server's value changes", () => {
    const server = rail();
    const pending = { base: server.updatedAt, rail: rail({ hiddenProjects: ["a"] }) };
    expect(effectiveProjectRail(server, pending)).toBe(pending.rail);
    const newer = rail({ updatedAt: "2026-11-22T10:00:01.000Z" });
    expect(effectiveProjectRail(newer, pending)).toBe(newer);
    expect(effectiveProjectRail(server, null)).toBe(server);
  });

  it("brings back hidden and snoozed projects a message was sent in", () => {
    const changes = projectsToBringBack(
      rail({
        hiddenProjects: ["a"],
        snoozedProjects: { a: "2026-11-23T00:00:00.000Z", b: "2026-11-23T00:00:00.000Z" },
      }),
      ["a", "a", "c"],
    );
    expect(changes).toEqual([
      { kind: "show", projectKey: "a" },
      { kind: "wake", projectKey: "a" },
    ]);
  });

  it("shows a project that is only hidden and wakes one that is only snoozed", () => {
    const current = rail({
      hiddenProjects: ["b"],
      snoozedProjects: { d: "2026-11-23T00:00:00.000Z" },
    });
    expect(projectsToBringBack(current, ["b"])).toEqual([{ kind: "show", projectKey: "b" }]);
    expect(projectsToBringBack(current, ["d"])).toEqual([{ kind: "wake", projectKey: "d" }]);
    expect(projectsToBringBack(current, ["a"])).toEqual([]);
  });
});

describe("project drawer primary environment", () => {
  it("reads the first environment with a seeded rail and skips missing or empty ones", () => {
    const empty = rail({
      layout: { top: [], folders: {} },
      favoriteProjects: [],
      hiddenProjects: [],
      snoozedProjects: {},
    });
    const mac = rail({ hiddenProjects: ["a"] });
    expect(
      primaryProjectRail([
        { environmentId: "old", rail: undefined },
        { environmentId: "fresh", rail: empty },
        { environmentId: "mac", rail: mac },
        { environmentId: "box", rail: rail() },
      ]),
    ).toEqual({ environmentId: "mac", rail: mac });
    expect(primaryProjectRail([{ environmentId: "fresh", rail: empty }])).toBeNull();
  });
});
