import type {
  SharedProjectRail,
  SharedProjectRailContent,
} from "@t3tools/client-runtime/state/project-rail";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createProjectRailSync, type ServerProjectRail } from "./railSync.logic";

const env = EnvironmentId.make("primary");

const EMPTY: SharedProjectRailContent = {
  layout: { top: [], folders: {} },
  favoriteProjects: [],
  hiddenProjects: [],
  snoozedProjects: {},
};

const WORK: SharedProjectRailContent = {
  layout: { top: ["f:work", "p:blog"], folders: { work: { name: "Work", projects: ["shop"] } } },
  favoriteProjects: ["blog"],
  hiddenProjects: [],
  snoozedProjects: {},
};

const PHONE: SharedProjectRail = {
  ...WORK,
  favoriteProjects: ["blog", "shop"],
  updatedAt: "2026-11-22T10:00:00.000Z",
};

/** A server and a device wired through the sync, with writes settled by hand. */
function harness(input: {
  server: ServerProjectRail | null;
  local: SharedProjectRailContent;
  pendingSince: string | null;
  canWrite?: boolean;
  neverSynced?: boolean;
}) {
  let server = input.server;
  let local = input.local;
  let pendingSince = input.pendingSince;
  const writes: SharedProjectRail[] = [];
  const backups: SharedProjectRail[] = [];
  let neverSynced = input.neverSynced ?? false;
  const settle: Array<(saved: boolean) => void> = [];
  const sync = createProjectRailSync({
    readServer: () => server,
    readLocal: () => ({ content: local, pendingSince, neverSynced }),
    canWrite: () => input.canWrite ?? true,
    write: (_environmentId, rail) => {
      writes.push(rail);
      return new Promise<boolean>((resolve) => settle.push(resolve));
    },
    adopt: (rail) => {
      const { updatedAt: _updatedAt, ...content } = rail;
      local = content;
      pendingSince = null;
      neverSynced = false;
    },
    confirm: () => {
      pendingSince = null;
      neverSynced = false;
    },
    backUpReplacedServerRail: (rail) => backups.push(rail),
    now: () => "2026-11-22T12:00:00.000Z",
  });
  return {
    sync,
    writes,
    backups,
    get local() {
      return local;
    },
    get pendingSince() {
      return pendingSince;
    },
    setServer: (projectRail: SharedProjectRail | undefined) => {
      server = { environmentId: env, projectRail };
    },
    edit: (content: SharedProjectRailContent, at: string) => {
      local = content;
      pendingSince = at;
    },
    /** Settles the oldest write and lets its follow-up run. */
    settle: async (saved: boolean) => {
      settle.shift()?.(saved);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("project rail sync", () => {
  it("does nothing until the server's live settings arrive", () => {
    const h = harness({ server: null, local: WORK, pendingSince: "2026-11-22T09:00:00.000Z" });
    h.sync.run();
    expect(h.writes).toEqual([]);
  });

  it("seeds a server without a rail once, stamped with the edit time, and never echoes it", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    expect(h.writes).toEqual([{ ...WORK, updatedAt: "2026-11-22T09:00:00.000Z" }]);
    await h.settle(true);
    h.setServer(h.writes[0]);
    h.sync.run();
    h.sync.run();
    expect(h.writes).toHaveLength(1);
    expect(h.pendingSince).toBeNull();
  });

  it("never lets a missing or empty server value replace the device rail", () => {
    const h = harness({
      server: {
        environmentId: env,
        projectRail: { ...EMPTY, updatedAt: "2030-01-01T00:00:00.000Z" },
      },
      local: WORK,
      pendingSince: null,
    });
    h.sync.run();
    expect(h.local).toEqual(WORK);
    expect(h.writes).toHaveLength(1);
  });

  it("takes the phone's change live without sending it back", () => {
    const h = harness({
      server: { environmentId: env, projectRail: { ...WORK, updatedAt: "2026-11-22T09:00:00Z" } },
      local: WORK,
      pendingSince: null,
    });
    h.sync.run();
    h.setServer(PHONE);
    h.sync.run();
    expect(h.local.favoriteProjects).toEqual(["blog", "shop"]);
    h.sync.run();
    expect(h.writes).toEqual([]);
  });

  it("keeps a newer local edit over an older server value arriving after it", () => {
    const h = harness({ server: null, local: WORK, pendingSince: "2026-11-22T11:00:00.000Z" });
    h.setServer(PHONE);
    h.sync.run();
    expect(h.local).toEqual(WORK);
    expect(h.writes).toEqual([{ ...WORK, updatedAt: "2026-11-22T11:00:00.000Z" }]);
  });

  it("keeps a rail saved before syncing when the phone wrote first", () => {
    // The store marks a pre-sync rail as an edit made at load time.
    const h = harness({ server: null, local: WORK, pendingSince: "2026-11-22T11:30:00.000Z" });
    h.setServer({ ...EMPTY, favoriteProjects: ["site"], updatedAt: "2026-11-22T10:00:00.000Z" });
    h.sync.run();
    expect(h.local).toEqual(WORK);
    expect(h.writes).toHaveLength(1);
  });

  it("sends one write at a time and the latest change after it", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    const later = { ...WORK, hiddenProjects: ["shop"] };
    h.edit(later, "2026-11-22T09:01:00.000Z");
    h.sync.run();
    expect(h.writes).toHaveLength(1);
    await h.settle(true);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual({ ...later, updatedAt: "2026-11-22T09:01:00.000Z" });
  });

  it("keeps the local value after a failed write and sends it again on the next change", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    await h.settle(false);
    expect(h.local).toEqual(WORK);
    expect(h.pendingSince).not.toBeNull();
    h.edit({ ...WORK, favoriteProjects: [] }, "2026-11-22T09:01:00.000Z");
    h.sync.run();
    expect(h.writes).toHaveLength(2);
  });

  it("writes once per change to an older server that drops the field", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    await h.settle(true);
    h.sync.run();
    h.sync.run();
    expect(h.writes).toHaveLength(1);
    h.edit({ ...WORK, hiddenProjects: ["blog"] }, "2026-11-22T09:05:00.000Z");
    h.sync.run();
    expect(h.writes).toHaveLength(2);
  });

  it("does not write without permission", () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
      canWrite: false,
    });
    h.sync.run();
    expect(h.writes).toEqual([]);
  });

  it("decides nothing while a write is in flight, then looks again", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    h.setServer(PHONE);
    h.sync.run();
    expect(h.local).toEqual(WORK);
    await h.settle(true);
    // The phone's value is newer than this device's edit, so it is taken once the write settles.
    expect(h.local.favoriteProjects).toEqual(["blog", "shop"]);
  });

  it("does not resend a failed write on unrelated updates, only when a rail changes", async () => {
    const h = harness({
      server: { environmentId: env, projectRail: undefined },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
    });
    h.sync.run();
    await h.settle(false);
    h.sync.run();
    h.sync.run();
    expect(h.writes).toHaveLength(1);
    h.edit({ ...WORK, hiddenProjects: ["shop"] }, "2026-11-22T09:02:00.000Z");
    h.sync.run();
    expect(h.writes).toHaveLength(2);
  });

  it("keeps a copy of a server rail that a never-synced device replaces", () => {
    const server = { ...PHONE, updatedAt: "2026-11-22T08:00:00.000Z" };
    const h = harness({
      server: { environmentId: env, projectRail: server },
      local: WORK,
      pendingSince: "2026-11-22T09:00:00.000Z",
      neverSynced: true,
    });
    h.sync.run();
    expect(h.backups).toEqual([server]);
    expect(h.writes).toHaveLength(1);
  });
});
