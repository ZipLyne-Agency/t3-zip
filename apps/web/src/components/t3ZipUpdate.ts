import type { DesktopUpdateState, ServerSettings } from "@t3tools/contracts";

import { APP_BASE_NAME } from "../branding";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";
import {
  getDesktopUpdateIdleTooltip,
  getDesktopUpdateInstallConfirmationMessage,
} from "./desktopUpdate.logic";

/** Whether threads cut off by a restart continue: everywhere, in some projects, or nowhere. */
export type RestartContinuation = "all" | "some" | "none";

/** Reads "Continue threads after restarts" and each project's own setting for it. */
export function restartContinuation(
  settings: Pick<ServerSettings, "continueThreadsAfterServerUpdate" | "projectSettingsOverrides">,
): RestartContinuation {
  const global = settings.continueThreadsAfterServerUpdate;
  const overridden = Object.values(settings.projectSettingsOverrides).some(
    (overrides) =>
      overrides.continueThreadsAfterServerUpdate !== undefined &&
      overrides.continueThreadsAfterServerUpdate !== global,
  );
  if (overridden) return "some";
  return global ? "all" : "none";
}

const RESTART_OUTCOME: Record<RestartContinuation, string> = {
  all: msg(
    "Running threads stop for the restart and continue when T3 Zip reopens. Commands they had running start over.",
  ),
  some: msg(
    "Running threads stop for the restart. Those in projects set to continue after restarts pick up again when T3 Zip reopens; the rest stay stopped.",
  ),
  none: msg(
    "Running threads stop for the restart and stay stopped. Continue threads after restarts is off in Settings.",
  ),
};

/**
 * What the Update button asks before it restarts the app. The install does not wait for
 * running threads, so it says what happens to them, from the continue-after-restart setting.
 */
export function installConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  continuation: RestartContinuation,
  appName: string = APP_BASE_NAME,
): string {
  if (appName !== "T3 Zip") return getDesktopUpdateInstallConfirmationMessage(state);
  const version = state.downloadedVersion ?? state.availableVersion;
  const question = version
    ? m(msg("Install update {version} and restart T3 Zip?"), { version })
    : m(msg("Install update and restart T3 Zip?"));
  return `${question}\n\n${m(RESTART_OUTCOME[continuation])}`;
}

/**
 * The button's tooltip while it offers nothing. When last night's merge or build failed, T3 Zip
 * says so here, since the button itself has nothing to install.
 */
export function updateIdleTooltip(
  state: Pick<DesktopUpdateState, "enabled" | "status" | "message" | "errorContext"> | null,
  managedDenial?: string,
  resolve?: MessageResolver,
) {
  const message = state?.message?.trim();
  if (state?.status === "error" && state.errorContext === "check" && message) {
    return { title: (resolve ?? m)(msg("Last update did not finish")), detail: message };
  }
  return getDesktopUpdateIdleTooltip(state, managedDenial, resolve);
}
