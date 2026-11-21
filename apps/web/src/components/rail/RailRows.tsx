import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  AlarmClockIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  EyeOffIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  StarIcon,
  StarOffIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { ProjectFavicon } from "../ProjectFavicon";
import { pickSnoozePreset, resolveSnoozePresets } from "../Sidebar.snooze";
import { useClientSettings } from "../../hooks/useSettings";
import { TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { WORKING_ICON_MOTION } from "../tabs/threadTabs.logic";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  railDropRowKey,
  type NoProjectPosition,
  type RailDragItem,
  type RailDrop,
  type RailDropRow,
} from "./railLayout.logic";
import {
  railNeedsLabel,
  railStatusDots,
  summarizeRailFolder,
  type RailCounts,
  type RailDotState,
  type RailTopStatus,
} from "./railStatus.logic";
import type { RailProject } from "./useRailModel";

const NO_FOLDER = "__none__";

/** What the rows ask the rail to do. Moves and folder changes write the stored rail order. */
export interface RailRowActions {
  readonly openProject: (projectKey: string) => void;
  readonly newThread: (projectKey: string) => void;
  readonly stepProject: (projectKey: string, direction: "up" | "down") => void;
  readonly setProjectFolder: (projectKey: string, folderId: string | null) => void;
  readonly newFolder: (projectKey?: string) => void;
  readonly toggleFolder: (folderId: string) => void;
  readonly stepFolder: (folderId: string, direction: "up" | "down") => void;
  readonly startRename: (folderId: string) => void;
  readonly finishRename: (folderId: string, name: string | null) => void;
  readonly startProjectRename: (projectKey: string) => void;
  readonly finishProjectRename: (projectKey: string, name: string | null) => void;
  readonly removeFolder: (folderId: string) => void;
  readonly hideProject: (projectKey: string) => void;
  /** Takes the project off the rail until `until`; see the rail store. */
  readonly snoozeProject: (projectKey: string, until: string) => void;
  readonly setFavorite: (projectKey: string, favorite: boolean) => void;
  /** False while a menu choice moved focus into a folder name, so closing it leaves focus there. */
  readonly restoreMenuFocus: () => boolean;
  /** True right after a drag, so the click that ends it does not open the project. */
  readonly suppressClick: () => boolean;
}

export interface RailFolderChoice {
  readonly folderId: string;
  readonly name: string;
}

function RailNeedsBadge(props: { count: number; className?: string }) {
  if (props.count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning/16 px-1 text-3xs font-semibold tabular-nums text-warning-foreground ring-1 ring-inset ring-warning/40 dark:bg-warning/24",
        props.className,
      )}
    >
      <span aria-hidden>{props.count}</span>
      <span className="sr-only">{railNeedsLabel(props.count)}</span>
    </span>
  );
}

/** The ">_" chip No Project shows in place of a project icon. */
export function NoProjectChip(props: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-mono text-2xs font-semibold text-muted-foreground",
        props.className,
      )}
    >
      {/* oxlint-disable-next-line t3code/no-untranslated-copy -- the ">_" terminal glyph, not copy */}
      &gt;_
    </span>
  );
}

/**
 * A row's surface, as the classic sidebar draws its rows: the active row filled and the rest
 * filled only on hover. Folder rows are one line, 32px tall; project rows add a detail line.
 */
function railRowClassName(active: boolean, lines: 1 | 2 = 1) {
  return cn(
    lines === 1 ? "h-8" : "min-h-11 py-1",
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md pr-(--sidebar-row-content-inset) text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active
      ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
      : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
  );
}

/** Trailing status, hidden under the ⋯ button while the row is hovered or its menu is open. */
/**
 * The row's right edge: its counts on the first line and, under them, how long ago a thread
 * changed, so every row puts the time in the same place.
 */
function RailTrailing(props: { menuOpen: boolean; age?: string | null; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-end group-hover/rail-item:invisible group-focus-within/rail-item:invisible pointer-coarse:invisible",
        props.menuOpen && "invisible",
      )}
    >
      <span className="flex h-5 items-center gap-1.5">{props.children}</span>
      {props.age ? (
        <span
          aria-hidden
          className="text-2xs leading-4 tabular-nums text-sidebar-muted-foreground/70"
        >
          {props.age}
        </span>
      ) : null}
    </span>
  );
}

function RailStat(props: {
  icon: RailTopStatus["icon"];
  count: number;
  className: string;
  label: string;
}) {
  if (props.count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
        props.className,
      )}
    >
      <TopStatusIcon
        icon={props.icon}
        className={cn("size-3", props.icon === "working" && WORKING_ICON_MOTION)}
      />
      <span aria-hidden>{props.count}</span>
      <span className="sr-only">{props.label}</span>
    </span>
  );
}

/**
 * What a project's open threads are doing, in the classic icons and colors: what needs you
 * (with the icon of its most urgent kind), then failed, working, what runs in the background
 * (with the terminal icon its thread rows use) and done. Only counts above zero show, so a
 * quiet project shows nothing.
 */
function RailStats(props: {
  counts: RailCounts;
  topStatus: RailTopStatus | null;
  running: number;
}) {
  const { counts, topStatus } = props;
  const gt = useGT();
  const needsIcon =
    topStatus !== null &&
    counts.needs > 0 &&
    topStatus.icon !== "done" &&
    topStatus.icon !== "working"
      ? topStatus
      : null;
  return (
    <span className="flex items-center gap-2">
      {counts.needs > 0 ? (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            needsIcon?.className ?? "text-warning-foreground",
          )}
        >
          <TopStatusIcon icon={needsIcon?.icon ?? "input"} className="size-3" />
          <RailNeedsBadge count={counts.needs} />
        </span>
      ) : null}
      <RailStat
        icon="failed"
        count={counts.failed}
        className="text-error-foreground"
        label={gt("{count} failed", { count: counts.failed })}
      />
      <RailStat
        icon="working"
        count={counts.working}
        className="text-info-foreground"
        label={gt("{count} working", { count: counts.working })}
      />
      {props.running > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums text-info-foreground transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none">
          <SquareTerminalIcon aria-hidden className="size-3" />
          <span aria-hidden>{props.running}</span>
          <span className="sr-only">
            {gt(
              "{count, plural, one {{count} running in background} other {{count} running in background}}",
              { count: props.running },
            )}
          </span>
        </span>
      ) : null}
      <RailStat
        icon="done"
        count={counts.done}
        className="text-success-foreground"
        label={gt("{count} done", { count: counts.done })}
      />
    </span>
  );
}

const DOT_CLASS_NAME: Record<RailDotState, string> = {
  needs: "bg-warning",
  failed: "bg-destructive",
  working: "bg-info motion-safe:animate-pulse",
  done: "bg-success",
  quiet: "bg-sidebar-muted-foreground/35",
};

/** One small dot per open thread: amber needs you, red failed, blue working, green done. */
function RailStatusDots(props: { counts: RailCounts }) {
  const { dots, overflow } = railStatusDots(props.counts);
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-0.5">
      {dots.map((dot) => (
        <span key={dot.key} className={cn("size-1.5 rounded-full", DOT_CLASS_NAME[dot.state])} />
      ))}
      {overflow > 0 ? (
        <span className="ps-0.5 text-2xs leading-4 tabular-nums text-sidebar-muted-foreground/70">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A project row's name and detail line; the name keeps the star of a favorite. The detail line
 * shows each open thread's state as a dot; the time sits at the row's right edge.
 */
function RailRowText(props: {
  name: string;
  detail: string;
  counts: RailCounts | null;
  favorite?: boolean;
  /** No Project and All Projects: views above the project list, named in a heavier weight. */
  emphasized?: boolean;
}) {
  const gt = useGT();
  const open = props.counts?.open ?? 0;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn("min-w-0 truncate text-sm leading-5", props.emphasized && "font-medium")}
        >
          {props.name}
        </span>
        {props.favorite ? (
          <StarIcon
            role="img"
            aria-label={gt("Favorite")}
            className="size-3 shrink-0 fill-current text-sidebar-muted-foreground"
          />
        ) : null}
      </span>
      {open === 0 || props.counts === null ? (
        <span className="truncate text-2xs leading-4 text-sidebar-muted-foreground/70">
          {props.detail}
        </span>
      ) : (
        <span className="flex h-4 min-w-0 items-center gap-1.5">
          <span className="sr-only">{props.detail}</span>
          <RailStatusDots counts={props.counts} />
        </span>
      )}
    </span>
  );
}

const FOLDER_DOT_CLASS_NAME = {
  needs: "bg-warning",
  failed: "bg-error",
  done: "bg-success",
  working: "bg-info",
} as const;

/** The classic folder dot for a folded folder: needs you, failed, done, then working. */
function folderDot(counts: RailCounts): keyof typeof FOLDER_DOT_CLASS_NAME | null {
  if (counts.needs > 0) return "needs";
  if (counts.failed > 0) return "failed";
  if (counts.done > 0) return "done";
  if (counts.working > 0) return "working";
  return null;
}

function useRowMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  return {
    open,
    position,
    onOpenChange: (next: boolean) => {
      setOpen(next);
      if (!next) setPosition(null);
    },
    openAt: (event: ReactMouseEvent) => {
      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
      setOpen(true);
    },
  };
}

/** The ⋯ button and the right-click menu share one menu, anchored to the pointer for a right-click. */
function RowMenu(props: {
  menu: ReturnType<typeof useRowMenu>;
  label: string;
  restoreFocus: () => boolean;
  children: ReactNode;
}) {
  const { menu } = props;
  const anchor = menu.position
    ? { getBoundingClientRect: () => new DOMRect(menu.position!.x, menu.position!.y, 0, 0) }
    : undefined;
  return (
    <Menu open={menu.open} onOpenChange={menu.onOpenChange}>
      <MenuTrigger
        render={<Button variant="ghost-muted" size="icon-micro" aria-label={props.label} />}
      >
        <MoreHorizontalIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup
        anchor={anchor}
        align={menu.position ? "start" : "end"}
        side="bottom"
        sideOffset={menu.position ? 0 : 4}
        finalFocus={() => props.restoreFocus()}
      >
        {props.children}
      </MenuPopup>
    </Menu>
  );
}

/** Holds a row's ⋯ button, shown on hover, on focus, and while its menu is open. */
function RowMenuSlot(props: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 right-1.5 flex items-center opacity-0 group-hover/rail-item:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
        props.open && "opacity-100",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

function DropLine(props: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        props.edge === "top" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}

/** One rail row as drag and drop sees it: a drop target, and a drag source unless `drag` is null. */
function useRailDnd(row: RailDropRow, drag: RailDragItem | null, drop: RailDrop | null) {
  const rowKey = railDropRowKey(row);
  const droppable = useDroppable({ id: rowKey, data: row });
  const draggable = useDraggable({
    id: rowKey,
    disabled: drag === null,
    ...(drag === null ? {} : { data: drag }),
  });
  return {
    setNodeRef: (node: HTMLElement | null) => {
      droppable.setNodeRef(node);
      draggable.setNodeRef(node);
    },
    listeners: drag === null ? undefined : draggable.listeners,
    isDragging: draggable.isDragging,
    line: drop?.kind === "line" && drop.rowKey === rowKey ? drop.edge : null,
  };
}

export function RailProjectRow(props: {
  project: RailProject;
  favorite: boolean;
  /** False in the Favorites view, where the order shown is not the rail's own. */
  draggable?: boolean;
  folderId: string | null;
  /** The folder its menu shows selected, when the row is listed outside it (Favorites). */
  menuFolderId?: string | null;
  lastRowKey: string;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  folders: readonly RailFolderChoice[];
  drop: RailDrop | null;
  actions: RailRowActions;
  renaming?: boolean;
}) {
  const { project, folderId, actions } = props;
  const gt = useGT();
  const { group, counts } = project;
  const projectKey = group.projectKey;
  const menu = useRowMenu();
  const { setNodeRef, listeners, isDragging, line } = useRailDnd(
    { kind: "project", projectKey, folderId, lastRowKey: props.lastRowKey },
    props.draggable === false || props.renaming ? null : { kind: "project", projectKey },
    props.drop,
  );
  return (
    <li
      ref={setNodeRef}
      className={cn("group/rail-item relative list-none", isDragging && "opacity-40")}
    >
      {line ? <DropLine edge={line} /> : null}
      {props.renaming ? (
        <div
          className={cn(
            "flex h-11 items-center gap-2.5 pr-(--sidebar-row-content-inset)",
            folderId === null ? "pl-(--sidebar-row-content-inset)" : "pl-6",
          )}
        >
          <ProjectFavicon project={group} className="size-4 shrink-0" />
          <RailNameInput
            name={group.displayName}
            label={gt("Project name")}
            onDone={(name) => actions.finishProjectRename(projectKey, name)}
          />
        </div>
      ) : (
        <button
          type="button"
          {...listeners}
          aria-current={props.selected ? "true" : undefined}
          onClick={() => {
            if (!actions.suppressClick()) actions.openProject(projectKey);
          }}
          onContextMenu={menu.openAt}
          className={cn(
            railRowClassName(props.selected, 2),
            folderId === null ? "pl-(--sidebar-row-content-inset)" : "pl-6",
          )}
        >
          <ProjectFavicon project={group} className="size-4 shrink-0" />
          <RailRowText
            name={group.displayName}
            detail={project.detail}
            counts={project.counts}
            favorite={props.favorite}
          />
          <RailTrailing menuOpen={menu.open} age={project.age}>
            <RailStats counts={counts} topStatus={project.topStatus} running={project.running} />
          </RailTrailing>
        </button>
      )}
      {props.renaming ? null : (
        <RowMenuSlot open={menu.open}>
          <RowMenu
            menu={menu}
            label={gt("Actions for {name}", { name: group.displayName })}
            restoreFocus={actions.restoreMenuFocus}
          >
            <MenuItem onClick={() => actions.newThread(projectKey)}>
              <SquarePenIcon />
              <T>New Thread</T>
            </MenuItem>
            <MenuItem onClick={() => actions.startProjectRename(projectKey)}>
              <PencilIcon />
              <T>Rename</T>
            </MenuItem>
            <MenuItem onClick={() => actions.setFavorite(projectKey, !props.favorite)}>
              {props.favorite ? <StarOffIcon /> : <StarIcon />}
              {props.favorite ? gt("Remove from Favorites") : gt("Add to Favorites")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={!props.canMoveUp}
              onClick={() => actions.stepProject(projectKey, "up")}
            >
              <ArrowUpIcon />
              <T>Move Up</T>
            </MenuItem>
            <MenuItem
              disabled={!props.canMoveDown}
              onClick={() => actions.stepProject(projectKey, "down")}
            >
              <ArrowDownIcon />
              <T>Move Down</T>
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>
                <T context="menu group: the folder a project is in">Folder</T>
              </MenuGroupLabel>
              <MenuRadioGroup
                value={
                  (props.menuFolderId === undefined ? folderId : props.menuFolderId) ?? NO_FOLDER
                }
                onValueChange={(value: string) =>
                  actions.setProjectFolder(projectKey, value === NO_FOLDER ? null : value)
                }
              >
                {props.folders.map((folder) => (
                  <MenuRadioItem key={folder.folderId} value={folder.folderId} closeOnClick>
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate">{folder.name}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
                <MenuRadioItem value={NO_FOLDER} closeOnClick>
                  <span className="flex items-center justify-between gap-3">
                    <T>No Folder</T>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuItem onClick={() => actions.newFolder(projectKey)}>
              <FolderPlusIcon />
              <T>New Folder…</T>
            </MenuItem>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                <AlarmClockIcon />
                <T>Snooze Project</T>
              </MenuSubTrigger>
              <MenuSubPopup>
                <SnoozeProjectChoices
                  environmentId={group.environmentId}
                  onSnooze={(until) => actions.snoozeProject(projectKey, until)}
                />
              </MenuSubPopup>
            </MenuSub>
            <MenuItem onClick={() => actions.hideProject(projectKey)}>
              <EyeOffIcon />
              <T>Hide Project</T>
            </MenuItem>
          </RowMenu>
        </RowMenuSlot>
      )}
    </li>
  );
}

/**
 * The times a project can snooze until: the thread snooze choices, with "Until I wake it" first.
 * Rendered only while the submenu is open, so each opening reads a fresh time.
 */
function SnoozeProjectChoices(props: {
  environmentId: EnvironmentId;
  onSnooze: (until: string) => void;
}) {
  const messages = useMessages();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  // oxlint-disable-next-line react/purity -- Mounted only while the submenu is open; each opening reads the time anew.
  const presets = resolveSnoozePresets(new Date(), timestampFormat, props.environmentId, messages);
  return (
    <>
      {presets.map((preset) => (
        <MenuItem
          key={preset.id}
          onClick={() => {
            const picked = pickSnoozePreset(
              presets,
              preset.id,
              timestampFormat,
              props.environmentId,
            );
            if (picked) props.onSnooze(picked.snoozedUntil);
          }}
        >
          {preset.label}
          <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        onClick={async () => {
          const choice = await requestCustomSnooze("project");
          if (choice) props.onSnooze(choice.snoozedUntil);
        }}
      >
        <T>Custom…</T>
      </MenuItem>
    </>
  );
}

function RailNameInput(props: {
  name: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  // Created once: a new ref callback each render would select the text again while typing.
  const [focusOnMount] = useState(() => (node: HTMLInputElement | null) => {
    node?.focus();
    node?.select();
  });
  const [done, setDone] = useState(false);
  const finish = (name: string | null) => {
    if (done) return;
    setDone(true);
    props.onDone(name);
  };
  return (
    <input
      ref={focusOnMount}
      defaultValue={props.name}
      aria-label={props.label}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-sm font-semibold text-foreground outline-none"
    />
  );
}

export function RailFolderRow(props: {
  folderId: string;
  name: string;
  collapsed: boolean;
  projectCount: number;
  counts: RailCounts;
  lastRowKey: string;
  renaming: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  drop: RailDrop | null;
  actions: RailRowActions;
}) {
  const { folderId, actions } = props;
  const gt = useGT();
  const menu = useRowMenu();
  const { setNodeRef, listeners, isDragging, line } = useRailDnd(
    { kind: "folder", folderId, lastRowKey: props.lastRowKey },
    props.renaming ? null : { kind: "folder", folderId },
    props.drop,
  );
  const dropInto = props.drop?.kind === "into" && props.drop.folderId === folderId;
  const folded = props.collapsed;
  const dot = folderDot(props.counts);
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "group/rail-item relative mt-2 list-none first:mt-0",
        isDragging && "opacity-40",
      )}
    >
      {line ? <DropLine edge={line} /> : null}
      {props.renaming ? (
        <div className="flex h-8 items-center gap-2.5 px-(--sidebar-row-content-inset)">
          <FolderIcon aria-hidden className="size-4 shrink-0 text-(--sidebar-icon-color)" />
          <RailNameInput
            name={props.name}
            label={gt("Folder name")}
            onDone={(name) => actions.finishRename(folderId, name)}
          />
        </div>
      ) : (
        <button
          type="button"
          {...listeners}
          aria-expanded={!folded}
          onClick={() => {
            if (!actions.suppressClick()) actions.toggleFolder(folderId);
          }}
          onContextMenu={menu.openAt}
          className={cn(
            "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            dropInto && "bg-primary/10 ring-1 ring-inset ring-primary",
          )}
        >
          <FolderIcon aria-hidden className="size-4 shrink-0 text-(--sidebar-icon-color)" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
            {props.name}
          </span>
          {folded && dot ? (
            <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
              <span className="sr-only">
                , {summarizeRailFolder(props.projectCount, props.counts)}
              </span>
            </span>
          ) : null}
          {folded && props.projectCount > 0 ? (
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/rail-item:invisible group-focus-within/rail-item:invisible pointer-coarse:invisible",
                menu.open && "invisible",
              )}
            >
              {props.projectCount}
            </span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
              folded && "-rotate-90",
            )}
          />
        </button>
      )}
      {props.renaming ? null : (
        <RowMenuSlot open={menu.open} className="right-6">
          <RowMenu
            menu={menu}
            label={gt("Actions for {name}", { name: props.name })}
            restoreFocus={actions.restoreMenuFocus}
          >
            <MenuItem onClick={() => actions.startRename(folderId)}>
              <PencilIcon />
              <T>Rename</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={!props.canMoveUp}
              onClick={() => actions.stepFolder(folderId, "up")}
            >
              <ArrowUpIcon />
              <T>Move Up</T>
            </MenuItem>
            <MenuItem
              disabled={!props.canMoveDown}
              onClick={() => actions.stepFolder(folderId, "down")}
            >
              <ArrowDownIcon />
              <T>Move Down</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => actions.removeFolder(folderId)}>
              <FolderMinusIcon />
              <span className="flex flex-col">
                <T>Remove Folder</T>
                <span className="text-xs text-muted-foreground">
                  <T>Its projects stay in the list.</T>
                </span>
              </span>
            </MenuItem>
          </RowMenu>
        </RowMenuSlot>
      )}
    </li>
  );
}

export function RailEmptyFolderRow(props: { folderId: string; drop: RailDrop | null }) {
  const { setNodeRef, line } = useRailDnd(
    { kind: "empty", folderId: props.folderId },
    null,
    props.drop,
  );
  const dropInto = props.drop?.kind === "into" && props.drop.folderId === props.folderId;
  return (
    <li ref={setNodeRef} className="relative list-none">
      {line ? <DropLine edge={line} /> : null}
      <p
        className={cn(
          "my-0.5 ml-6 rounded-md border border-dashed border-sidebar-border px-3 py-1.5 text-xs text-sidebar-muted-foreground",
          dropInto && "border-primary bg-primary/10",
        )}
      >
        <T>No projects yet. Drag one here.</T>
      </p>
    </li>
  );
}

export function RailNoProjectRow(props: {
  project: RailProject | null;
  selected: boolean;
  position: NoProjectPosition;
  onOpen: () => void;
  onNewThread: () => void;
  onPositionChange: (position: NoProjectPosition) => void;
}) {
  const gt = useGT();
  const menu = useRowMenu();
  return (
    <div className="group/rail-item relative">
      <button
        type="button"
        aria-current={props.selected ? "true" : undefined}
        onClick={props.onOpen}
        onContextMenu={menu.openAt}
        className={cn(railRowClassName(props.selected, 2), "pl-(--sidebar-row-content-inset)")}
      >
        <NoProjectChip className="size-4 rounded-sm text-3xs" />
        <RailRowText
          name={gt("No Project")}
          detail={props.project?.detail ?? gt("No open threads")}
          counts={props.project?.counts ?? null}
          emphasized
        />
        <RailTrailing menuOpen={menu.open} age={props.project?.age ?? null}>
          {props.project ? (
            <RailStats
              counts={props.project.counts}
              topStatus={props.project.topStatus}
              running={props.project.running}
            />
          ) : null}
        </RailTrailing>
      </button>
      <RowMenuSlot open={menu.open}>
        <RowMenu menu={menu} label={gt("Actions for No Project")} restoreFocus={() => true}>
          <MenuItem onClick={props.onNewThread}>
            <SquarePenIcon />
            <T>New Thread</T>
          </MenuItem>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>
              <T>Always Show No Project</T>
            </MenuGroupLabel>
            <MenuRadioGroup
              value={props.position}
              onValueChange={(value: NoProjectPosition) => props.onPositionChange(value)}
            >
              <MenuRadioItem value="top" closeOnClick>
                <span className="flex items-center justify-between gap-3">
                  <T>At the Top</T>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
              <MenuRadioItem value="bottom" closeOnClick>
                <span className="flex items-center justify-between gap-3">
                  <T>At the Bottom</T>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </RowMenu>
      </RowMenuSlot>
    </div>
  );
}

/** The rail's first row while the thread column shows: every project's threads in the column. */
export function RailAllProjectsRow(props: {
  counts: RailCounts;
  running: number;
  detail: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onOpen}
      className={cn(railRowClassName(props.selected, 2), "pl-(--sidebar-row-content-inset)")}
    >
      <span
        aria-hidden
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"
      >
        <LayoutGridIcon className="size-2.5" />
      </span>
      <RailRowText
        name={gt("All Projects")}
        detail={props.detail}
        counts={props.counts}
        emphasized
      />
      <span className="flex shrink-0 items-center gap-1.5">
        <RailStats counts={props.counts} topStatus={null} running={props.running} />
      </span>
    </button>
  );
}
