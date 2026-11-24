import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { drawerProjectResults, drawerThreadResults } from "./drawer-search";
import { buildProjectDrawerModel, type SharedProjectRail } from "./project-drawer";
import type { ProjectSwitcherRow } from "./project-switcher";

const NOW_MS = Date.parse("2026-11-22T10:00:00.000Z");
const environmentId = EnvironmentId.make("environment-1");

function projectRow(key: string, title: string): ProjectSwitcherRow & { key: string } {
  return { key, kind: "project", title, waitingCount: 0, lastActiveMs: null, project: null };
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
    waitingCount: 0,
    lastActiveMs: null,
    project: null,
  },
];
const recent = [
  projectRow("a", "Alpha app"),
  projectRow("b", "Beta app"),
  projectRow("c", "Gamma app"),
  projectRow("d", "Delta app"),
  projectRow("e", "Epsilon"),
];

function rail(overrides: Partial<SharedProjectRail> = {}): SharedProjectRail {
  return {
    layout: {
      top: ["p:a", "f:work", "p:d", "p:e"],
      folders: { work: { name: "Work", projects: ["b", "c"] } },
    },
    favoriteProjects: ["e"],
    hiddenProjects: [],
    snoozedProjects: {},
    updatedAt: "2026-11-22T09:00:00.000Z",
    ...overrides,
  };
}

describe("drawerProjectResults", () => {
  const sharedRail = rail({
    hiddenProjects: ["b", "c"],
    snoozedProjects: {
      c: "2026-11-23T00:00:00.000Z",
      d: "2026-11-23T00:00:00.000Z",
      // Ran out: back in the list.
      e: "2026-11-22T09:00:00.000Z",
    },
  });
  const model = buildProjectDrawerModel({
    rows: { fixed, recent },
    rail: sharedRail,
    collapsedFolders: new Set(["work"]),
    nowMs: NOW_MS,
  });
  const results = (query: string) =>
    drawerProjectResults({ model, rail: sharedRail, query, nowMs: NOW_MS }).map(({ row, away }) =>
      away === null
        ? `${row.key}:listed`
        : away.kind === "snoozed"
          ? `${row.key}:snoozed:${away.until}`
          : `${row.key}:hidden`,
    );

  it("includes hidden and snoozed projects with their state, hidden winning", () => {
    expect(results("app")).toEqual([
      "a:listed",
      "b:hidden",
      "c:hidden",
      "d:snoozed:2026-11-23T00:00:00.000Z",
    ]);
  });

  it("matches the fixed rows and ignores Favorites Only, folded folders and run-out snoozes", () => {
    expect(results("projects")).toEqual(["null:listed"]);
    expect(results("eps")).toEqual(["e:listed"]);
  });

  it("returns nothing without a query or a match", () => {
    expect(results("  ")).toEqual([]);
    expect(results("zzzzz")).toEqual([]);
  });

  it("lists every match without a shared rail", () => {
    const plain = buildProjectDrawerModel({
      rows: { fixed, recent },
      rail: null,
      collapsedFolders: new Set(),
      nowMs: NOW_MS,
    });
    expect(
      drawerProjectResults({ model: plain, rail: null, query: "beta", nowMs: NOW_MS }).map(
        ({ row, away }) => [row.key, away],
      ),
    ).toEqual([["b", null]]);
  });
});

describe("drawerThreadResults", () => {
  function makeThread(
    input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
  ): EnvironmentThreadShell {
    return makeThreadShellFixture({ environmentId, ...input });
  }
  const keyOf = (thread: EnvironmentThreadShell) =>
    threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id });

  const deploy = makeThread({ id: ThreadId.make("deploy"), title: "Deploy notes" });
  const weekly = makeThread({ id: ThreadId.make("weekly"), title: "Weekly sync" });
  const archived = makeThread({
    id: ThreadId.make("archived"),
    title: "Deploy archive",
    archivedAt: "2026-11-20T00:00:00.000Z",
  });
  const child = makeThread({
    id: ThreadId.make("child"),
    title: "Deploy helper",
    lineage: {
      parentThreadId: deploy.id,
      rootThreadId: deploy.id,
      relationshipToParent: "subagent",
    },
  });
  const threads = [deploy, weekly, archived, child];

  it("lists title matches, then threads matched only by a message, in the search's order", () => {
    const results = drawerThreadResults({
      threads,
      query: "deploy",
      nowMs: NOW_MS,
      messageMatchKeys: [keyOf(deploy), keyOf(weekly), keyOf(archived), "environment-1:unknown"],
    });
    expect(results.map(({ thread, contentOnly }) => [thread.id, contentOnly])).toEqual([
      [deploy.id, false],
      [weekly.id, true],
    ]);
  });

  it("leaves out archived and child threads and needs a query", () => {
    expect(
      drawerThreadResults({ threads, query: "helper", nowMs: NOW_MS, messageMatchKeys: [] }),
    ).toEqual([]);
    expect(
      drawerThreadResults({
        threads,
        query: " ",
        nowMs: NOW_MS,
        messageMatchKeys: [keyOf(weekly)],
      }),
    ).toEqual([]);
  });
});
