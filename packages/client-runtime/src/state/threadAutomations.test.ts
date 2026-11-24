import {
  EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskListResult,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type AutomatedThread,
  connectedThreadAutomations,
  createScheduledTasksReader,
  createSettleAutomationGate,
  settleAutomationsWarning,
} from "./threadAutomations.ts";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const otherThreadId = ThreadId.make("thread-2");

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    title: "Daily triage",
    prompt: "Triage",
    enabled: true,
    schedule: { type: "interval", everyMs: 3_600_000 },
    projectId: "project-1",
    threadId,
    threadMode: "continue",
    nextRunAt: "2026-11-23T09:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
    ...overrides,
  } as unknown as ScheduledTask;
}

describe("connectedThreadAutomations", () => {
  it("keeps enabled tasks that will still post into the thread", () => {
    const tasks = [
      task({ id: "interval" as ScheduledTask["id"] }),
      task({
        id: "webhook" as ScheduledTask["id"],
        schedule: { type: "webhook", signature: null },
        nextRunAt: null,
      }),
      task({ id: "fresh" as ScheduledTask["id"], threadMode: "fresh_session" }),
    ];
    expect(connectedThreadAutomations(tasks, threadId).map((entry) => entry.id)).toEqual([
      "interval",
      "webhook",
      "fresh",
    ]);
  });

  it("leaves out paused, blocked, finished, new-thread and other-thread tasks", () => {
    const tasks = [
      task({ enabled: false, nextRunAt: null }),
      task({ blockedByPolicy: "Webhooks are off" }),
      task({
        schedule: { type: "once", runAt: "2026-11-20T09:00:00.000Z" },
        nextRunAt: null,
        runCount: 1,
      }),
      task({ threadMode: "new_thread" }),
      task({ threadId: otherThreadId }),
    ];
    expect(connectedThreadAutomations(tasks, threadId)).toEqual([]);
  });
});

describe("settleAutomationsWarning", () => {
  it("names one thread's automations and says the next run makes it active again", () => {
    expect(
      settleAutomationsWarning(
        {
          threads: [{ title: "Inbox", muted: false, automations: ["Daily triage"] }],
          settleCount: 1,
        },
        "en",
      ),
    ).toEqual({
      title: "Settle Thread?",
      message:
        "This thread has 1 automation: “Daily triage”.\nSettling doesn't pause it. Its next run posts here and makes the thread active again.",
      confirmLabel: "Settle Anyway",
    });
  });

  it("names up to three, then counts the rest", () => {
    const warning = settleAutomationsWarning(
      {
        threads: [{ title: "Inbox", muted: true, automations: ["A", "B", "C", "D", "E"] }],
        settleCount: 1,
      },
      "en",
    );
    expect(warning.message).toBe(
      "This thread has 5 automations: “A”, “B”, “C”, and 2 more.\nSettling doesn't pause them. They still post here, and the thread stays settled while muted.",
    );
  });

  it("lists the affected threads for a bulk settle", () => {
    const warning = settleAutomationsWarning(
      {
        threads: [
          { title: "Inbox", muted: false, automations: ["A"] },
          { title: "Builds", muted: true, automations: ["B", "C"] },
        ],
        settleCount: 4,
      },
      "en",
    );
    expect(warning.title).toBe("Settle 4 Threads?");
    expect(warning.message).toBe(
      "Automations run in “Inbox” and “Builds”.\nSettling doesn't pause them. The next run in each thread posts there and makes it active again. Muted threads stay settled.",
    );
  });
});

describe("createSettleAutomationGate", () => {
  const thread = { title: "Inbox" };

  it("settles threads without automations with no prompt", async () => {
    const confirm = vi.fn(async () => true);
    const gate = createSettleAutomationGate({
      readTasks: async () => [task({ threadId: otherThreadId })],
      readThread: () => thread,
      confirm,
    });
    await expect(gate([{ environmentId, threadId }])).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("settles without a prompt when the tasks cannot be read", async () => {
    const confirm = vi.fn(async () => true);
    const gate = createSettleAutomationGate({
      readTasks: async () => {
        throw new Error("offline");
      },
      readThread: () => thread,
      confirm,
    });
    await expect(gate([{ environmentId, threadId }])).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks once for settles made in the same tick and shares the answer", async () => {
    const confirm = vi.fn(async () => false);
    const gate = createSettleAutomationGate({
      readTasks: async () => [task(), task({ threadId: otherThreadId, title: "Nightly" })],
      readThread: (target) => ({ title: target.threadId === threadId ? "Inbox" : "Builds" }),
      confirm,
    });
    const thirdThreadId = ThreadId.make("thread-3");
    const answers = await Promise.all([
      gate([{ environmentId, threadId }]),
      gate([{ environmentId, threadId: otherThreadId }]),
      gate([{ environmentId, threadId: thirdThreadId }]),
    ]);
    expect(answers).toEqual([false, false, false]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      settleCount: 3,
      threads: [
        { title: "Inbox", muted: false, automations: ["Daily triage"] },
        { title: "Builds", muted: false, automations: ["Nightly"] },
      ],
    });
  });

  it("marks a muted thread", async () => {
    const confirm = vi.fn(
      async (_input: { readonly threads: ReadonlyArray<AutomatedThread> }) => true,
    );
    const gate = createSettleAutomationGate({
      readTasks: async () => [task()],
      readThread: () => ({ title: "Inbox", mutedAt: "2026-11-01T00:00:00.000Z", mutedUntil: null }),
      confirm,
      now: () => Date.parse("2026-11-22T00:00:00.000Z"),
    });
    await expect(gate([{ environmentId, threadId }])).resolves.toBe(true);
    expect(confirm.mock.calls[0]?.[0].threads[0]?.muted).toBe(true);
  });
});

describe("createScheduledTasksReader", () => {
  it("answers from a loaded list and returns null when it cannot load", async () => {
    const registry = AtomRegistry.make();
    const loaded = Atom.make(
      AsyncResult.success({ tasks: [task()] }) as AsyncResult.AsyncResult<
        ScheduledTaskListResult,
        unknown
      >,
    );
    const pending = Atom.make(
      AsyncResult.initial() as AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>,
    );
    const read = createScheduledTasksReader({
      registry,
      atom: (id) => (id === environmentId ? loaded : pending),
      timeoutMs: 10,
    });
    await expect(read(environmentId)).resolves.toHaveLength(1);
    await expect(read(EnvironmentId.make("env-2"))).resolves.toBeNull();
  });

  it("waits for a cold list's first value", async () => {
    const registry = AtomRegistry.make();
    const tasks = Atom.make(
      AsyncResult.initial() as AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>,
    );
    const read = createScheduledTasksReader({ registry, atom: () => tasks, timeoutMs: 1_000 });
    const result = read(environmentId);
    registry.set(tasks, AsyncResult.success({ tasks: [task()] }));
    await expect(result).resolves.toHaveLength(1);
  });
});
