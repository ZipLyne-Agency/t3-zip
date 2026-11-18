import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../../types";
import {
  filterSidebarV2VisibleThreads,
  type resolveSidebarRowStatus,
  sortPinnedThreadsForSidebar,
} from "../Sidebar.logic";
import {
  buildRailEntries,
  type NoProjectPosition,
  type RailLayoutState,
  railProjectOrder,
} from "../rail/railLayout.logic";
import { isRailOpenThread, type OpenThreadStatus } from "../rail/railStatus.logic";
import type { SidebarTopStatusIcon } from "../sidebar/SidebarThreadRow";
import type { ActiveMute } from "./threadMute.logic";

export function threadTabKey(thread: Pick<SidebarThreadSummary, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function projectMemberKey(thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">) {
  return `${thread.environmentId}:${thread.projectId}`;
}

/**
 * Open threads, by the rail's rule (the sidebar's open/settled split): listed (not archived
 * and not shown under a parent), in one of the given projects, and neither snoozed nor
 * settled once the environment's config has loaded.
 */
export function selectOpenThreads<T extends SidebarThreadSummary>(input: {
  readonly threads: ReadonlyArray<T>;
  /** `${environmentId}:${projectId}` keys; null means every project. */
  readonly projectKeys: ReadonlySet<string> | null;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly loadedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly nowIso: string;
}): T[] {
  return filterSidebarV2VisibleThreads(
    input.threads,
    input.projectKeys,
    input.delegatedUnderParent,
  ).filter((thread) =>
    isRailOpenThread(thread, {
      nowIso: input.nowIso,
      configLoaded: input.loadedEnvironmentIds.has(thread.environmentId),
    }),
  );
}

/**
 * Tab order: pinned threads first, in their pin order, then the rest newest first. Neither key
 * changes when a thread's status does, so tabs never move on their own; a new thread opens
 * right after the pinned ones.
 */
export function orderThreadTabs<T extends SidebarThreadSummary>(
  threads: ReadonlyArray<T>,
): { readonly tabs: T[]; readonly pinnedCount: number } {
  const pinned = sortPinnedThreadsForSidebar(threads.filter((thread) => thread.pinnedAt != null));
  const rest = threads
    .filter((thread) => thread.pinnedAt == null)
    .toSorted((left, right) => {
      const byCreated = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated;
      return threadTabKey(left) < threadTabKey(right) ? -1 : 1;
    });
  return { tabs: [...pinned, ...rest], pinnedCount: pinned.length };
}

export type ThreadTabStatus = OpenThreadStatus;

/** A slow turn on a working thread's icon, so live work reads as moving. Off for reduced motion. */
export const WORKING_ICON_MOTION = "motion-safe:animate-[spin_3s_linear_infinite]";

export interface ThreadTabIcon {
  readonly icon: SidebarTopStatusIcon;
  readonly className: string;
  readonly label: string;
}

/**
 * The icon a tab shows: the same icon and color the sidebar's thread row shows for the status,
 * or null when the row shows none (the tab then shows a quiet dot). A muted thread shows no Done.
 */
export function resolveThreadTabIcon(
  rowStatus: ReturnType<typeof resolveSidebarRowStatus>,
  status: ThreadTabStatus,
  resolve: MessageResolver = m,
): ThreadTabIcon | null {
  const icon = rowStatusIcon(rowStatus, status, resolve);
  return icon !== null && status === "working"
    ? { ...icon, className: `${icon.className} ${WORKING_ICON_MOTION}` }
    : icon;
}

function rowStatusIcon(
  rowStatus: ReturnType<typeof resolveSidebarRowStatus>,
  status: ThreadTabStatus,
  resolve: MessageResolver,
): ThreadTabIcon | null {
  switch (rowStatus) {
    case "preparing":
      return {
        icon: "working",
        className: "text-info-foreground",
        label: resolve(msg("Setting up", { $context: "thread status label" })),
      };
    case "working":
      return {
        icon: "working",
        className: "text-info-foreground",
        label: resolve(msg("Working", { $context: "thread status label" })),
      };
    case "waiting":
      // Waiting on its own subagents or a child thread is still work: it reads as Working, so
      // it never says Waiting in the Working list, where Waiting means waiting for you.
      return status === "working"
        ? {
            icon: "waiting",
            className: "text-info-foreground",
            label: resolve(msg("Working", { $context: "thread status label" })),
          }
        : {
            icon: "waiting",
            className: "text-muted-foreground",
            label: resolve(msg("Waiting", { $context: "thread status label" })),
          };
    case "approval":
      return {
        icon: "approval",
        className: "text-warning-foreground",
        label: resolve(msg("Approval", { $context: "thread status label" })),
      };
    case "input":
      return {
        icon: "input",
        className: "text-indigo-600 dark:text-indigo-300",
        label: resolve(msg("Input", { $context: "thread status label" })),
      };
    case "request":
      return {
        icon: "request",
        className: "text-guest-foreground",
        label: resolve(msg("Request", { $context: "thread status label" })),
      };
    case "limited":
      return {
        icon: "failed",
        className: "text-warning-foreground",
        label: resolve(msg("Limited", { $context: "thread status label" })),
      };
    case "failed":
      return {
        icon: "failed",
        className: "text-error-foreground",
        label: resolve(msg("Failed", { $context: "thread status label" })),
      };
    case "ready":
      return status === "done"
        ? {
            icon: "done",
            className: "text-success-foreground",
            label: resolve(msg("Done", { $context: "thread status label" })),
          }
        : null;
  }
}

/** A rename as typed: an empty or unchanged title keeps the old one. */
export function resolveTabRename(
  typed: string,
  original: string,
): { readonly save: false } | { readonly save: true; readonly title: string } {
  const title = typed.trim();
  return title.length === 0 || title === original ? { save: false } : { save: true, title };
}

export interface DraftTabSource {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly createdAt: string;
  readonly promoted: boolean;
  readonly hasContent: boolean;
  readonly title: string;
}

/**
 * New-thread drafts shown as tabs, newest first: unsent drafts with content in the given
 * projects, as the sidebar lists them, plus the draft that is open now even while empty.
 */
export function selectDraftTabs<T extends DraftTabSource>(
  drafts: ReadonlyArray<T>,
  projectKeys: ReadonlySet<string>,
  routeDraftId: string | null,
): T[] {
  return drafts
    .filter(
      (draft) =>
        !draft.promoted &&
        projectKeys.has(`${draft.environmentId}:${draft.projectId}`) &&
        (draft.hasContent || draft.draftId === routeDraftId),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** A draft tab's title: the prompt's first line, else its attachment count, else New Thread. */
export function draftTabTitle(
  promptText: string,
  attachmentCount: number,
  resolve: MessageResolver = m,
): string {
  const firstLine = promptText.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length > 0) return firstLine;
  if (attachmentCount > 0) {
    return resolve(
      msg("{count, plural, one {{count} Attachment} other {{count} Attachments}}", {
        count: attachmentCount,
      }),
    );
  }
  return resolve(msg("New Thread"));
}

export interface ThreadTabView {
  readonly key: string;
  readonly title: string;
  readonly status: ThreadTabStatus;
  readonly mute: ActiveMute;
}

const ALL_TABS_GROUPS = [
  { id: "needs", label: msg("Needs You", { $context: "tab group heading" }) },
  { id: "failed", label: msg("Failed", { $context: "tab group heading" }) },
  { id: "working", label: msg("Working", { $context: "tab group heading" }) },
  { id: "done", label: msg("Done", { $context: "tab group heading" }) },
  { id: "idle", label: msg("Idle", { $context: "tab group heading" }) },
  { id: "muted", label: msg("Muted", { $context: "tab group heading" }) },
] as const;
type AllTabsGroupId = (typeof ALL_TABS_GROUPS)[number]["id"];
export type AllTabsGroupLabel = string;

function groupOf(tab: ThreadTabView): AllTabsGroupId {
  // A muted thread that needs you or failed still shows there; nothing about it pings you.
  if (tab.status === "needs") return "needs";
  if (tab.status === "failed") return "failed";
  if (tab.mute !== null) return "muted";
  if (tab.status === "working") return "working";
  if (tab.status === "done") return "done";
  return "idle";
}

/** Whether every word of the query appears in the title, ignoring case. */
function matchesTabQuery(title: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = title.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The All Tabs list: what needs you first, muted threads last with the soonest to return first.
 * Each group keeps tab order, and empty groups are left out.
 */
export function groupAllTabs<T extends ThreadTabView>(
  tabs: ReadonlyArray<T>,
  query: string,
  resolve: MessageResolver = m,
): ReadonlyArray<{ readonly label: AllTabsGroupLabel; readonly items: ReadonlyArray<T> }> {
  const matching = tabs.filter((tab) => matchesTabQuery(tab.title, query));
  return ALL_TABS_GROUPS.flatMap(({ id, label: message }) => {
    const label = resolve(message);
    const items = matching.filter((tab) => groupOf(tab) === id);
    if (id === "muted") {
      const end = (tab: T) => tab.mute?.until ?? Number.POSITIVE_INFINITY;
      items.sort((left, right) => end(left) - end(right));
    }
    return items.length === 0 ? [] : [{ label, items }];
  });
}

/**
 * The next thread that needs you after the current one, in the order given (projects in rail
 * order, tabs in tab order), wrapping around. Null when none needs you, or only the current one.
 */
export function nextNeedsYouKey(
  orderedKeys: ReadonlyArray<string>,
  needsYou: ReadonlySet<string>,
  currentKey: string | null,
): string | null {
  const start = currentKey === null ? -1 : orderedKeys.indexOf(currentKey);
  for (let step = 1; step <= orderedKeys.length; step += 1) {
    const key = orderedKeys[(start + step + orderedKeys.length) % orderedKeys.length]!;
    if (needsYou.has(key) && key !== currentKey) return key;
  }
  return null;
}

/** The tab ⌃Tab-style traversal lands on, wrapping; null with no tabs. */
export function adjacentTabKey(
  keys: ReadonlyArray<string>,
  currentKey: string | null,
  direction: "previous" | "next",
): string | null {
  if (keys.length === 0) return null;
  const index = currentKey === null ? -1 : keys.indexOf(currentKey);
  if (index === -1) return direction === "next" ? keys[0]! : keys.at(-1)!;
  const step = direction === "next" ? 1 : -1;
  return keys[(index + step + keys.length) % keys.length]!;
}

/** Where to go when the open tab closes: the tab after it, else the one before. */
export function tabAfterClose(keys: ReadonlyArray<string>, closingKey: string): string | null {
  const index = keys.indexOf(closingKey);
  if (index === -1) return null;
  return keys[index + 1] ?? keys[index - 1] ?? null;
}

/** The `${environmentId}:${projectId}` keys of a project group, as `selectOpenThreads` takes them. */
export function groupMemberKeys(group: Pick<SidebarProjectSnapshot, "memberProjectRefs">) {
  return new Set(group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`));
}

/** The project group a thread belongs to, as the rail groups projects. */
export function findThreadGroup<G extends Pick<SidebarProjectSnapshot, "memberProjectRefs">>(
  groups: ReadonlyArray<G>,
  thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">,
): G | null {
  const memberKey = projectMemberKey(thread);
  return groups.find((group) => groupMemberKeys(group).has(memberKey)) ?? null;
}

/**
 * Project groups in the order the rail shows them: the stored rail layout, with No Project at
 * the rail's chosen end. Groups the rail does not list yet go after the listed ones.
 */
export function orderGroupsByRail<
  G extends Pick<SidebarProjectSnapshot, "projectKey" | "isScratch">,
>(groups: ReadonlyArray<G>, layout: RailLayoutState, noProjectPosition: NoProjectPosition): G[] {
  const projects = groups.filter((group) => !group.isScratch);
  const scratch = groups.filter((group) => group.isScratch);
  const order = railProjectOrder(
    buildRailEntries(
      layout,
      projects.map((group) => group.projectKey),
    ),
  );
  const rank = new Map(order.map((key, index) => [key, index]));
  const ordered = projects.toSorted(
    (left, right) =>
      (rank.get(left.projectKey) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.projectKey) ?? Number.MAX_SAFE_INTEGER),
  );
  return noProjectPosition === "top" ? [...scratch, ...ordered] : [...ordered, ...scratch];
}
