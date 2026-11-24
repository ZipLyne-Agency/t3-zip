import type { ThreadStatusFilter } from "@t3tools/client-runtime/state/thread-status-filter";
import { CheckCheckIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import type { KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { groupRailWaiting, railQueueAge } from "./railQueue.logic";
import type { RailQueueItem } from "./useRailQueue";

type QueueFilter = "waiting" | "working" | "done";

/** The status colors the rows use: amber needs you, blue working, green done. */
const BADGE_TONE: Record<QueueFilter, string> = {
  waiting: "bg-warning/16 text-warning-foreground ring-warning/40 dark:bg-warning/24",
  working: "bg-info/16 text-info-foreground ring-info/40 dark:bg-info/24",
  done: "bg-success/16 text-success-foreground ring-success/40 dark:bg-success/24",
};

const FILTER_LABEL: Record<"all" | QueueFilter, string> = {
  all: msg("All", { $context: "filter: every thread" }),
  waiting: msg("Waiting", { $context: "filter: threads waiting on you" }),
  working: msg("Working", { $context: "filter: threads running now" }),
  done: msg("Done", { $context: "filter: finished threads" }),
};

/** A count badge in its list's color; it shows only while the list has threads. */
function FilterCount(props: { readonly kind: QueueFilter; readonly count: number }) {
  if (props.count === 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-3xs font-semibold tabular-nums ring-1 ring-inset transition duration-150 ease-out starting:scale-75 starting:opacity-0 motion-reduce:transition-none",
        BADGE_TONE[props.kind],
      )}
    >
      {props.count}
    </span>
  );
}

/**
 * The thread filters: All, or only the threads waiting on you, running or finished. The caller
 * picks the tabs: one project shows Working and Done as one tab, each word with its own count,
 * and All Projects leaves out All. A count badge shows only while a list has threads, so a
 * quiet row stays short.
 */
export function RailFilterBar<F extends ThreadStatusFilter>(props: {
  readonly filters: ReadonlyArray<F>;
  readonly filter: F;
  readonly onChange: (filter: F) => void;
  readonly counts: Readonly<Record<QueueFilter, number>>;
}) {
  const gt = useGT();
  const m = useMessages();
  const { filters, counts } = props;
  // A radio group is one Tab stop; the arrow keys move the choice, wrapping at the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = filters.findIndex((value) => value === props.filter);
    const next = filters[(index + step + filters.length) % filters.length]!;
    props.onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-rail-filter="${next}"]`)?.focus();
  };
  const accessibleLabel = (value: ThreadStatusFilter): string => {
    if (value === "workingDone") {
      return gt("Working: {working}, Done: {done}", {
        $context: "filter tab for running and finished threads, with their counts",
        working: counts.working,
        done: counts.done,
      });
    }
    const text = m(FILTER_LABEL[value]);
    const count = value === "all" ? 0 : counts[value];
    return count > 0 ? gt("{label}: {count}", { label: text, count }) : text;
  };
  return (
    // Wraps instead of clipping a label when the sidebar is narrow.
    <div
      role="radiogroup"
      aria-label={gt("Show", { $context: "label of the thread filter group" })}
      className="flex flex-wrap items-center gap-0.5 px-1 pt-2"
      onKeyDown={onKeyDown}
    >
      {filters.map((tab) => {
        const selected = props.filter === tab;
        // Widened from F so the checks below narrow it.
        const value: ThreadStatusFilter = tab;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-rail-filter={value}
            tabIndex={selected ? 0 : -1}
            aria-label={accessibleLabel(value)}
            onClick={() => props.onChange(tab)}
            className={cn(
              "flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
              selected
                ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            {value === "workingDone" ? (
              // The two tabs it replaces, side by side in one: no wider than both together.
              <>
                {m(FILTER_LABEL.working)}
                <FilterCount kind="working" count={counts.working} />
                <span aria-hidden className="text-sidebar-muted-foreground">
                  ·
                </span>
                {m(FILTER_LABEL.done)}
                <FilterCount kind="done" count={counts.done} />
              </>
            ) : (
              <>
                {m(FILTER_LABEL[value])}
                {value === "all" ? null : <FilterCount kind={value} count={counts[value]} />}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** What an empty filter says, for the column's empty list. */
export const RAIL_FILTER_EMPTY_COPY: Record<QueueFilter, string> = {
  waiting: msg("Nothing is waiting for you."),
  working: msg("Nothing is running right now."),
  done: msg("No finished threads to check."),
};

const LIST_LABEL: Record<QueueFilter, string> = {
  waiting: msg("Waiting for you"),
  working: msg("Working", { $context: "list of threads running now" }),
  done: msg("Done", { $context: "list of finished threads" }),
};

/** Clears a whole Done section; it sits in the section's heading. */
export function ClearAllButton(props: { readonly section: string; readonly onClick: () => void }) {
  const gt = useGT();
  return (
    <button
      type="button"
      aria-label={gt("Clear All {section}", { section: props.section })}
      onClick={props.onClick}
      className="inline-flex h-4 cursor-pointer items-center gap-1 rounded-sm px-1 text-xs font-medium text-success-foreground outline-none transition-colors duration-100 hover:bg-success/16 hover:text-success-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
    >
      <CheckCheckIcon aria-hidden className="size-3" />
      <T>Clear All</T>
    </button>
  );
}

function QueueRow(props: {
  readonly item: RailQueueItem;
  readonly nowMs: number;
  readonly active: boolean;
  readonly onOpen: (item: RailQueueItem) => void;
  /** Clears the thread from Done; null outside Done. */
  readonly onClear: ((item: RailQueueItem) => void) | null;
}) {
  const { item, onClear } = props;
  const gt = useGT();
  const icon = item.tab.icon;
  const age = railQueueAge(item.sinceMs, props.nowMs);
  return (
    <li className="group/queue-row relative list-none">
      <button
        type="button"
        aria-current={props.active ? "true" : undefined}
        onClick={() => props.onOpen(item)}
        className={cn(
          "flex w-full cursor-pointer items-start gap-2.5 rounded-md px-(--sidebar-row-content-inset) py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.active
            ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          {icon ? (
            <TopStatusIcon icon={icon.icon} className={cn("size-3.5", icon.className)} />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm",
              // The Clear button takes the title's end on hover.
              onClear !== null &&
                "group-hover/queue-row:pe-14 group-focus-within/queue-row:pe-14 pointer-coarse:pe-14",
            )}
          >
            {item.thread.title}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-sidebar-muted-foreground">
            <span className="min-w-0 truncate">{item.projectName ?? gt("Unknown project")}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">
              {icon?.label ? `${icon.label} ${age}` : age}
            </span>
          </span>
        </span>
      </button>
      {onClear !== null ? (
        <button
          type="button"
          aria-label={gt("Clear {title}", { title: item.thread.title })}
          onClick={() => onClear(item)}
          data-tone="success"
          className="row-action-opaque absolute top-1.5 right-1.5 inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-success-foreground opacity-0 outline-none transition-opacity duration-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-hover/queue-row:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
        >
          <CheckCheckIcon aria-hidden className="size-3" />
          <T>Clear</T>
        </button>
      ) : null}
    </li>
  );
}

/**
 * Threads in one list, oldest first, each with its project and how long ago. Waiting splits
 * into sections by what each thread wants, and a section shows only when it has a thread.
 */
export function RailQueueList(props: {
  readonly kind: QueueFilter;
  readonly items: readonly RailQueueItem[];
  readonly nowMs: number;
  readonly activeKey: string | null;
  readonly onOpen: (item: RailQueueItem) => void;
  /** Clears Done threads; Done splits into New and Opened, each with Clear All. */
  readonly onClear: (items: readonly RailQueueItem[]) => void;
}) {
  const m = useMessages();
  if (props.items.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">
        {m(RAIL_FILTER_EMPTY_COPY[props.kind])}
      </p>
    );
  }
  const row = (item: RailQueueItem) => (
    <QueueRow
      key={item.key}
      item={item}
      nowMs={props.nowMs}
      active={item.key === props.activeKey}
      onOpen={props.onOpen}
      onClear={props.kind === "done" ? (cleared) => props.onClear([cleared]) : null}
    />
  );
  if (props.kind === "done") {
    const sections = [
      {
        id: "new",
        label: m(msg("New", { $context: "threads finished and not yet opened" })),
        items: props.items.filter((item) => !item.opened),
      },
      {
        id: "opened",
        label: m(msg("Opened", { $context: "finished threads already opened" })),
        items: props.items.filter((item) => item.opened),
      },
    ].filter((section) => section.items.length > 0);
    return (
      <div className="flex flex-col gap-1 pt-1">
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label}>
            <h3 className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-0.5 text-xs font-medium text-sidebar-muted-foreground">
              <span>{section.label}</span>
              <span className="flex items-center gap-2">
                <ClearAllButton
                  section={section.label}
                  onClick={() => props.onClear(section.items)}
                />
                <span className="tabular-nums">{section.items.length}</span>
              </span>
            </h3>
            <ul className="flex flex-col gap-px">{section.items.map(row)}</ul>
          </section>
        ))}
      </div>
    );
  }
  if (props.kind !== "waiting") {
    return (
      <ul aria-label={m(LIST_LABEL[props.kind])} className="flex flex-col gap-px pt-1">
        {props.items.map(row)}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-1 pt-1">
      {groupRailWaiting(props.items, m).map((section) => (
        <section key={section.reason} aria-label={section.label}>
          <h3 className="flex items-center justify-between px-2 pt-1.5 pb-0.5 text-xs font-medium text-sidebar-muted-foreground">
            <span>{section.label}</span>
            <span className="tabular-nums">{section.items.length}</span>
          </h3>
          <ul className="flex flex-col gap-px">{section.items.map(row)}</ul>
        </section>
      ))}
    </div>
  );
}
