import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createScheduledTasksReader,
  createSettleAutomationGate,
  settleAutomationsWarning,
} from "@t3tools/client-runtime/state/thread-automations";

import { getActiveLocale, m } from "./i18n/messages";
import { readLocalApi } from "./localApi";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadShell } from "./state/entities";
import { serverEnvironment } from "./state/server";

/** One gate for the whole window, so a bulk settle from any surface shows one warning. */
export const confirmSettleWithAutomations = createSettleAutomationGate({
  readTasks: createScheduledTasksReader({
    registry: appAtomRegistry,
    atom: (environmentId) => serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  }),
  readThread: (target) => readThreadShell(scopeThreadRef(target.environmentId, target.threadId)),
  confirm: async (input) => {
    const localApi = readLocalApi();
    if (!localApi) return true;
    const warning = settleAutomationsWarning(input, getActiveLocale(), m);
    return localApi.dialogs.confirm(`${warning.title}\n${warning.message}`, {
      confirmLabel: warning.confirmLabel,
    });
  },
});
