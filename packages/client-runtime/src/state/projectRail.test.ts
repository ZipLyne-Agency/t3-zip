import { describe, expect, it } from "vite-plus/test";

import {
  isEmptySharedProjectRail,
  nextProjectRailEditTime,
  localProjectRailFromShared,
  railLayoutFromShared,
  resolveProjectRailSync,
  sameSharedProjectRail,
  sharedProjectRailContentFromLocal,
  sharedProjectRailFromLocal,
  type LocalProjectRail,
  type SharedProjectRail,
} from "./projectRail.ts";

const LOCAL: LocalProjectRail = {
  layout: {
    top: ["f:clients", "p:blog"],
    folders: {
      clients: { name: "Clients", collapsed: true, projects: ["shop", "crm"] },
    },
  },
  favoriteProjects: ["blog"],
  hiddenProjects: ["crm"],
  snoozedProjects: { shop: "2026-11-23T09:00:00.000Z" },
};

const SHARED: SharedProjectRail = {
  layout: {
    top: ["f:clients", "p:blog"],
    folders: { clients: { name: "Clients", projects: ["shop", "crm"] } },
  },
  favoriteProjects: ["blog"],
  hiddenProjects: ["crm"],
  snoozedProjects: { shop: "2026-11-23T09:00:00.000Z" },
  updatedAt: "2026-11-22T10:00:00.000Z",
};

const EMPTY = {
  layout: { top: [], folders: {} },
  favoriteProjects: [],
  hiddenProjects: [],
  snoozedProjects: {},
};

describe("shared project rail conversions", () => {
  it("leaves folder folding out of the shared value and stamps the write time", () => {
    expect(sharedProjectRailFromLocal(LOCAL, SHARED.updatedAt)).toEqual(SHARED);
    expect(sharedProjectRailContentFromLocal(LOCAL).layout.folders.clients).toEqual({
      name: "Clients",
      projects: ["shop", "crm"],
    });
  });

  it("keeps each folder's folding on this device and opens folders it has not seen", () => {
    const shared = {
      ...SHARED,
      layout: {
        top: ["f:new", ...SHARED.layout.top],
        folders: { ...SHARED.layout.folders, new: { name: "New", projects: ["site"] } },
      },
    };
    const layout = railLayoutFromShared(shared.layout, LOCAL.layout);
    expect(layout.folders.clients?.collapsed).toBe(true);
    expect(layout.folders.new?.collapsed).toBe(false);
    expect(railLayoutFromShared(shared.layout).folders.clients?.collapsed).toBe(false);
  });

  it("round-trips a device rail through the shared shape", () => {
    expect(localProjectRailFromShared(SHARED, LOCAL.layout)).toEqual(LOCAL);
  });

  it("compares content and ignores the write time", () => {
    const older: SharedProjectRail = { ...SHARED, updatedAt: "2020-01-01T00:00:00Z" };
    expect(sameSharedProjectRail(SHARED, older)).toBe(true);
    expect(sameSharedProjectRail(SHARED, { ...SHARED, hiddenProjects: [] })).toBe(false);
    expect(
      sameSharedProjectRail(SHARED, {
        ...SHARED,
        layout: { ...SHARED.layout, folders: { clients: { name: "Work", projects: ["shop"] } } },
      }),
    ).toBe(false);
    expect(sameSharedProjectRail(SHARED, { ...SHARED, snoozedProjects: {} })).toBe(false);
  });

  it("knows an empty rail", () => {
    expect(isEmptySharedProjectRail(EMPTY)).toBe(true);
    expect(isEmptySharedProjectRail(SHARED)).toBe(false);
  });
});

describe("resolveProjectRailSync", () => {
  const local = sharedProjectRailContentFromLocal(LOCAL);

  it("seeds a server that has no rail, or an empty one, from a device rail", () => {
    expect(resolveProjectRailSync({ server: undefined, local, pendingSince: null })).toEqual({
      kind: "push",
    });
    expect(
      resolveProjectRailSync({
        server: { ...EMPTY, updatedAt: "2026-11-22T12:00:00.000Z" },
        local,
        pendingSince: null,
      }),
    ).toEqual({ kind: "push" });
  });

  it("does nothing when neither side has a rail", () => {
    expect(resolveProjectRailSync({ server: undefined, local: EMPTY, pendingSince: null })).toEqual(
      { kind: "none" },
    );
  });

  it("does nothing when the server already holds the same rail", () => {
    expect(
      resolveProjectRailSync({ server: SHARED, local, pendingSince: "2026-11-22T11:00:00.000Z" }),
    ).toEqual({ kind: "none" });
  });

  it("takes the server's rail when this device has no unconfirmed edit, whatever the clocks say", () => {
    const server = { ...SHARED, hiddenProjects: [], updatedAt: "2000-01-01T00:00:00.000Z" };
    expect(resolveProjectRailSync({ server, local, pendingSince: null })).toEqual({
      kind: "adopt",
      rail: server,
    });
  });

  it("keeps a newer unconfirmed edit over an older server value", () => {
    const server = { ...SHARED, hiddenProjects: [] };
    expect(
      resolveProjectRailSync({ server, local, pendingSince: "2026-11-22T10:00:01.000Z" }),
    ).toEqual({ kind: "push" });
    expect(
      resolveProjectRailSync({ server, local, pendingSince: "2026-11-22T09:59:59.000Z" }),
    ).toEqual({ kind: "adopt", rail: server });
  });
});

describe("nextProjectRailEditTime", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");

  it("stamps an edit now, or just after a server value stamped ahead of this clock", () => {
    expect(nextProjectRailEditTime(now, null)).toBe("2026-11-22T12:00:00.000Z");
    expect(nextProjectRailEditTime(now, "2026-11-22T11:00:00.000Z")).toBe(
      "2026-11-22T12:00:00.000Z",
    );
    expect(nextProjectRailEditTime(now, "2030-01-01T00:00:00.000Z")).toBe(
      "2030-01-01T00:00:00.001Z",
    );
    expect(nextProjectRailEditTime(now, "not a time")).toBe("2026-11-22T12:00:00.000Z");
  });

  it("makes an edit on a rail adopted from a fast clock win over that value", () => {
    const server = { ...SHARED, updatedAt: "2030-01-01T00:00:00.000Z" };
    const edited = { ...sharedProjectRailContentFromLocal(LOCAL), hiddenProjects: [] };
    expect(
      resolveProjectRailSync({
        server,
        local: edited,
        pendingSince: nextProjectRailEditTime(now, server.updatedAt),
      }),
    ).toEqual({ kind: "push" });
  });
});
