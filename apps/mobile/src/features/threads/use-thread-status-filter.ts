import { useAtomValue } from "@effect/atom-react";
import { normalizeThreadStatusFilter } from "@t3tools/client-runtime/state/thread-status-filter";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import type { ThreadListStatusFilter } from "../../persistence/mobile-preferences";
import { threadEnvironment } from "../../state/threads";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { showThreadUndoNotice } from "../home/thread-undo-notice";
import { applyClearMarks, restoreClearMarks, threadStatusKey } from "./threadStatusFilterList";

/** The Undo slot a clear claims, apart from settle, snooze and pin. */
const CLEAR_UNDO_KIND = "clear";

export interface ClearFromDoneTarget {
  readonly thread: EnvironmentThreadShell;
  /** Not opened yet: clearing also marks it read, and Undo marks it unread again. */
  readonly unread: boolean;
}

/**
 * The thread list's status filter and Done's clear marks, both kept on this device. The first
 * load starts keeping finished threads from now, so older ones never flood Opened. The saved
 * filter is read onto a tab the list shows: every scope combines Working and Done.
 */
export function useThreadStatusFilter() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const markThreadUnread = useAtomCommand(threadEnvironment.markUnread, { reportFailure: false });
  // T3 Zip: the server keeps clears for every device; an older server refuses this quietly.
  const clearThreadDone = useAtomCommand(threadEnvironment.clearDone, { reportFailure: false });
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const statusFilter: ThreadListStatusFilter = normalizeThreadStatusFilter(
    loaded ? (preferencesResult.value.threadListStatusFilter ?? "all") : "all",
    true,
  );
  const clears = loaded ? (preferencesResult.value.threadDoneClears ?? null) : null;
  const needsReviewStart = loaded && clears === null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stores when this device began keeping finished threads, once, after preferences load
  useEffect(() => {
    if (!needsReviewStart) return;
    void savePreferences({
      transform: (current) =>
        current.threadDoneClears
          ? {}
          : { threadDoneClears: { reviewSince: new Date().toISOString(), clearedAt: {} } },
    });
  }, [needsReviewStart, savePreferences]);

  const setStatusFilter = (filter: ThreadListStatusFilter) => {
    if (!loaded) return;
    void savePreferences({ threadListStatusFilter: filter });
  };

  const clearFromDone = (targets: readonly ClearFromDoneTarget[]) => {
    if (!loaded || targets.length === 0) return;
    const nowIso = new Date().toISOString();
    const keys = targets.map(({ thread }) => threadStatusKey(thread));
    const base = clears ?? { reviewSince: nowIso, clearedAt: {} };
    const previous = new Map(keys.map((key) => [key, base.clearedAt[key]] as const));
    void savePreferences({
      transform: (current) => ({
        threadDoneClears: applyClearMarks(current.threadDoneClears ?? base, keys, nowIso),
      }),
    });
    const synced = targets.map(({ thread }) => ({
      thread,
      before: thread.doneClearedAt ?? null,
      cleared: clearThreadDone({
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      }),
    }));
    const visits = targets.flatMap(({ thread, unread }) =>
      unread
        ? [
            {
              thread,
              visited: visitThread({
                environmentId: thread.environmentId,
                input: { threadId: thread.id, visitedAt: nowIso },
              }),
            },
          ]
        : [],
    );
    // One notice covers the whole clear; it belongs to the first thread's Undo slot.
    showThreadUndoNotice({
      action: "Cleared",
      claim: ThreadUndo.begin(CLEAR_UNDO_KIND, keys[0]!),
      undo: async () => {
        void savePreferences({
          transform: (current) =>
            current.threadDoneClears
              ? { threadDoneClears: restoreClearMarks(current.threadDoneClears, previous, nowIso) }
              : {},
        });
        // The clear must land first, or putting the old mark back could reach the server before it.
        for (const { thread, before, cleared } of synced) {
          await cleared;
          void clearThreadDone({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, restore: before },
          });
        }
        // The visit must land first, or marking unread could reach the server before it.
        for (const { thread, visited } of visits) {
          await visited;
          await markThreadUnread({
            environmentId: thread.environmentId,
            input: { threadId: thread.id },
          });
        }
      },
    });
  };

  return { loaded, statusFilter, setStatusFilter, clears, clearFromDone } as const;
}
