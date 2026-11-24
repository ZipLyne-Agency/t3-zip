import {
  createScheduledTasksReader,
  createSettleAutomationGate,
  settleAutomationsWarning,
} from "@t3tools/client-runtime/state/thread-automations";

import * as Dialog from "../../components/ui/Dialog";
import { getActiveLocale, m } from "../../i18n/messages";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";

/** One gate for the app, so settles started together share one warning. */
export const confirmSettleWithAutomations = createSettleAutomationGate({
  readTasks: createScheduledTasksReader({
    registry: appAtomRegistry,
    atom: (environmentId) => serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  }),
  readThread: (target) =>
    appAtomRegistry
      .get(environmentThreadShells.threadShellsAtom)
      .find((row) => row.id === target.threadId && row.environmentId === target.environmentId) ??
    null,
  confirm: (input) => {
    const warning = settleAutomationsWarning(input, getActiveLocale(), m);
    return new Promise((resolve) => {
      Dialog.confirm({
        title: warning.title,
        message: warning.message,
        confirmText: warning.confirmLabel,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  },
});
