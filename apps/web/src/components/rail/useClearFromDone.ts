import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { showThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { useAcknowledgeThreadWoke, useMarkThreadUnread } from "../../hooks/useThreadActions";
import { readEnvironmentServerConfigLoaded } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUiStateStore } from "../../uiStateStore";
import type { ThreadTabEntry } from "../tabs/useThreadTabs";

export interface ClearFromDoneTarget {
  readonly tab: ThreadTabEntry;
  /** Not read yet: clearing also marks it read, and Undo marks it unread again. */
  readonly unread: boolean;
}

/** The Undo kind for clears; sending a message in the thread ends its Undo. */
export const CLEAR_UNDO_KIND = "clear";

/**
 * Clears threads from Done. They stay in All for more work, and a run that finishes later
 * lists them under New again. The server keeps the clear for every device, and this device keeps
 * its own mark too, for servers that do not. Undo puts back each thread's earlier marks and read
 * state, unless a later clear or send has replaced the local mark.
 */
export function useClearFromDone() {
  const acknowledge = useAcknowledgeThreadWoke();
  const markUnread = useMarkThreadUnread();
  // A server without the command refuses it; the local mark still clears this device.
  const clearDone = useAtomCommand(threadEnvironment.clearDone, { reportFailure: false });
  const sendClear = (tab: ClearFromDoneTarget["tab"], restore?: string | null) =>
    readEnvironmentServerConfigLoaded(tab.ref.environmentId)
      ? clearDone({
          environmentId: tab.ref.environmentId,
          input: {
            threadId: tab.ref.threadId,
            ...(restore === undefined ? {} : { restore }),
          },
        })
      : null;
  return (targets: readonly ClearFromDoneTarget[]) => {
    if (targets.length === 0) return;
    const store = useUiStateStore.getState();
    const nowIso = new Date().toISOString();
    const previous = new Map(
      targets.map(({ tab }) => [tab.key, store.threadDoneClearedAtById[tab.key]] as const),
    );
    store.clearDoneThreads(
      targets.map(({ tab }) => tab.key),
      nowIso,
    );
    for (const { tab, unread } of targets) {
      const visited = unread ? acknowledge(tab.ref, nowIso) : null;
      const syncedBefore = tab.thread.doneClearedAt ?? null;
      const cleared = sendClear(tab);
      showThreadUndoNotice({
        action: "Cleared",
        claim: ThreadUndo.begin(CLEAR_UNDO_KIND, tab.key),
        undo: async () => {
          const state = useUiStateStore.getState();
          if (state.threadDoneClearedAtById[tab.key] === nowIso) {
            state.restoreDoneCleared({ [tab.key]: previous.get(tab.key) });
          }
          if (cleared !== null) {
            // The clear must land first, or putting the old mark back could reach the server before it.
            await cleared;
            void sendClear(tab, syncedBefore);
          }
          if (visited === null) return AsyncResult.success(undefined);
          // The visit must land first, or marking unread could reach the server before it.
          await visited;
          return markUnread(tab.ref);
        },
        failureTitle: m(msg("Failed to undo clear")),
      });
    }
  };
}
