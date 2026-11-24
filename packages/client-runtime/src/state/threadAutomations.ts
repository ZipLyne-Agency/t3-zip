// @effect-diagnostics globalTimers:off globalDate:off - Settle gates run in web and native event handlers, outside an Effect runtime.
import {
  scheduledTaskThreadMode,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskListResult,
  type ThreadId,
} from "@t3tools/contracts";
import { isThreadMuted, type ThreadMuteFields } from "@t3tools/shared/threadMute";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";

import { formatConjunctionList } from "../listFormat.ts";

const NAMED_LIMIT = 3;
const TASKS_WAIT_MS = 2_000;

/**
 * The automations that will still run in `threadId`: enabled, not blocked by policy, posting into
 * this thread (a "new thread" task launches a fresh thread each run), and with a run ahead. A
 * webhook can fire at any time; a one-time task that already ran has no next run.
 */
export function connectedThreadAutomations(
  tasks: ReadonlyArray<ScheduledTask>,
  threadId: ThreadId,
): ScheduledTask[] {
  return tasks.filter(
    (task) =>
      task.threadId === threadId &&
      task.enabled &&
      task.blockedByPolicy === undefined &&
      scheduledTaskThreadMode(task) !== "new_thread" &&
      (task.schedule.type === "webhook" || task.nextRunAt !== null),
  );
}

export interface AutomatedThread {
  readonly title: string;
  readonly muted: boolean;
  readonly automations: ReadonlyArray<string>;
}

interface SettleAutomationsWarning {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

function namedList(names: ReadonlyArray<string>, locale: string, resolve: MFunctionType): string {
  const quoted = names.map((name) => `“${name}”`);
  const shown =
    quoted.length > NAMED_LIMIT
      ? [
          ...quoted.slice(0, NAMED_LIMIT),
          resolve(
            msg("{count} more", {
              count: quoted.length - NAMED_LIMIT,
              $context: "ends a list of names that was cut short",
            }),
          ),
        ]
      : quoted;
  return formatConjunctionList(shown, locale, resolve);
}

/**
 * Settling leaves automations running, and each run posts into its thread, which brings a settled
 * thread back to active unless the thread is muted.
 */
export function settleAutomationsWarning(
  input: { readonly threads: ReadonlyArray<AutomatedThread>; readonly settleCount: number },
  locale: string,
  resolve: MFunctionType = mFallback,
): SettleAutomationsWarning {
  const confirmLabel = resolve(msg("Settle Anyway", { $context: "confirms settling a thread" }));
  const only = input.threads.length === 1 && input.settleCount === 1 ? input.threads[0] : null;
  if (only) {
    const count = only.automations.length;
    const names = namedList(only.automations, locale, resolve);
    return {
      title: resolve(msg("Settle Thread?")),
      message: [
        resolve(
          msg(
            "{count, plural, one {This thread has 1 automation: {names}.} other {This thread has {count} automations: {names}.}}",
            { count, names },
          ),
        ),
        only.muted
          ? resolve(
              msg(
                "{count, plural, one {Settling doesn't pause it. It still posts here, and the thread stays settled while muted.} other {Settling doesn't pause them. They still post here, and the thread stays settled while muted.}}",
                { count },
              ),
            )
          : resolve(
              msg(
                "{count, plural, one {Settling doesn't pause it. Its next run posts here and makes the thread active again.} other {Settling doesn't pause them. Their next run posts here and makes the thread active again.}}",
                { count },
              ),
            ),
      ].join("\n"),
      confirmLabel,
    };
  }
  const count = input.threads.length;
  const muted = input.threads.filter((thread) => thread.muted).length;
  const names = namedList(
    input.threads.map((thread) => thread.title),
    locale,
    resolve,
  );
  const consequence =
    muted === count
      ? resolve(
          msg(
            "{count, plural, one {Settling doesn't pause them. Runs still post into that thread, and it stays settled while muted.} other {Settling doesn't pause them. Runs still post into those threads, and they stay settled while muted.}}",
            { count },
          ),
        )
      : resolve(
          msg(
            "{count, plural, one {Settling doesn't pause them. The next run posts into that thread and makes it active again.} other {Settling doesn't pause them. The next run in each thread posts there and makes it active again.}}",
            { count },
          ),
        );
  return {
    title: resolve(
      msg("{count, plural, one {Settle Thread?} other {Settle {count} Threads?}}", {
        count: input.settleCount,
      }),
    ),
    message: [
      resolve(msg("Automations run in {names}.", { names })),
      muted > 0 && muted < count
        ? `${consequence} ${resolve(msg("Muted threads stay settled."))}`
        : consequence,
    ].join("\n"),
    confirmLabel,
  };
}

/**
 * Reads an environment's scheduled tasks, waiting briefly for a cold subscription's first value.
 * Null when they cannot be read in time (an older server, no access, offline), so the caller
 * settles as it did before. The first read keeps the subscription open, so later settles answer
 * from the live list at once.
 */
export function createScheduledTasksReader(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly atom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>>;
  readonly timeoutMs?: number;
}): (environmentId: EnvironmentId) => Promise<ReadonlyArray<ScheduledTask> | null> {
  const kept = new Set<EnvironmentId>();
  return (environmentId) => {
    const atom = options.atom(environmentId);
    if (!kept.has(environmentId)) {
      kept.add(environmentId);
      options.registry.mount(atom);
    }
    const settledTasks = (
      result: AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>,
    ): ReadonlyArray<ScheduledTask> | null | undefined =>
      AsyncResult.isSuccess(result)
        ? result.value.tasks
        : AsyncResult.isFailure(result)
          ? null
          : undefined;
    const current = settledTasks(options.registry.get(atom));
    if (current !== undefined) return Promise.resolve(current);
    return new Promise((resolve) => {
      let done = false;
      const stops: Array<() => void> = [];
      const finish = (tasks: ReadonlyArray<ScheduledTask> | null) => {
        if (done) return;
        done = true;
        for (const stop of stops) stop();
        resolve(tasks);
      };
      const timer = setTimeout(() => finish(null), options.timeoutMs ?? TASKS_WAIT_MS);
      stops.push(() => clearTimeout(timer));
      stops.push(
        options.registry.subscribe(atom, (result) => {
          const tasks = settledTasks(result);
          if (tasks !== undefined) finish(tasks);
        }),
      );
      if (done) stops.at(-1)?.();
    });
  };
}

interface SettleGateTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

interface SettleGateThread extends ThreadMuteFields {
  readonly title: string;
}

/**
 * Asks once before settling threads that automations still post into. Requests made in the same
 * tick share one answer and one warning, so a bulk settle that calls per thread shows one dialog.
 * Threads without connected automations resolve true with no prompt.
 */
export function createSettleAutomationGate(options: {
  readonly readTasks: (
    environmentId: EnvironmentId,
  ) => Promise<ReadonlyArray<ScheduledTask> | null>;
  readonly readThread: (target: SettleGateTarget) => SettleGateThread | null;
  readonly confirm: (input: {
    readonly threads: ReadonlyArray<AutomatedThread>;
    readonly settleCount: number;
  }) => Promise<boolean>;
  readonly now?: () => number;
}): (targets: ReadonlyArray<SettleGateTarget>) => Promise<boolean> {
  let batch: { targets: Map<string, SettleGateTarget>; decision: Promise<boolean> } | null = null;

  const decide = async (targets: ReadonlyArray<SettleGateTarget>): Promise<boolean> => {
    const environmentIds = [...new Set(targets.map((target) => target.environmentId))];
    const tasksByEnvironment = new Map(
      await Promise.all(
        environmentIds.map(
          async (environmentId) =>
            [
              environmentId,
              await Promise.resolve()
                .then(() => options.readTasks(environmentId))
                .catch(() => null),
            ] as const,
        ),
      ),
    );
    const nowMs = (options.now ?? Date.now)();
    const threads: AutomatedThread[] = [];
    for (const target of targets) {
      const tasks = tasksByEnvironment.get(target.environmentId);
      if (!tasks) continue;
      const automations = connectedThreadAutomations(tasks, target.threadId);
      if (automations.length === 0) continue;
      const thread = options.readThread(target);
      threads.push({
        title: thread?.title ?? automations[0]!.title,
        muted: thread !== null && isThreadMuted(thread, nowMs),
        automations: automations.map((task) => task.title),
      });
    }
    if (threads.length === 0) return true;
    return options.confirm({ threads, settleCount: targets.length });
  };

  return (targets) => {
    if (targets.length === 0) return Promise.resolve(true);
    if (batch === null) {
      const pending = new Map<string, SettleGateTarget>();
      batch = {
        targets: pending,
        // Runs after the current tick, once every settle in a bulk action has joined.
        decision: Promise.resolve().then(() => {
          batch = null;
          return decide([...pending.values()]);
        }),
      };
    }
    for (const target of targets) {
      batch.targets.set(`${target.environmentId}:${target.threadId}`, target);
    }
    return batch.decision;
  };
}
