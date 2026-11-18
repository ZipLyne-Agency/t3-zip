import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { threadMuteEndsAt } from "@t3tools/shared/threadMute";
import { BellIcon, BellOffIcon, CheckIcon } from "lucide-react";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useDeadlinePassed } from "../../hooks/useDeadline";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useQuietThreadShell, useServerConfigs } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import type { SnoozePreset } from "../Sidebar.snooze";
import { ThreadStatusLine } from "../chat/ThreadStatusLine";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { type ActiveMute, muteCopy, type MutePresetRow, mutePresetName } from "./threadMute.logic";
import { useThreadMuteActions } from "./useThreadMuteActions";
import { useNowMinuteMs } from "./useThreadTabs";

/**
 * The thread's mute in effect now. A timed mute ends exactly at its deadline, not on the next
 * minute tick.
 */
function useActiveMute(threadRef: ScopedThreadRef | null): ActiveMute {
  const thread = useQuietThreadShell(threadRef);
  const nowMs = useNowMinuteMs();
  const endsAt = thread === null ? undefined : threadMuteEndsAt(thread, nowMs);
  const ended = useDeadlinePassed(typeof endsAt === "number" ? endsAt : null);
  if (endsAt === undefined || (endsAt !== null && ended)) return null;
  return { until: endsAt };
}

/** The header's bell: mute with exact return times, or see and change the mute in effect. */
export function ThreadMuteMenu({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const supportsMute =
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities.threadMute === true;
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const narrow = useMediaQuery("max-md");
  const mute = useActiveMute(threadRef);
  const nowMs = useNowMinuteMs();
  const { resolveMuteMenu, applyMuteChoice, unmute, formatTime } = useThreadMuteActions();
  const gt = useGT();
  const m = useMessages();
  const [menu, setMenu] = useState<{
    readonly presets: ReadonlyArray<SnoozePreset>;
    readonly rows: ReadonlyArray<MutePresetRow>;
  } | null>(null);
  if (!supportsMute || narrow) return null;
  const copy = muteCopy(mute, nowMs, formatTime, m);
  const Icon = mute === null ? BellIcon : BellOffIcon;

  return (
    <Menu
      open={menu !== null}
      onOpenChange={(open) => setMenu(open ? resolveMuteMenu(threadRef, mute) : null)}
    >
      <MenuTrigger
        disabled={!canOperate}
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            className="shrink-0 [-webkit-app-region:no-drag]"
            aria-label={mute === null ? gt("Mute Notifications") : copy.button}
          />
        }
      >
        <Icon aria-hidden />
        <span className={mute === null ? "sr-only" : undefined}>{copy.button}</span>
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        <div className="px-2 pt-1.5 pb-2">
          <p className="font-medium text-foreground text-sm">{copy.title}</p>
          <p className="text-muted-foreground text-xs">{copy.subtitle}</p>
        </div>
        {mute !== null ? (
          <>
            <MenuItem onClick={() => void unmute(threadRef)}>
              <BellIcon aria-hidden />
              <T>Unmute Now</T>
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          {mute !== null ? (
            <MenuGroupLabel>
              <T>Change Time</T>
            </MenuGroupLabel>
          ) : null}
          {(menu?.rows ?? []).map((row, index) => (
            <MuteRow
              key={row.id}
              row={row}
              separatorBefore={index === 1}
              onPick={() => void applyMuteChoice(threadRef, row.id, menu?.presets ?? [])}
            />
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => void applyMuteChoice(threadRef, "mute:custom", [])}>
            <span className="size-4 shrink-0" aria-hidden />
            <T>Custom Time…</T>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function MuteRow(props: {
  readonly row: MutePresetRow;
  readonly separatorBefore: boolean;
  readonly onPick: () => void;
}) {
  const { row } = props;
  return (
    <>
      {props.separatorBefore ? <MenuSeparator /> : null}
      <MenuItem aria-label={mutePresetName(row)} onClick={props.onPick}>
        {row.checked ? (
          <CheckIcon aria-hidden className="text-foreground" />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {row.when ? <MenuItemDetail>{row.when}</MenuItemDetail> : null}
      </MenuItem>
    </>
  );
}

/**
 * The line at the end of a muted thread: when alerts come back, and Unmute. Null while the
 * thread is not muted, so the timeline footer can stay empty.
 */
export function useThreadMuteStatusLine(threadRef: ScopedThreadRef | null) {
  const mute = useActiveMute(threadRef);
  const nowMs = useNowMinuteMs();
  const canOperate = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const { unmute, formatTime } = useThreadMuteActions();
  const gt = useGT();
  const m = useMessages();
  const [unmuting, setUnmuting] = useState(false);
  // Desktop widths only, like the header's mute button.
  const narrow = useMediaQuery("max-md");
  if (threadRef === null || mute === null || narrow) return null;
  const banner = muteCopy(mute, nowMs, formatTime, m).banner;
  if (banner === null) return null;
  return (
    <ThreadStatusLine
      icon={<BellOffIcon />}
      label={banner}
      clockMinute={String(nowMs)}
      actionLabel={
        unmuting
          ? gt("Unmuting...")
          : gt("Unmute", { $context: "verb, turns notifications back on" })
      }
      actionDisabled={!canOperate || unmuting}
      onAction={() => {
        setUnmuting(true);
        void unmute(threadRef).finally(() => setUnmuting(false));
      }}
    />
  );
}
