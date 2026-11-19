import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  AlarmClockIcon,
  BellOffIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  EyeOffIcon,
} from "lucide-react";
import { msg, T, useGT } from "gt-react";
import { useState, type ReactNode } from "react";

import { isThreadMuted } from "@t3tools/shared/threadMute";
import { m } from "../../i18n/messages";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readThreadShell } from "../../state/entities";
import { useClientSettings } from "../../hooks/useSettings";
import { formatShortTimestamp, parseTimestampDate } from "../../timestampFormat";
import { AnimatedHeight } from "../AnimatedHeight";
import { isIndefiniteSnooze } from "../indefiniteSnooze";
import { ProjectFavicon } from "../ProjectFavicon";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { railRemuteInput } from "./railStatus.logic";
import type { RailListedThread, RailModel, RailProject } from "./useRailModel";

type ShelfKind = "snoozed" | "muted" | "settled" | "hidden";

/** A time as "6:00 PM", or "Tue 9:00 AM" when it is not today. */
export function untilLabel(iso: string, timestampFormat: TimestampFormat): string {
  const time = formatShortTimestamp(iso, timestampFormat);
  const date = parseTimestampDate(iso);
  if (!date || date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** Shows a failed thread action as a toast; an interrupted one stays quiet. */
function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): void {
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

const threadRefOf = (thread: EnvironmentThreadShell) =>
  scopeThreadRef(thread.environmentId, thread.id);

function ShelfRow(props: {
  icon: ReactNode;
  label: string;
  count: number;
  /** One icon and count beside the others, in the folded shelf block. */
  compact: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const gt = useGT();
  const trigger = props.compact ? (
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label={gt("{label}: {count}", { label: props.label, count: props.count })}
          className="flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs tabular-nums text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[popup-open]:bg-sidebar-row-hover [&>svg]:size-3.5 [&>svg]:shrink-0"
        />
      }
    >
      {props.icon}
      {props.count}
    </PopoverTrigger>
  ) : (
    <PopoverTrigger
      render={
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-(--sidebar-row-content-inset) text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[popup-open]:bg-sidebar-row-hover [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-(--sidebar-icon-color)"
        />
      }
    >
      {props.icon}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
        {props.count}
      </span>
    </PopoverTrigger>
  );
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      {props.compact ? (
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipPopup side="top">{props.label}</TooltipPopup>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverPopup side="right" align="end" sideOffset={8} width="lg" padding="none">
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}

function ShelfHeader(props: { title: string; count: number; description?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 pt-4 pb-2">
      <div className="flex items-center gap-2">
        <PopoverTitle>{props.title}</PopoverTitle>
        <span className="text-xs tabular-nums text-muted-foreground">{props.count}</span>
      </div>
      {props.description ? (
        <p className="text-xs text-muted-foreground">{props.description}</p>
      ) : null}
    </div>
  );
}

function ShelfThreadRow(props: {
  entry: RailListedThread;
  detail: string | null;
  action: { label: string; onClick: () => void } | null;
  onOpen: () => void;
}) {
  const { thread, projectName } = props.entry;
  return (
    <li className="group/shelf-row flex items-center gap-2 rounded-md px-2 hover:bg-accent/60">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-sm py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="w-full truncate text-sm text-foreground">{thread.title}</span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {[projectName, props.detail].filter(Boolean).join(" · ")}
        </span>
      </button>
      {props.action ? (
        <Button variant="outline" size="xs" className="shrink-0" onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      ) : null}
    </li>
  );
}

function ShelfProjectRow(props: {
  project: RailProject;
  detail: string | null;
  actionLabel: string;
  onAction: () => void;
  onOpen: () => void;
}) {
  const { group } = props.project;
  return (
    <li className="flex items-center gap-2 rounded-md px-2 hover:bg-accent/60">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ProjectFavicon project={group} className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{group.displayName}</span>
          {props.detail ? (
            <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
          ) : null}
        </span>
      </button>
      <Button variant="outline" size="xs" className="shrink-0" onClick={props.onAction}>
        {props.actionLabel}
      </Button>
    </li>
  );
}

function ShelfSubheading(props: { children: ReactNode }) {
  return (
    <p className="px-4 pt-1 pb-1 text-xs font-medium text-muted-foreground">{props.children}</p>
  );
}

function ShelfList(props: { children: ReactNode }) {
  return (
    <ul className="flex max-h-[min(36rem,70vh)] flex-col overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {props.children}
    </ul>
  );
}

function ShelfEmpty(props: { children: ReactNode }) {
  return <p className="px-4 pb-4 text-sm text-muted-foreground">{props.children}</p>;
}

/**
 * Snoozed (threads and projects), Muted, Settled and Hidden across every project, each opening
 * its own list. Folded, the block is one line of icons and counts.
 */
export function RailShelves(props: {
  model: RailModel;
  settledOpen: boolean;
  onSettledOpenChange: (open: boolean) => void;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
  hidden: readonly RailProject[];
  onShowProject: (projectKey: string) => void;
  /** Snoozed projects with when each comes back; they list on the Snoozed shelf. */
  snoozedProjects: readonly { readonly project: RailProject; readonly until: string }[];
  onWakeProject: (projectKey: string) => void;
  onOpenProject: (project: RailProject) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const gt = useGT();
  const compact = props.collapsed;
  const { model } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { setThreadMuted, unsnoozeThread, unsettleThread } = useThreadActions();
  const [openShelf, setOpenShelf] = useState<Exclude<ShelfKind, "settled"> | null>(null);
  const openFromShelf = (thread: EnvironmentThreadShell) => {
    setOpenShelf(null);
    props.onSettledOpenChange(false);
    props.onOpenThread(threadRefOf(thread));
  };
  const shelfOpenChange = (kind: Exclude<ShelfKind, "settled">) => (open: boolean) =>
    setOpenShelf(open ? kind : null);

  const unmuteAll = async () => {
    const before = model.muted.map(({ thread }) => thread);
    const results = await Promise.all(
      before.map((thread) =>
        setThreadMuted(threadRefOf(thread), false, undefined, { undo: false }),
      ),
    );
    const unmuted = before.filter((_, index) => results[index]?._tag === "Success");
    if (unmuted.length < before.length) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Some threads could not be unmuted"),
        }),
      );
    }
    if (unmuted.length === 0) return;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: gt("Unmuted {count, plural, one {{count} thread} other {{count} threads}}", {
          count: unmuted.length,
        }),
        actionProps: {
          children: gt("Undo"),
          onClick: () => {
            const undoAt = Date.now();
            for (const thread of unmuted) {
              // A mute set since Unmute All is the newer choice; Undo does not replace it.
              const current = readThreadShell(threadRefOf(thread));
              if (current === null || isThreadMuted(current, undoAt)) continue;
              const input = railRemuteInput(thread, undoAt);
              if (input === null) continue;
              void setThreadMuted(threadRefOf(thread), true, input.mutedUntil, {
                undo: false,
              }).then((result) => reportFailure(result, gt("Failed to mute again")));
            }
          },
        },
      }),
    );
  };

  const rows = (
    <>
      <ShelfRow
        icon={<AlarmClockIcon />}
        label={gt("Snoozed")}
        count={model.snoozed.length + props.snoozedProjects.length}
        compact={compact}
        open={openShelf === "snoozed"}
        onOpenChange={shelfOpenChange("snoozed")}
      >
        <ShelfHeader
          title={gt("Snoozed")}
          count={model.snoozed.length + props.snoozedProjects.length}
        />
        {props.snoozedProjects.length > 0 ? (
          <>
            <ShelfSubheading>
              <T>Projects</T>
            </ShelfSubheading>
            <ShelfList>
              {props.snoozedProjects.map(({ project, until }) => (
                <ShelfProjectRow
                  key={project.group.projectKey}
                  project={project}
                  detail={
                    isIndefiniteSnooze(until)
                      ? gt("Until You Wake It")
                      : gt("Until {time}", { time: untilLabel(until, timestampFormat) })
                  }
                  actionLabel={gt("Wake")}
                  onAction={() => props.onWakeProject(project.group.projectKey)}
                  onOpen={() => {
                    setOpenShelf(null);
                    props.onOpenProject(project);
                  }}
                />
              ))}
            </ShelfList>
          </>
        ) : null}
        {model.snoozed.length > 0 && props.snoozedProjects.length > 0 ? (
          <ShelfSubheading>
            <T>Threads</T>
          </ShelfSubheading>
        ) : null}
        {model.snoozed.length === 0 ? (
          props.snoozedProjects.length === 0 ? (
            <ShelfEmpty>
              <T>Nothing is snoozed. Snooze a thread, or a project from its ⋯ menu.</T>
            </ShelfEmpty>
          ) : null
        ) : (
          <ShelfList>
            {model.snoozed.map((entry) => (
              <ShelfThreadRow
                key={`${entry.thread.environmentId}:${entry.thread.id}`}
                entry={entry}
                detail={
                  entry.thread.snoozedUntil
                    ? isIndefiniteSnooze(entry.thread.snoozedUntil)
                      ? gt("Until You Wake It")
                      : gt("Until {time}", {
                          time: untilLabel(entry.thread.snoozedUntil, timestampFormat),
                        })
                    : null
                }
                action={{
                  label: gt("Wake"),
                  onClick: () =>
                    void unsnoozeThread(threadRefOf(entry.thread)).then((result) =>
                      reportFailure(result, gt("Failed to wake thread")),
                    ),
                }}
                onOpen={() => openFromShelf(entry.thread)}
              />
            ))}
          </ShelfList>
        )}
      </ShelfRow>
      <ShelfRow
        icon={<BellOffIcon />}
        label={gt("Muted")}
        count={model.muted.length}
        compact={compact}
        open={openShelf === "muted"}
        onOpenChange={shelfOpenChange("muted")}
      >
        <ShelfHeader
          title={gt("Muted Threads")}
          count={model.muted.length}
          description={gt(
            "Alerts are off for these. Each one comes back on its own at the time shown.",
          )}
        />
        {model.muted.length === 0 ? (
          <ShelfEmpty>
            <T>
              Nothing is muted. Mute a thread from the bell in its header, or right-click its tab.
            </T>
          </ShelfEmpty>
        ) : (
          <>
            <ShelfList>
              {model.muted.map((entry) => (
                <ShelfThreadRow
                  key={`${entry.thread.environmentId}:${entry.thread.id}`}
                  entry={entry}
                  detail={
                    entry.thread.mutedUntil
                      ? gt("Until {time}", {
                          time: untilLabel(entry.thread.mutedUntil, timestampFormat),
                        })
                      : gt("Until Unmuted")
                  }
                  action={{
                    label: gt("Unmute"),
                    onClick: () =>
                      void setThreadMuted(threadRefOf(entry.thread), false).then((result) =>
                        reportFailure(result, gt("Failed to unmute thread")),
                      ),
                  }}
                  onOpen={() => openFromShelf(entry.thread)}
                />
              ))}
            </ShelfList>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                <T>Click a row to open the thread.</T>
              </span>
              <Button variant="outline" size="xs" onClick={() => void unmuteAll()}>
                <T>Unmute All</T>
              </Button>
            </div>
          </>
        )}
      </ShelfRow>
      <ShelfRow
        icon={<CircleCheckIcon />}
        label={gt("Settled")}
        count={model.settled.count}
        compact={compact}
        open={props.settledOpen}
        onOpenChange={props.onSettledOpenChange}
      >
        <ShelfHeader title={gt("Settled Threads")} count={model.settled.count} />
        {model.settled.threads.length === 0 && !model.settled.loading ? (
          <ShelfEmpty>
            {model.settled.failed
              ? gt("Settled threads did not load.")
              : gt("Nothing is settled yet.")}
          </ShelfEmpty>
        ) : (
          <ShelfList>
            {model.settled.threads.map((entry) => (
              <ShelfThreadRow
                key={`${entry.thread.environmentId}:${entry.thread.id}`}
                entry={entry}
                detail={null}
                action={{
                  label: gt("Reopen"),
                  onClick: () =>
                    void unsettleThread(threadRefOf(entry.thread)).then((result) =>
                      reportFailure(result, gt("Failed to reopen thread")),
                    ),
                }}
                onOpen={() => openFromShelf(entry.thread)}
              />
            ))}
          </ShelfList>
        )}
        {model.settled.failed ? (
          <div className="flex justify-end border-t border-border px-4 py-2.5">
            <Button variant="outline" size="xs" onClick={model.settled.retry}>
              <T>Try Again</T>
            </Button>
          </div>
        ) : model.settled.hasMore ? (
          <div className="flex justify-end border-t border-border px-4 py-2.5">
            <Button
              variant="outline"
              size="xs"
              disabled={model.settled.loading}
              onClick={model.settled.showMore}
            >
              {model.settled.loading ? gt("Loading…") : gt("Show More")}
            </Button>
          </div>
        ) : null}
      </ShelfRow>
      <ShelfRow
        icon={<EyeOffIcon />}
        label={gt("Hidden")}
        count={props.hidden.length}
        compact={compact}
        open={openShelf === "hidden"}
        onOpenChange={shelfOpenChange("hidden")}
      >
        <ShelfHeader
          title={gt("Hidden Projects")}
          count={props.hidden.length}
          description={gt(
            "Hidden projects stay in their folders. Show one to put it back where it was.",
          )}
        />
        {props.hidden.length === 0 ? (
          <ShelfEmpty>
            <T>Nothing is hidden. Hide a project from its ⋯ menu.</T>
          </ShelfEmpty>
        ) : (
          <ShelfList>
            {props.hidden.map((project) => (
              <ShelfProjectRow
                key={project.group.projectKey}
                project={project}
                detail={null}
                actionLabel={gt("Show")}
                onAction={() => props.onShowProject(project.group.projectKey)}
                onOpen={() => {
                  setOpenShelf(null);
                  props.onOpenProject(project);
                }}
              />
            ))}
          </ShelfList>
        )}
      </ShelfRow>
    </>
  );

  return (
    <AnimatedHeight>
      {compact ? (
        <div className="flex items-center gap-0.5 px-0.5">
          {rows}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-expanded={false}
                  aria-label={gt("Show lists")}
                  onClick={() => props.onCollapsedChange(false)}
                  className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <ChevronDownIcon aria-hidden className="size-3 -rotate-90" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              <T>Show lists</T>
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : (
        <div className="flex flex-col gap-px">
          <CollapsibleSectionHeader expanded onClick={() => props.onCollapsedChange(true)}>
            <T>Lists</T>
          </CollapsibleSectionHeader>
          {rows}
        </div>
      )}
    </AnimatedHeight>
  );
}
