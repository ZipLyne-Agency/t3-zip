import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { showThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { useAcknowledgeThreadWoke, useMarkThreadUnread } from "../../hooks/useThreadActions";
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
 * lists them under New again. The clear marks live on this device; Undo puts back each
 * thread's earlier mark and read state, unless a later clear or send has replaced the mark.
 */
export function useClearFromDone() {
  const acknowledge = useAcknowledgeThreadWoke();
  const markUnread = useMarkThreadUnread();
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
      showThreadUndoNotice({
        action: "Cleared",
        claim: ThreadUndo.begin(CLEAR_UNDO_KIND, tab.key),
        undo: async () => {
          const state = useUiStateStore.getState();
          if (state.threadDoneClearedAtById[tab.key] === nowIso) {
            state.restoreDoneCleared({ [tab.key]: previous.get(tab.key) });
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
