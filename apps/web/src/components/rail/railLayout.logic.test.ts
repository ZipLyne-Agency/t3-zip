import { describe, expect, it } from "vite-plus/test";

import {
  applyRailDrop,
  buildRailEntries,
  createRailFolder,
  addRailProjectKey,
  materializeRailLayout,
  moveRailFolder,
  moveRailProject,
  railProjectOrder,
  railStepPlacement,
  removeRailFolder,
  renameRailFolder,
  resolveRailDrop,
  restoreRailFolder,
  revealRailProject,
  removeRailProjectKey,
  snapshotRailFolder,
  type RailLayoutState,
} from "./railLayout.logic";

// Clients holds shop and crm, Personal holds t3, notes and site, blog sits on its own.
const RAIL: RailLayoutState = {
  top: ["f:clients", "f:personal", "p:blog"],
  folders: {
    clients: { name: "Clients", collapsed: false, projects: ["shop", "crm"] },
    personal: { name: "Personal", collapsed: false, projects: ["t3", "notes", "site"] },
  },
};
const KNOWN = ["t3", "blog", "shop", "notes", "site", "crm"];

describe("materializeRailLayout", () => {
  it("appends projects the rail has never placed to the end of the top level", () => {
    expect(materializeRailLayout(RAIL, [...KNOWN, "new-one", "new-two"]).top).toEqual([
      "f:clients",
      "f:personal",
      "p:blog",
      "p:new-one",
      "p:new-two",
    ]);
  });

  it("keeps the place of a project that is not known right now", () => {
    const layout = materializeRailLayout(RAIL, ["t3"]);
    expect(layout.folders.clients?.projects).toEqual(["shop", "crm"]);
    expect(layout.top).toEqual(RAIL.top);
  });

  it("drops duplicate entries and folders that no longer exist", () => {
    const layout = materializeRailLayout(
      { top: ["p:blog", "f:gone", "f:clients", "p:shop", "p:blog"], folders: RAIL.folders },
      [],
    );
    expect(layout.top).toEqual(["p:blog", "f:clients"]);
  });
});

describe("buildRailEntries", () => {
  it("hides unknown projects but keeps folders, and lists new projects last", () => {
    const entries = buildRailEntries(RAIL, ["t3", "blog", "fresh"]);
    expect(entries).toEqual([
      { kind: "folder", folderId: "clients", name: "Clients", collapsed: false, projectKeys: [] },
      {
        kind: "folder",
        folderId: "personal",
        name: "Personal",
        collapsed: false,
        projectKeys: ["t3"],
      },
      { kind: "project", projectKey: "blog" },
      { kind: "project", projectKey: "fresh" },
    ]);
    expect(railProjectOrder(entries)).toEqual(["t3", "blog", "fresh"]);
  });
});

describe("moveRailProject", () => {
  it("moves a project within its folder", () => {
    const next = moveRailProject(RAIL, "site", {
      folderId: "personal",
      anchor: { item: "t3", side: "before" },
    });
    expect(next.folders.personal?.projects).toEqual(["site", "t3", "notes"]);
  });

  it("files a loose project into a folder at its end", () => {
    const next = moveRailProject(RAIL, "blog", { folderId: "clients", anchor: null });
    expect(next.folders.clients?.projects).toEqual(["shop", "crm", "blog"]);
    expect(next.top).toEqual(["f:clients", "f:personal"]);
  });

  it("takes a project out of a folder to sit right after it", () => {
    const next = moveRailProject(RAIL, "shop", {
      folderId: null,
      anchor: { item: "f:clients", side: "after" },
    });
    expect(next.top).toEqual(["f:clients", "p:shop", "f:personal", "p:blog"]);
    expect(next.folders.clients?.projects).toEqual(["crm"]);
  });

  it("ignores a move onto itself and a missing folder", () => {
    expect(
      moveRailProject(RAIL, "blog", { folderId: null, anchor: { item: "p:blog", side: "after" } }),
    ).toBe(RAIL);
    expect(moveRailProject(RAIL, "blog", { folderId: "nope", anchor: null })).toBe(RAIL);
  });
});

describe("moveRailFolder", () => {
  it("moves a folder among top-level entries", () => {
    expect(moveRailFolder(RAIL, "clients", { item: "p:blog", side: "after" }).top).toEqual([
      "f:personal",
      "p:blog",
      "f:clients",
    ]);
  });
});

describe("railStepPlacement", () => {
  const personal = ["t3", "notes", "site"];

  it.each([
    ["notes", "up", { folderId: "personal", anchor: { item: "t3", side: "before" } }],
    ["notes", "down", { folderId: "personal", anchor: { item: "site", side: "after" } }],
    ["t3", "up", null],
    ["site", "down", null],
  ] as const)("moves %s %s inside its folder", (item, direction, expected) => {
    expect(railStepPlacement(personal, item, "personal", direction)).toEqual(expected);
  });

  it("moves a project one step and back to where it was", () => {
    const down = railStepPlacement(personal, "t3", "personal", "down")!;
    const moved = moveRailProject(RAIL, "t3", down);
    expect(moved.folders.personal?.projects).toEqual(["notes", "t3", "site"]);
    const up = railStepPlacement(moved.folders.personal!.projects, "t3", "personal", "up")!;
    expect(moveRailProject(moved, "t3", up).folders.personal?.projects).toEqual(personal);
  });
});

describe("createRailFolder", () => {
  it("adds an empty folder at the top of the list", () => {
    const next = createRailFolder(RAIL, { folderId: "new", name: "New Folder" });
    expect(next.top[0]).toBe("f:new");
    expect(next.folders.new).toEqual({ name: "New Folder", collapsed: false, projects: [] });
  });

  it("wraps a loose project in place", () => {
    const next = createRailFolder(RAIL, {
      folderId: "new",
      name: "New Folder",
      projectKey: "blog",
    });
    expect(next.top).toEqual(["f:clients", "f:personal", "f:new"]);
    expect(next.folders.new?.projects).toEqual(["blog"]);
  });

  it("puts a project from a folder into a new folder right after that folder", () => {
    const next = createRailFolder(RAIL, {
      folderId: "new",
      name: "New Folder",
      projectKey: "crm",
    });
    expect(next.top).toEqual(["f:clients", "f:new", "f:personal", "p:blog"]);
    expect(next.folders.clients?.projects).toEqual(["shop"]);
  });
});

describe("renameRailFolder", () => {
  it.each([
    ["  Work  ", "Work"],
    ["", "Clients"],
    ["   ", "Clients"],
  ])("renames to %j as %j", (name, expected) => {
    expect(renameRailFolder(RAIL, "clients", name).folders.clients?.name).toBe(expected);
  });
});

describe("removeRailFolder", () => {
  it("keeps its projects in the folder's place", () => {
    const next = removeRailFolder(RAIL, "personal");
    expect(next.top).toEqual(["f:clients", "p:t3", "p:notes", "p:site", "p:blog"]);
    expect(next.folders.personal).toBeUndefined();
    expect(next.folders.clients).toBe(RAIL.folders.clients);
  });
});

describe("restoreRailFolder", () => {
  it("puts a removed folder back in its place with its projects", () => {
    const removed = snapshotRailFolder(RAIL, "personal")!;
    expect(restoreRailFolder(removeRailFolder(RAIL, "personal"), removed)).toEqual(RAIL);
  });

  it("leaves a project moved into another folder since, and keeps other changes", () => {
    const removed = snapshotRailFolder(RAIL, "personal")!;
    const moved = moveRailProject(removeRailFolder(RAIL, "personal"), "notes", {
      folderId: "clients",
      anchor: null,
    });
    const restored = restoreRailFolder(
      moveRailFolder(moved, "clients", { item: "p:blog", side: "after" }),
      removed,
    );
    expect(restored.top).toEqual(["f:personal", "p:blog", "f:clients"]);
    expect(restored.folders.personal?.projects).toEqual(["t3", "site"]);
    expect(restored.folders.clients?.projects).toEqual(["shop", "crm", "notes"]);
  });
});

describe("revealRailProject", () => {
  it("opens a folded folder that holds the project and leaves others alone", () => {
    const folded = {
      ...RAIL,
      folders: { ...RAIL.folders, personal: { ...RAIL.folders.personal!, collapsed: true } },
    };
    expect(revealRailProject(folded, "notes").folders.personal?.collapsed).toBe(false);
    expect(revealRailProject(folded, "blog")).toBe(folded);
  });
});

describe("resolveRailDrop", () => {
  const t3Row = {
    kind: "project",
    projectKey: "t3",
    folderId: "personal",
    lastRowKey: "p:site",
  } as const;
  const blogRow = {
    kind: "project",
    projectKey: "blog",
    folderId: null,
    lastRowKey: "p:blog",
  } as const;
  const clientsRow = { kind: "folder", folderId: "clients", lastRowKey: "p:crm" } as const;

  it("drops a project above or below a project in a folder", () => {
    const drag = { kind: "project", projectKey: "blog" } as const;
    expect(resolveRailDrop(drag, t3Row, 0.2)).toEqual({
      kind: "line",
      rowKey: "p:t3",
      edge: "top",
      placement: { folderId: "personal", anchor: { item: "t3", side: "before" } },
    });
    expect(resolveRailDrop(drag, t3Row, 0.8)?.placement).toEqual({
      folderId: "personal",
      anchor: { item: "t3", side: "after" },
    });
  });

  it("files a project dropped on a folder's name, and the top edge means above the folder", () => {
    const drag = { kind: "project", projectKey: "blog" } as const;
    expect(resolveRailDrop(drag, clientsRow, 0.6)).toEqual({
      kind: "into",
      folderId: "clients",
      placement: { folderId: "clients", anchor: null },
    });
    expect(resolveRailDrop(drag, clientsRow, 0.1)?.placement).toEqual({
      folderId: null,
      anchor: { item: "f:clients", side: "before" },
    });
  });

  it("never nests a folder: over another folder's projects it lands after that folder", () => {
    const drag = { kind: "folder", folderId: "clients" } as const;
    expect(resolveRailDrop(drag, t3Row, 0.1)).toEqual({
      kind: "line",
      rowKey: "p:site",
      edge: "bottom",
      placement: { folderId: null, anchor: { item: "f:personal", side: "after" } },
    });
    expect(resolveRailDrop(drag, blogRow, 0.2)?.placement).toEqual({
      folderId: null,
      anchor: { item: "p:blog", side: "before" },
    });
    expect(resolveRailDrop(drag, clientsRow, 0.5)).toBeNull();
  });

  it("applies a folder drop as a top-level move", () => {
    const drag = { kind: "folder", folderId: "clients" } as const;
    const drop = resolveRailDrop(drag, t3Row, 0.9)!;
    expect(applyRailDrop(RAIL, drag, drop).top).toEqual(["f:personal", "f:clients", "p:blog"]);
  });
});

describe("hidden projects", () => {
  const visible = (state: RailLayoutState, hidden: readonly string[]) =>
    railProjectOrder(buildRailEntries(state, KNOWN, hidden));

  it("leaves a hidden project out of the rows, folders included", () => {
    const hidden = addRailProjectKey([], "notes");
    const entries = buildRailEntries(RAIL, KNOWN, hidden);
    expect(
      entries.find((entry) => entry.kind === "folder" && entry.folderId === "personal"),
    ).toMatchObject({ projectKeys: ["t3", "site"] });
    expect(visible(RAIL, hidden)).not.toContain("notes");
  });

  it("puts a shown project back in its folder and position, even after other moves", () => {
    const hidden = addRailProjectKey([], "notes");
    // While notes is hidden, site moves above t3 and blog moves into Clients.
    const moved = moveRailProject(
      moveRailProject(RAIL, "site", {
        folderId: "personal",
        anchor: { item: "t3", side: "before" },
      }),
      "blog",
      { folderId: "clients", anchor: null },
    );
    const shown = removeRailProjectKey(hidden, "notes");
    expect(shown).toEqual([]);
    expect(moved.folders.personal?.projects).toEqual(["site", "t3", "notes"]);
    expect(visible(moved, shown)).toEqual(["shop", "crm", "blog", "site", "t3", "notes"]);
  });

  it("keeps a hidden top-level project at the top level", () => {
    const hidden = addRailProjectKey([], "blog");
    expect(visible(RAIL, hidden)).toEqual(["shop", "crm", "t3", "notes", "site"]);
    expect(visible(RAIL, removeRailProjectKey(hidden, "blog")).at(-1)).toBe("blog");
  });

  it("does not list a project twice or change lists that do not need it", () => {
    const hidden = addRailProjectKey([], "t3");
    expect(addRailProjectKey(hidden, "t3")).toBe(hidden);
    expect(removeRailProjectKey(hidden, "blog")).toBe(hidden);
  });
});
