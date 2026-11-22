import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { OpenThreadStatus } from "@t3tools/client-runtime/state/thread-status-filter";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectSwitcherRows,
  countWaitingThreadsByScope,
  filterProjectSwitcherRows,
  type ProjectSwitcherStatusEntry,
} from "./project-switcher";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

function project(environmentId: EnvironmentId, id: string, title: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/workspaces/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function scope(key: string, title: string, ...members: EnvironmentProject[]) {
  return {
    key,
    title,
    representative: members[0]!,
    projectRefs: members.map((member) => ({
      environmentId: member.environmentId,
      projectId: member.id,
    })),
  };
}

function entry(
  environmentId: EnvironmentId,
  projectId: string,
  status: OpenThreadStatus,
  doneSection: "new" | "opened" | null = null,
): ProjectSwitcherStatusEntry {
  return { thread: { environmentId, projectId: ProjectId.make(projectId) }, status, doneSection };
}

const app = project(local, "app", "App");
const appRemote = project(remote, "app-remote", "App");
const site = project(local, "site", "Site");
const scratch: EnvironmentProject = { ...project(local, "scratch", "No project"), isScratch: true };
const scopes = [
  scope("app", "App", app, appRemote),
  scope("scratch", "No project", scratch),
  scope("site", "Site", site),
];

describe("countWaitingThreadsByScope", () => {
  it("counts threads that need the user or failed, per scope and in all", () => {
    const counts = countWaitingThreadsByScope({
      scopes,
      entries: [
        entry(local, "app", "needs"),
        entry(remote, "app-remote", "failed"),
        entry(local, "app", "working"),
        entry(local, "site", "done", "new"),
        entry(local, "site", "idle"),
        entry(local, "scratch", "needs"),
        // A thread whose project is not pickable still counts toward All Projects.
        entry(local, "archived", "needs"),
      ],
    });
    expect(counts.total).toBe(4);
    expect(Object.fromEntries(counts.byScope)).toEqual({ app: 2, scratch: 1 });
  });
});

describe("buildProjectSwitcherRows", () => {
  it("puts All Projects and No Project first and keeps the projects in the order given", () => {
    const rows = buildProjectSwitcherRows({
      scopes,
      noProjectKey: "scratch",
      entries: [entry(local, "app", "needs"), entry(local, "scratch", "failed")],
      activityByScope: new Map([
        ["app", 1_000],
        ["site", Number.NEGATIVE_INFINITY],
      ]),
      allTitle: "All Projects",
      noProjectTitle: "No Project",
    });
    expect(rows.fixed.map((row) => [row.key, row.kind, row.title, row.waitingCount])).toEqual([
      ["scratch", "none", "No Project", 1],
      [null, "all", "All Projects", 2],
    ]);
    expect(
      rows.recent.map((row) => [row.key, row.title, row.waitingCount, row.lastActiveMs]),
    ).toEqual([
      ["app", "App", 1, 1_000],
      ["site", "Site", 0, null],
    ]);
  });

  it("leaves out No Project when no thread lacks a project", () => {
    const rows = buildProjectSwitcherRows({
      scopes: scopes.filter((candidate) => candidate.key !== "scratch"),
      noProjectKey: null,
      entries: [],
      activityByScope: new Map(),
      allTitle: "All Projects",
      noProjectTitle: "No Project",
    });
    expect(rows.fixed.map((row) => row.kind)).toEqual(["all"]);
    expect(rows.recent.map((row) => row.key)).toEqual(["app", "site"]);
  });
});

describe("filterProjectSwitcherRows", () => {
  const rows = [{ title: "baba-learn-v1" }, { title: "Makom" }, { title: "All Projects" }];

  it("matches names case-insensitively anywhere in the name", () => {
    expect(filterProjectSwitcherRows(rows, "  MAK ")).toEqual([{ title: "Makom" }]);
    expect(filterProjectSwitcherRows(rows, "learn")).toEqual([{ title: "baba-learn-v1" }]);
  });

  it("keeps every row for an empty query and none when nothing matches", () => {
    expect(filterProjectSwitcherRows(rows, " ")).toEqual(rows);
    expect(filterProjectSwitcherRows(rows, "zzz")).toEqual([]);
  });
});
