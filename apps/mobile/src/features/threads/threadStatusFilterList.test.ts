import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import type { ThreadListV2ListItem } from "./threadListV2";
import {
  applyClearMarks,
  buildThreadStatusEntries,
  buildThreadStatusFilterRows,
  buildThreadStatusListItems,
  countThreadStatusEntries,
  pruneClearMarks,
  restoreClearMarks,
  threadStatusDoneThreads,
  threadStatusKey,
} from "./threadStatusFilterList";

const environmentId = EnvironmentId.make("environment-1");
const BASE_MS = Date.parse("2026-11-20T12:00:00.000Z");
const MINUTE_MS = 60_000;
const at = (minutesAgo: number) => new Date(BASE_MS - minutesAgo * MINUTE_MS).toISOString();
const NOW = at(0);

function thread(id: string, input: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return makeThreadShellFixture({
    environmentId,
    id: ThreadId.make(id),
    title: id,
    ...input,
  });
}

function completedRun(id: string, completedMinutesAgo: number) {
  return {
    runId: RunId.make(`${id}-run`),
    status: "completed" as const,
    requestedAt: at(completedMinutesAgo + 5),
    startedAt: at(completedMinutesAgo + 5),
    completedAt: at(completedMinutesAgo),
    assistantMessageId: null,
  };
}

function runtime(status: "running" | "failed") {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: status === "failed" ? "Run failed" : null,
    updatedAt: at(1),
  };
}

/** A finished run you have not opened since. */
const unseen = (id: string, minutesAgo: number) =>
  thread(id, { latestRun: completedRun(id, minutesAgo), lastVisitedAt: at(minutesAgo + 10) });
/** A finished run you opened after it finished. */
const opened = (id: string, minutesAgo: number) =>
  thread(id, { latestRun: completedRun(id, minutesAgo), lastVisitedAt: at(minutesAgo - 1) });

const titles = (items: ReadonlyArray<ThreadListV2ListItem>) =>
  items.map((item) =>
    item.type === "v2-thread"
      ? `${item.item.thread.title}${item.doneSection ? `@${item.doneSection}` : ""}`
      : item.type === "v2-status-section"
        ? `[${item.section} ${item.count}/${item.clearAllCount}]`
        : item.type === "v2-status-project"
          ? `<${item.title ?? "?"} ${item.count}>`
          : item.type,
  );

const decorate = (items: ReadonlyArray<{ readonly thread: EnvironmentThreadShell }>) =>
  items.map(
    (item): ThreadListV2ListItem =>
      ({
        type: "v2-thread",
        key: threadStatusKey(item.thread),
        item,
        showTrailingDivider: false,
      }) as unknown as ThreadListV2ListItem,
  );

describe("buildThreadStatusEntries", () => {
  const threads = [
    thread("asks", { hasPendingUserInput: true, pendingUserInputAt: at(30) }),
    thread("asks-later", { hasPendingUserInput: true, pendingUserInputAt: at(5) }),
    thread("failed", {
      runtime: runtime("failed"),
      latestRun: { ...completedRun("failed", 20), status: "failed" as const },
      lastVisitedAt: at(40),
    }),
    thread("running", { runtime: runtime("running"), latestRun: completedRun("running", 50) }),
    unseen("new-old", 60),
    unseen("new-recent", 2),
    opened("opened", 15),
    opened("opened-before-review", 600),
  ];
  const clears = { reviewSince: at(120), clearedAt: {} };

  it("counts each thread once, in the filter that lists it", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    expect(countThreadStatusEntries(entries)).toEqual({ waiting: 3, working: 1, done: 3 });
  });

  it("lists Needs You longest waiting first", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const items = buildThreadStatusListItems({ entries, filter: "waiting", now: NOW, decorate });
    expect(titles(items)).toEqual(["asks", "failed", "asks-later"]);
  });

  it("splits Done into New then Opened, newest first, with Clear All on the first heading", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const items = buildThreadStatusListItems({ entries, filter: "done", now: NOW, decorate });
    expect(titles(items)).toEqual([
      "[new 2/3]",
      "new-recent@new",
      "new-old@new",
      "[opened 1/0]",
      "opened@opened",
    ]);
  });

  it("keeps nothing under Opened until this device starts keeping finished threads", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears: null });
    expect(threadStatusDoneThreads(entries).map((entry) => entry.thread.title)).toEqual([
      "new-old",
      "new-recent",
    ]);
  });

  it("drops a cleared thread until it finishes again", () => {
    const cleared = {
      reviewSince: at(120),
      clearedAt: {
        [threadStatusKey(threads[4]!)]: at(1),
        [threadStatusKey(threads[6]!)]: at(1),
      },
    };
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears: cleared });
    expect(threadStatusDoneThreads(entries).map((entry) => entry.thread.title)).toEqual([
      "new-recent",
    ]);
  });
});

describe("Working · Done", () => {
  const threads = [
    thread("running", { runtime: runtime("running"), latestRun: completedRun("running", 50) }),
    unseen("new-recent", 2),
    opened("opened", 15),
    thread("asks", { hasPendingUserInput: true, pendingUserInputAt: at(30) }),
  ];
  const clears = { reviewSince: at(120), clearedAt: {} };
  const pendingRows = () => [
    { type: "v2-pending", key: "draft" } as unknown as ThreadListV2ListItem,
  ];

  it("keeps Done above and Working below as two lists, drafts leading Working", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const rows = buildThreadStatusFilterRows({
      entries,
      filter: "workingDone",
      now: NOW,
      decorate,
      projectGroups: null,
      pendingRows,
    });
    expect(rows.split && titles(rows.split.done)).toEqual([
      "[new 1/2]",
      "new-recent@new",
      "[opened 1/0]",
      "opened@opened",
    ]);
    expect(rows.split && titles(rows.split.working)).toEqual(["v2-pending", "running"]);
    expect(rows.items).toEqual([...rows.split!.done, ...rows.split!.working]);
  });

  it("lists one tab as one list", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const rows = buildThreadStatusFilterRows({
      entries,
      filter: "working",
      now: NOW,
      decorate,
      projectGroups: null,
      pendingRows,
    });
    expect(rows.split).toBeNull();
    expect(titles(rows.items)).toEqual(["v2-pending", "running"]);
  });
});

describe("Done by project", () => {
  const project = (id: string) => ProjectId.make(id);
  const inProject = (projectId: string, make: typeof unseen, id: string, minutesAgo: number) => ({
    ...make(id, minutesAgo),
    projectId: project(projectId),
  });
  const threads = [
    inProject("alpha", unseen, "alpha-old", 50),
    inProject("beta", unseen, "beta-new", 5),
    inProject("alpha", unseen, "alpha-new", 10),
    inProject("gone", unseen, "gone-new", 20),
    inProject("beta", opened, "beta-opened", 30),
    inProject("alpha", opened, "alpha-opened", 15),
  ];
  const clears = { reviewSince: at(120), clearedAt: {} };
  const group = (key: string, title: string) => ({
    key,
    title,
    project: { id: project(key), environmentId, title } as unknown as EnvironmentProject,
    scratch: false,
  });
  const projectGroups = new Map([
    [`${environmentId}:alpha`, group("alpha", "Alpha")],
    [`${environmentId}:beta`, group("beta", "Beta")],
  ]);

  it("lists each heading's threads under their projects, newest project first", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const items = buildThreadStatusListItems({
      entries,
      filter: "done",
      now: NOW,
      decorate,
      projectGroups,
    });
    expect(titles(items)).toEqual([
      "[new 4/6]",
      "<Beta 1>",
      "beta-new@new",
      "<Alpha 2>",
      "alpha-new@new",
      "alpha-old@new",
      "<? 1>",
      "gone-new@new",
      "[opened 2/0]",
      "<Alpha 1>",
      "alpha-opened@opened",
      "<Beta 1>",
      "beta-opened@opened",
    ]);
    const lastRows = items.flatMap((item) =>
      item.type === "v2-thread" && item.item.isLast ? [item.item.thread.title] : [],
    );
    expect(lastRows).toEqual(["beta-opened"]);
    const keys = items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps one list when no project groups are given", () => {
    const entries = buildThreadStatusEntries({ threads, now: NOW, clears });
    const items = buildThreadStatusListItems({ entries, filter: "done", now: NOW, decorate });
    expect(items.some((item) => item.type === "v2-status-project")).toBe(false);
  });
});

describe("clear marks", () => {
  const base = { reviewSince: at(120), clearedAt: { a: at(30) } };

  it("undo restores only the marks this clear still owns", () => {
    const clearedAt = at(0);
    const previous = new Map([
      ["a", at(30)],
      ["b", undefined],
      ["c", undefined],
    ]);
    const applied = applyClearMarks(base, ["a", "b", "c"], clearedAt);
    // Another clear replaced c's mark before Undo.
    const later = { ...applied, clearedAt: { ...applied.clearedAt, c: at(-1) } };
    expect(restoreClearMarks(later, previous, clearedAt).clearedAt).toEqual({
      a: at(30),
      c: at(-1),
    });
  });

  it("keeps the newest marks when there are too many", () => {
    const marks = Object.fromEntries(
      Array.from({ length: 502 }, (_, index) => [`t${index}`, at(index)]),
    );
    const pruned = pruneClearMarks(marks);
    expect(Object.keys(pruned)).toHaveLength(500);
    expect(pruned.t0).toBe(at(0));
    expect(pruned.t501).toBeUndefined();
  });
});
