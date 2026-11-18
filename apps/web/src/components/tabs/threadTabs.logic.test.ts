import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  adjacentTabKey,
  draftTabTitle,
  type DraftTabSource,
  findThreadGroup,
  groupAllTabs,
  nextNeedsYouKey,
  orderGroupsByRail,
  orderThreadTabs,
  resolveTabRename,
  resolveThreadTabIcon,
  WORKING_ICON_MOTION,
  selectDraftTabs,
  selectOpenThreads,
  tabAfterClose,
  threadTabKey,
  type ThreadTabView,
} from "./threadTabs.logic";
import { resolveOpenThreadStatus } from "../rail/railStatus.logic";

const ENV = EnvironmentId.make("env-1");
const NOW_ISO = "2026-11-16T13:45:00.000Z";

function thread(id: string, overrides: ThreadFixtureOverrides = {}) {
  return makeThreadFixture({
    environmentId: ENV,
    id: ThreadId.make(id),
    projectId: ProjectId.make("project-a"),
    title: id,
    createdAt: "2026-11-16T10:00:00.000Z",
    lastVisitedAt: "2026-11-16T12:00:00.000Z",
    ...overrides,
  });
}

const select = (threads: ReturnType<typeof thread>[], projectKeys: Set<string> | null = null) =>
  selectOpenThreads({
    threads,
    projectKeys,
    delegatedUnderParent: new Set(),
    loadedEnvironmentIds: new Set([ENV]),
    nowIso: NOW_ISO,
  }).map((entry) => entry.id);

describe("selectOpenThreads", () => {
  it("keeps open threads of the project and leaves out settled, snoozed and archived ones", () => {
    const threads = [
      thread("open"),
      thread("pinned", { pinnedAt: "2026-11-16T09:00:00.000Z" }),
      thread("settled", { settledOverride: "settled" }),
      thread("snoozed", {
        snoozedAt: "2026-11-16T12:00:00.000Z",
        snoozedUntil: "2026-11-16T18:00:00.000Z",
      }),
      thread("archived", { archivedAt: "2026-11-16T11:00:00.000Z" }),
      thread("elsewhere", { projectId: ProjectId.make("project-b") }),
    ];
    expect(select(threads, new Set([`${ENV}:project-a`]))).toEqual(["open", "pinned"]);
  });

  it("treats a snooze that has ended as open again", () => {
    const woke = thread("woke", {
      snoozedAt: "2026-11-16T10:00:00.000Z",
      snoozedUntil: "2026-11-16T11:00:00.000Z",
    });
    expect(select([woke])).toEqual(["woke"]);
  });

  it("does not hide settled threads before the environment's config loads", () => {
    const settled = thread("settled", { settledOverride: "settled" });
    expect(
      selectOpenThreads({
        threads: [settled],
        projectKeys: null,
        delegatedUnderParent: new Set(),
        loadedEnvironmentIds: new Set(),
        nowIso: NOW_ISO,
      }).map((entry) => entry.id),
    ).toEqual(["settled"]);
  });

  it("leaves out a subagent that shows under its parent", () => {
    const child = thread("child", {
      lineage: {
        rootThreadId: ThreadId.make("parent"),
        parentThreadId: ThreadId.make("parent"),
        relationshipToParent: "subagent",
      },
    });
    expect(select([thread("parent"), child])).toEqual(["parent"]);
  });
});

describe("orderThreadTabs", () => {
  it("puts pinned tabs first, then the newest thread right after them", () => {
    const { tabs, pinnedCount } = orderThreadTabs([
      thread("older", { createdAt: "2026-11-16T08:00:00.000Z" }),
      thread("pin-b", { pinnedAt: "2026-11-16T09:00:00.000Z", pinOrderKey: "b" }),
      thread("newest", { createdAt: "2026-11-16T12:00:00.000Z" }),
      thread("pin-a", { pinnedAt: "2026-11-16T09:30:00.000Z", pinOrderKey: "a" }),
    ]);
    expect(tabs.map((tab) => tab.id)).toEqual(["pin-a", "pin-b", "newest", "older"]);
    expect(pinnedCount).toBe(2);
  });

  it("keeps the same order when a thread's status or activity changes", () => {
    const before = [
      thread("a", { createdAt: "2026-11-16T08:00:00.000Z" }),
      thread("b", { createdAt: "2026-11-16T09:00:00.000Z" }),
    ];
    const after = [
      thread("a", {
        createdAt: "2026-11-16T08:00:00.000Z",
        updatedAt: "2026-11-16T13:40:00.000Z",
        hasPendingApprovals: true,
      }),
      before[1]!,
    ];
    expect(orderThreadTabs(before).tabs.map(threadTabKey)).toEqual(
      orderThreadTabs(after).tabs.map(threadTabKey),
    );
  });
});

describe("resolveOpenThreadStatus", () => {
  const running = { status: "running", activeRunId: null } as never;
  const completed = {
    runId: "run-1",
    status: "completed",
    completedAt: "2026-11-16T13:00:00.000Z",
  } as never;
  it.each([
    ["idle with the session open and no run", {}, false, "idle"],
    ["needs you for an approval", { hasPendingApprovals: true }, false, "needs"],
    ["needs you for an answer", { hasPendingUserInput: true }, false, "needs"],
    ["working", { runtime: running }, false, "working"],
    ["failed", { runtime: { status: "failed", activeRunId: null } as never }, false, "failed"],
    [
      "done when it finished since you looked",
      { latestRun: completed, runtime: null },
      false,
      "done",
    ],
    [
      "idle once seen",
      { latestRun: completed, runtime: null, lastVisitedAt: NOW_ISO },
      false,
      "idle",
    ],
    ["idle instead of done while muted", { latestRun: completed, runtime: null }, true, "idle"],
    ["idle instead of working while muted", { runtime: running }, true, "idle"],
    ["stays quiet while muted, even with a question", { hasPendingApprovals: true }, true, "idle"],
  ] as const)("%s", (_name, overrides, muted, expected) => {
    expect(resolveOpenThreadStatus(thread("t", overrides), muted)).toBe(expected);
  });
});

describe("groupAllTabs", () => {
  const tab = (
    key: string,
    status: ThreadTabView["status"],
    mute: ThreadTabView["mute"] = null,
  ): ThreadTabView => ({ key, title: `Thread ${key}`, status, mute });

  it("groups by what needs you first and keeps muted threads last, soonest back first", () => {
    const groups = groupAllTabs(
      [
        tab("1", "idle"),
        tab("2", "working", { until: null }),
        tab("3", "done"),
        tab("4", "needs", { until: 10 }),
        tab("5", "working"),
        tab("6", "idle", { until: 5 }),
        tab("7", "failed"),
      ],
      "",
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.key)])).toEqual([
      ["Needs You", ["4"]],
      ["Failed", ["7"]],
      ["Working", ["5"]],
      ["Done", ["3"]],
      ["Idle", ["1"]],
      ["Muted", ["6", "2"]],
    ]);
  });

  it("filters by every word of the search, ignoring case", () => {
    const groups = groupAllTabs(
      [
        { key: "a", title: "Relay timer race", status: "idle", mute: null },
        { key: "b", title: "Tab strip scroll arrows", status: "idle", mute: null },
      ],
      "  TIMER relay ",
    );
    expect(groups.flatMap((group) => group.items.map((item) => item.key))).toEqual(["a"]);
  });
});

describe("thread navigation", () => {
  it("finds the next thread that needs you after the current one, wrapping across projects", () => {
    const order = ["p1:a", "p1:b", "p2:c", "p2:d"];
    const needs = new Set(["p1:a", "p2:c"]);
    expect(nextNeedsYouKey(order, needs, "p1:b")).toBe("p2:c");
    expect(nextNeedsYouKey(order, needs, "p2:c")).toBe("p1:a");
    expect(nextNeedsYouKey(order, needs, null)).toBe("p1:a");
    expect(nextNeedsYouKey(order, new Set(["p1:b"]), "p1:b")).toBeNull();
  });

  it("moves between tabs and picks a neighbour when the open tab closes", () => {
    expect(adjacentTabKey(["a", "b", "c"], "c", "next")).toBe("a");
    expect(adjacentTabKey(["a", "b", "c"], "a", "previous")).toBe("c");
    expect(adjacentTabKey(["a", "b"], "elsewhere", "next")).toBe("a");
    expect(tabAfterClose(["a", "b", "c"], "b")).toBe("c");
    expect(tabAfterClose(["a", "b", "c"], "c")).toBe("b");
    expect(tabAfterClose(["a"], "a")).toBeNull();
  });
});

describe("resolveThreadTabIcon", () => {
  it.each([
    ["working", "working", "working", `text-info-foreground ${WORKING_ICON_MOTION}`],
    ["preparing", "working", "working", `text-info-foreground ${WORKING_ICON_MOTION}`],
    ["waiting", "working", "waiting", `text-info-foreground ${WORKING_ICON_MOTION}`],
    ["waiting", "idle", "waiting", "text-muted-foreground"],
    ["approval", "needs", "approval", "text-warning-foreground"],
    ["input", "needs", "input", "text-indigo-600 dark:text-indigo-300"],
    ["failed", "failed", "failed", "text-error-foreground"],
    ["ready", "done", "done", "text-success-foreground"],
  ] as const)("shows the sidebar's %s icon", (rowStatus, status, icon, className) => {
    expect(resolveThreadTabIcon(rowStatus, status)).toMatchObject({ icon, className });
  });

  it("calls a thread waiting on its own subagents Working, not Waiting", () => {
    expect(resolveThreadTabIcon("waiting", "working")?.label).toBe("Working");
    expect(resolveThreadTabIcon("waiting", "idle")?.label).toBe("Waiting");
  });

  it("turns only a working thread's icon, never a muted one's", () => {
    expect(resolveThreadTabIcon("working", "idle")?.className).toBe("text-info-foreground");
  });

  it("shows no icon for a thread with nothing new, so the tab draws its quiet dot", () => {
    expect(resolveThreadTabIcon("ready", "idle")).toBeNull();
  });
});

describe("resolveTabRename", () => {
  it("saves a trimmed new title and keeps the old one when empty or unchanged", () => {
    expect(resolveTabRename("  Better name ", "Old")).toEqual({ save: true, title: "Better name" });
    expect(resolveTabRename("   ", "Old")).toEqual({ save: false });
    expect(resolveTabRename("Old", "Old")).toEqual({ save: false });
  });
});

describe("draft tabs", () => {
  const draft = (draftId: string, overrides: Partial<DraftTabSource> = {}): DraftTabSource => ({
    draftId,
    environmentId: ENV,
    projectId: "project-a",
    createdAt: "2026-11-16T10:00:00.000Z",
    promoted: false,
    hasContent: true,
    title: draftId,
    ...overrides,
  });
  const keys = new Set([`${ENV}:project-a`]);

  it("lists unsent drafts of the project newest first, and the open draft even when empty", () => {
    const drafts = [
      draft("older", { createdAt: "2026-11-16T09:00:00.000Z" }),
      draft("newer", { createdAt: "2026-11-16T11:00:00.000Z" }),
      draft("empty", { hasContent: false }),
      draft("open-empty", { hasContent: false, createdAt: "2026-11-16T12:00:00.000Z" }),
      draft("sent", { promoted: true }),
      draft("elsewhere", { projectId: "project-b" }),
    ];
    expect(selectDraftTabs(drafts, keys, "open-empty").map((entry) => entry.draftId)).toEqual([
      "open-empty",
      "newer",
      "older",
    ]);
  });

  it("titles a draft by its first line, then its attachments", () => {
    expect(draftTabTitle("  Fix the strip\nmore detail", 2)).toBe("Fix the strip");
    expect(draftTabTitle("", 1)).toBe("1 Attachment");
    expect(draftTabTitle(" ", 3)).toBe("3 Attachments");
    expect(draftTabTitle("", 0)).toBe("New Thread");
  });
});

describe("project groups", () => {
  const group = (projectKey: string, isScratch = false, projectIds: string[] = [projectKey]) => ({
    projectKey,
    ...(isScratch ? { isScratch: true as const } : {}),
    memberProjectRefs: projectIds.map((projectId) => ({
      environmentId: ENV,
      projectId: ProjectId.make(projectId),
    })),
  });

  it("finds a thread's group through any of the group's member projects", () => {
    const groups = [group("a"), group("b", false, ["b-local", "b-remote"])];
    expect(findThreadGroup(groups, thread("t", { projectId: ProjectId.make("b-remote") }))).toBe(
      groups[1],
    );
    expect(findThreadGroup(groups, thread("t", { projectId: ProjectId.make("c") }))).toBeNull();
  });

  it("orders projects as the rail does, with No Project at the chosen end", () => {
    const groups = [group("a"), group("scratch", true), group("b"), group("c")];
    const layout = {
      top: ["p:c", "f:work"],
      folders: { work: { name: "Work", collapsed: true, projects: ["b"] } },
    };
    const keys = (position: "top" | "bottom") =>
      orderGroupsByRail(groups, layout, position).map((entry) => entry.projectKey);
    expect(keys("bottom")).toEqual(["c", "b", "a", "scratch"]);
    expect(keys("top")).toEqual(["scratch", "c", "b", "a"]);
  });
});
