import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { formatShortTimestamp } from "../../timestampFormat";
import { timedSnoozePresets } from "../indefiniteSnooze";
import { pickMuteEnd, resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { type ActiveMute, buildMutePresetRows, type MuteMenuId } from "./threadMute.logic";

export function reportThreadActionFailure(
  title: string,
  result: AtomCommandResult<unknown, unknown>,
) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : m(msg("An error occurred.")),
    }),
  );
}

/**
 * Mute and unmute with the sidebar's presets and Custom Time dialog. Each change shows the
 * thread undo notice through `setThreadMuted`.
 */
export function useThreadMuteActions() {
  const { setThreadMuted } = useThreadActions();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  /** The preset rows for a menu that is opening now, with the exact time each one ends. */
  const resolveMuteMenu = (ref: ScopedThreadRef, mute: ActiveMute) => {
    const presets = timedSnoozePresets(
      resolveSnoozePresets(new Date(), timestampFormat, ref.environmentId),
    );
    return { presets, rows: buildMutePresetRows(presets, mute) };
  };

  const applyMuteChoice = async (
    ref: ScopedThreadRef,
    id: MuteMenuId,
    shown: ReadonlyArray<SnoozePreset>,
  ) => {
    const choice = await pickMuteEnd(id, shown, timestampFormat, ref.environmentId);
    if (!choice) return;
    reportThreadActionFailure(
      m(msg("Failed to mute notifications")),
      await setThreadMuted(ref, true, choice.mutedUntil),
    );
  };

  const unmute = async (ref: ScopedThreadRef) => {
    reportThreadActionFailure(
      m(msg("Failed to unmute notifications")),
      await setThreadMuted(ref, false),
    );
  };

  const formatTime = (date: Date) => formatShortTimestamp(date.toISOString(), timestampFormat);

  return { resolveMuteMenu, applyMuteChoice, unmute, formatTime };
}
