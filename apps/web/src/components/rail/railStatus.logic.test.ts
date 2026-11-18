import { describe, expect, it } from "vite-plus/test";

import {
  backgroundRunningCount,
  isAwaitingClear,
  resolveDoneSection,
  railStatusDots,
  countRailStates,
  pickRailProjectThread,
  railProjectDetail,
  railProjectRunningCount,
  railRemuteInput,
  resolveRailThreadState,
  resolveRailTopStatus,
  sortRailMutedThreads,
  summarizeRailCounts,
  summarizeRailFolder,
} from "./railStatus.logic";

const NOW = Date.parse("2026-11-16T13:45:00.000Z");

type StateInput = Parameters<typeof resolveRailThreadState>[0];

function thread(overrides: Partial<StateInput> = {}): StateInput {
  return {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    interactionMode: "default",
    latestRun: null,
    runtime: null,
    pendingBackgroundTasks: [],
    mutedAt: null,
    mutedUntil: null,
    lastVisitedAt: "2026-11-16T12:00:00.000Z",
    ...overrides,
  } as StateInput;
}

const runtime = (status: string) =>
  ({
    status,
    activeRunId: null,
    providerInstanceId: "codex",
    providerName: null,
    lastError: null,
    updatedAt: "2026-11-16T13:00:00.000Z",
  }) as unknown as StateInput["runtime"];
const completedRun = {
  runId: "run-1",
  status: "completed",
  completedAt: "2026-11-16T13:00:00.000Z",
} as unknown as StateInput["latestRun"];
const MUTED = { mutedAt: "2026-11-16T12:30:00.000Z", mutedUntil: null };

describe("resolveRailThreadState", () => {
  it.each([
    ["an approval", thread({ hasPendingApprovals: true }), "needs"],
    ["a question", thread({ hasPendingUserInput: true }), "needs"],
    ["a muted question", thread({ hasPendingUserInput: true, ...MUTED }), "quiet"],
    ["a running turn", thread({ runtime: runtime("running") }), "working"],
    ["a muted running turn", thread({ runtime: runtime("running"), ...MUTED }), "quiet"],
    ["an unseen finished run", thread({ latestRun: completedRun }), "done"],
    ["a run finished while muted", thread({ latestRun: completedRun, ...MUTED }), "quiet"],
    ["an idle thread", thread(), "quiet"],
    [
      "a finished turn still waiting on subagents",
      thread({
        runtime: runtime("idle"),
        pendingBackgroundTasks: [{ taskId: "agent-1", kind: "subagent" }],
      }),
      "working",
    ],
    [
      "a finished turn that left a dev server running",
      thread({
        runtime: runtime("idle"),
        pendingBackgroundTasks: [{ taskId: "dev-server", kind: "command" }],
      }),
      "quiet",
    ],
    [
      "muted subagent waits",
      thread({
        runtime: runtime("idle"),
        pendingBackgroundTasks: [{ taskId: "agent-1", kind: "subagent" }],
        ...MUTED,
      }),
      "quiet",
    ],
  ] as const)("counts %s as %s", (_name, input, expected) => {
    expect(resolveRailThreadState(input, NOW)).toBe(expected);
  });
});

describe("summarizeRailCounts", () => {
  it.each([
    [
      ["needs", "failed", "working", "working", "done", "done"],
      "1 needs you · 1 failed · 2 working · 2 done",
    ],
    [["needs", "needs"], "2 need you"],
    [["quiet", "quiet"], "All quiet"],
    [[], "No open threads"],
  ] as const)("summarizes %j as %j", (states, expected) => {
    expect(summarizeRailCounts(countRailStates(states))).toBe(expected);
  });
});

describe("summarizeRailFolder", () => {
  it.each([
    [0, [], "No projects"],
    [1, ["working"], "1 project"],
    [3, ["failed", "needs"], "3 projects · 1 failed"],
  ] as const)("summarizes %i projects with %j", (projects, states, expected) => {
    expect(summarizeRailFolder(projects, countRailStates(states))).toBe(expected);
  });
});

describe("pickRailProjectThread", () => {
  const key = (candidate: { id: string }) => candidate.id;
  const open = [
    { id: "a", updatedAt: "2026-11-16T10:00:00.000Z", lastVisitedAt: "2026-11-16T11:00:00.000Z" },
    { id: "b", updatedAt: "2026-11-16T12:00:00.000Z", lastVisitedAt: "2026-11-16T09:00:00.000Z" },
    { id: "c", updatedAt: "2026-11-16T13:00:00.000Z", lastVisitedAt: null },
  ];

  it("opens the thread last viewed in the project while it is still open", () => {
    expect(pickRailProjectThread(open, key, "b")?.id).toBe("b");
  });

  it("falls back to the most recently visited when the remembered thread closed", () => {
    expect(pickRailProjectThread(open, key, "gone")?.id).toBe("a");
  });

  it("returns null for a project with no open threads", () => {
    expect(pickRailProjectThread([], key, null)).toBeNull();
  });
});

describe("sortRailMutedThreads", () => {
  it("lists mutes soonest to end first, until-unmuted last, and drops ended mutes", () => {
    const muted = (title: string, mutedUntil: string | null) => ({
      title,
      mutedAt: "2026-11-16T12:00:00.000Z",
      mutedUntil,
    });
    const sorted = sortRailMutedThreads(
      [
        muted("Forever", null),
        muted("Tomorrow", "2026-11-17T09:00:00.000Z"),
        muted("Ended", "2026-11-16T13:00:00.000Z"),
        muted("Evening", "2026-11-16T18:00:00.000Z"),
        { title: "Never muted", mutedAt: null, mutedUntil: null },
      ],
      NOW,
    );
    expect(sorted.map((entry) => entry.title)).toEqual(["Evening", "Tomorrow", "Forever"]);
  });
});

describe("railRemuteInput", () => {
  it.each([
    ["a mute until unmuted", null, { mutedUntil: undefined }],
    [
      "a mute that still runs",
      "2026-11-16T18:00:00.000Z",
      { mutedUntil: "2026-11-16T18:00:00.000Z" },
    ],
    ["a mute that ended meanwhile", "2026-11-16T13:00:00.000Z", null],
  ] as const)("brings back %s", (_name, mutedUntil, expected) => {
    expect(railRemuteInput({ mutedAt: "2026-11-16T12:00:00.000Z", mutedUntil }, NOW)).toEqual(
      expected,
    );
  });
});

describe("resolveRailTopStatus", () => {
  it("shows nothing for a project with nothing to report", () => {
    expect(resolveRailTopStatus([thread(), thread()], NOW)).toBeNull();
  });

  it("ranks needs you over failed, done and working, with the classic labels", () => {
    expect(
      resolveRailTopStatus(
        [thread({ runtime: runtime("running") }), thread({ hasPendingApprovals: true })],
        NOW,
      ),
    ).toMatchObject({ icon: "approval", label: "Approval" });
    expect(
      resolveRailTopStatus(
        [thread({ runtime: runtime("running") }), thread({ latestRun: completedRun })],
        NOW,
      ),
    ).toMatchObject({ icon: "done", label: "Done" });
    expect(resolveRailTopStatus([thread({ runtime: runtime("running") })], NOW)).toMatchObject({
      icon: "working",
      label: "Working",
    });
  });

  it("names a question as Input", () => {
    expect(resolveRailTopStatus([thread({ hasPendingUserInput: true })], NOW)).toMatchObject({
      icon: "input",
      label: "Input",
    });
  });
});

describe("railProjectDetail", () => {
  it("says how many threads are open and when one last changed", () => {
    expect(railProjectDetail(0, null, NOW)).toBe("No open threads");
    expect(railProjectDetail(3, NOW - 20_000, NOW)).toBe("3 open · just now");
    expect(railProjectDetail(1, NOW - 12 * 60_000, NOW)).toBe("1 open · 12m ago");
    expect(railProjectDetail(2, NOW - 5 * 3_600_000, NOW)).toBe("2 open · 5h ago");
    expect(railProjectDetail(4, NOW - 3 * 86_400_000, NOW)).toBe("4 open · 3d ago");
  });
});

describe("railStatusDots", () => {
  const counts = (needs: number, failed: number, working: number, done: number, open: number) => ({
    needs,
    failed,
    working,
    done,
    open,
  });

  it("gives every open thread a dot, most urgent first, idle ones last", () => {
    const { dots, overflow } = railStatusDots(counts(1, 0, 2, 1, 6));
    expect(dots.map((dot) => dot.state)).toEqual([
      "needs",
      "working",
      "working",
      "done",
      "quiet",
      "quiet",
    ]);
    expect(new Set(dots.map((dot) => dot.key)).size).toBe(dots.length);
    expect(overflow).toBe(0);
  });

  it("cuts quiet dots first and counts what it cut", () => {
    const { dots, overflow } = railStatusDots(counts(0, 1, 1, 0, 5), 3);
    expect(dots.map((dot) => dot.state)).toEqual(["failed", "working", "quiet"]);
    expect(overflow).toBe(2);
  });

  it("shows nothing for a project with no open threads", () => {
    expect(railStatusDots(counts(0, 0, 0, 0, 0))).toEqual({ dots: [], overflow: 0 });
  });
});

describe("backgroundRunningCount", () => {
  it("counts commands and monitors nobody waits on", () => {
    expect(
      backgroundRunningCount({
        pendingBackgroundTasks: [
          { taskId: "scan", kind: "command" },
          { taskId: "logs", kind: "monitor" },
        ],
      }),
    ).toBe(2);
  });

  it("leaves them to Working when the thread waits on its work", () => {
    expect(
      backgroundRunningCount({
        pendingBackgroundTasks: [
          { taskId: "scan", kind: "command" },
          { taskId: "child", kind: "subagent" },
        ],
      }),
    ).toBe(0);
    expect(
      backgroundRunningCount({
        pendingBackgroundTasks: [{ taskId: "scan", kind: "command", awaited: true }],
      }),
    ).toBe(0);
  });
});

describe("railProjectRunningCount", () => {
  it("adds the shells of idle threads and skips threads already Working", () => {
    const devServer = thread({
      runtime: runtime("idle"),
      pendingBackgroundTasks: [{ taskId: "dev-server", kind: "command" }],
    });
    const tests = thread({
      runtime: runtime("idle"),
      pendingBackgroundTasks: [
        { taskId: "tests", kind: "command" },
        { taskId: "logs", kind: "monitor" },
      ],
    });
    const working = thread({
      runtime: runtime("running"),
      pendingBackgroundTasks: [{ taskId: "build", kind: "command" }],
    });
    expect(railProjectRunningCount([devServer, tests, working], NOW)).toBe(3);
    expect(railProjectRunningCount([], NOW)).toBe(0);
  });
});

describe("isAwaitingClear", () => {
  const finished = thread({ latestRun: completedRun });

  it("keeps a finished run until it is cleared", () => {
    expect(isAwaitingClear(finished, undefined, "2026-11-16T09:00:00.000Z")).toBe(true);
    expect(isAwaitingClear(finished, "2026-11-16T13:30:00.000Z", null)).toBe(false);
  });

  it("brings a thread back when a run finishes after it was cleared", () => {
    expect(isAwaitingClear(finished, "2026-11-16T12:00:00.000Z", null)).toBe(true);
  });

  it("treats runs from before this device kept finished threads as cleared", () => {
    expect(isAwaitingClear(finished, undefined, "2026-11-16T13:30:00.000Z")).toBe(false);
  });

  it("skips runs that did not complete and runs finished while muted", () => {
    const interrupted = thread({
      latestRun: { ...completedRun, status: "interrupted" } as StateInput["latestRun"],
    });
    expect(isAwaitingClear(interrupted, undefined, null)).toBe(false);
    expect(isAwaitingClear(thread({ latestRun: null }), undefined, null)).toBe(false);
    expect(isAwaitingClear(thread({ latestRun: completedRun, ...MUTED }), undefined, null)).toBe(
      false,
    );
  });
});

describe("resolveDoneSection", () => {
  const finished = thread({ latestRun: completedRun });

  it("lists an unread run under New until it is cleared, even before the visit lands", () => {
    expect(resolveDoneSection("done", false, finished, undefined, null)).toBe("new");
    expect(resolveDoneSection("done", false, finished, "2026-11-16T13:30:00.000Z", null)).toBe(
      null,
    );
    expect(resolveDoneSection("done", false, finished, "2026-11-16T12:00:00.000Z", null)).toBe(
      "new",
    );
  });

  it("lists an opened run under Opened and nothing else", () => {
    expect(resolveDoneSection("idle", false, finished, undefined, null)).toBe("opened");
    expect(resolveDoneSection("working", false, finished, undefined, null)).toBe(null);
    expect(resolveDoneSection("done", true, finished, undefined, null)).toBe(null);
  });
});
