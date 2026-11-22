/**
 * The phone's project drawer as the desktop project rail: the shared order, folders,
 * favorites, hidden and snoozed projects (`ServerSettings.projectRail`), and the menu actions
 * that change them. Only this file reads the shared rail module, so its names live in one place.
 */
import {
  activeSnoozedProjectKeys,
  addRailProjectKey,
  buildRailEntries,
  createRailFolder,
  isEmptySharedProjectRail,
  localProjectRailFromShared,
  materializeRailLayout,
  moveRailFolder,
  moveRailProject,
  nextProjectRailEditTime,
  railFolderEntry,
  railProjectEntry,
  railStepPlacement,
  removeRailFolder,
  removeRailProjectKey,
  renameRailFolder,
  sameSharedProjectRail,
  sharedProjectRailContentFromLocal,
  type LocalProjectRail,
  type RailRowEntry,
  type SharedProjectRail,
} from "@t3tools/client-runtime/state/project-rail";

import type { ProjectSwitcherRow } from "./project-switcher";

export type { SharedProjectRail };

/**
 * "Until I wake it": a wake time so far ahead it never arrives, the value the desktop writes
 * (`INDEFINITE_SNOOZE_UNTIL` in apps/web), so both read the other's open-ended snoozes.
 */
export const INDEFINITE_PROJECT_SNOOZE_UNTIL = "9999-12-31T23:59:59.000Z";
const INDEFINITE_FROM_MS = Date.UTC(9000, 0, 1);

export function isIndefiniteProjectSnooze(until: string): boolean {
  return Date.parse(until) >= INDEFINITE_FROM_MS;
}

export type ProjectDrawerItem =
  | {
      readonly kind: "folder";
      readonly folderId: string;
      readonly name: string;
      /** Folded on this device. */
      readonly collapsed: boolean;
      readonly projectCount: number;
      readonly waitingCount: number;
      readonly canMoveUp: boolean;
      readonly canMoveDown: boolean;
    }
  | {
      readonly kind: "project";
      readonly row: ProjectSwitcherRow & { readonly key: string };
      readonly folderId: string | null;
      readonly favorite: boolean;
      readonly canMoveUp: boolean;
      readonly canMoveDown: boolean;
    };

export interface ProjectDrawerModel {
  /** False without a shared rail: the recent-order list, and no layout actions. */
  readonly shared: boolean;
  /** No Project, then All Projects. */
  readonly fixed: ReadonlyArray<ProjectSwitcherRow>;
  /** The rail in order: folders with their projects after them, and loose projects. */
  readonly items: ReadonlyArray<ProjectDrawerItem>;
  readonly folders: ReadonlyArray<{ readonly folderId: string; readonly name: string }>;
  readonly hidden: ReadonlyArray<ProjectSwitcherRow & { readonly key: string }>;
  readonly snoozed: ReadonlyArray<{
    readonly row: ProjectSwitcherRow & { readonly key: string };
    readonly until: string;
  }>;
}

type KeyedRow = ProjectSwitcherRow & { readonly key: string };

function keyed(row: ProjectSwitcherRow): row is KeyedRow {
  return row.key !== null;
}

/**
 * The drawer from the switcher rows. With a shared rail the projects follow its order and
 * folders, and hidden and snoozed ones leave the list but keep their place; without one, the
 * projects stay in recent order. Layout keys with no project here are skipped, and projects
 * missing from the layout go last, as on desktop.
 */
export function buildProjectDrawerModel(input: {
  readonly rows: {
    readonly fixed: ReadonlyArray<ProjectSwitcherRow>;
    readonly recent: ReadonlyArray<ProjectSwitcherRow>;
  };
  readonly rail: SharedProjectRail | null;
  readonly collapsedFolders: ReadonlySet<string>;
  readonly nowMs: number;
}): ProjectDrawerModel {
  const projectRows = input.rows.recent.filter(keyed);
  if (input.rail === null) {
    return {
      shared: false,
      fixed: input.rows.fixed,
      items: projectRows.map((row) => ({
        kind: "project",
        row,
        folderId: null,
        favorite: false,
        canMoveUp: false,
        canMoveDown: false,
      })),
      folders: [],
      hidden: [],
      snoozed: [],
    };
  }
  const rail = input.rail;
  const rowByKey = new Map(projectRows.map((row) => [row.key, row]));
  const knownKeys = projectRows.map((row) => row.key);
  const snoozedKeys = activeSnoozedProjectKeys(rail.snoozedProjects, input.nowMs);
  const entries = buildRailEntries(localProjectRailFromShared(rail).layout, knownKeys, [
    ...rail.hiddenProjects,
    ...snoozedKeys,
  ]);
  const favorites = new Set(rail.favoriteProjects);
  const items: ProjectDrawerItem[] = [];
  entries.forEach((entry, index) => {
    const canMoveUp = index > 0;
    const canMoveDown = index < entries.length - 1;
    if (entry.kind === "project") {
      const row = rowByKey.get(entry.projectKey);
      if (!row) return;
      items.push({
        kind: "project",
        row,
        folderId: null,
        favorite: favorites.has(entry.projectKey),
        canMoveUp,
        canMoveDown,
      });
      return;
    }
    const rows = entry.projectKeys.flatMap((key) => rowByKey.get(key) ?? []);
    items.push({
      kind: "folder",
      folderId: entry.folderId,
      name: entry.name,
      collapsed: input.collapsedFolders.has(entry.folderId),
      projectCount: rows.length,
      waitingCount: rows.reduce((sum, row) => sum + row.waitingCount, 0),
      canMoveUp,
      canMoveDown,
    });
    rows.forEach((row, position) => {
      items.push({
        kind: "project",
        row,
        folderId: entry.folderId,
        favorite: favorites.has(row.key),
        canMoveUp: position > 0,
        canMoveDown: position < rows.length - 1,
      });
    });
  });
  return {
    shared: true,
    fixed: input.rows.fixed,
    items,
    folders: entries.flatMap((entry) =>
      entry.kind === "folder" ? [{ folderId: entry.folderId, name: entry.name }] : [],
    ),
    hidden: rail.hiddenProjects.flatMap((key) => rowByKey.get(key) ?? []),
    snoozed: [...snoozedKeys].flatMap((key) => {
      const row = rowByKey.get(key);
      const until = rail.snoozedProjects[key];
      return row && until ? [{ row, until }] : [];
    }),
  };
}

/**
 * The items the list shows. Without a query a folded folder hides its projects. A query
 * matches project names across folders and keeps each match's folder name above it.
 */
export function visibleProjectDrawerItems(
  items: ReadonlyArray<ProjectDrawerItem>,
  query: string,
): ProjectDrawerItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") {
    const folded = new Set(
      items.flatMap((item) => (item.kind === "folder" && item.collapsed ? [item.folderId] : [])),
    );
    return items.filter(
      (item) => item.kind === "folder" || item.folderId === null || !folded.has(item.folderId),
    );
  }
  const matches = (item: ProjectDrawerItem) =>
    item.kind === "project" && item.row.title.toLocaleLowerCase().includes(needle);
  const foldersWithMatches = new Set(
    items.flatMap((item) => (matches(item) && item.kind === "project" ? [item.folderId] : [])),
  );
  return items.filter((item) =>
    item.kind === "folder" ? foldersWithMatches.has(item.folderId) : matches(item),
  );
}

/** What a change needs to know about the phone: its projects, and the time. */
export interface ProjectRailChangeContext {
  /** Every project key the drawer knows, without No Project, in recent order. */
  readonly knownProjectKeys: ReadonlyArray<string>;
  readonly nowMs: number;
}

export type ProjectRailChange =
  | {
      readonly kind: "step-project";
      readonly projectKey: string;
      readonly direction: "up" | "down";
    }
  | {
      readonly kind: "set-folder";
      readonly projectKey: string;
      readonly folderId: string | null;
    }
  | {
      readonly kind: "new-folder";
      readonly folderId: string;
      readonly name: string;
      readonly projectKey?: string;
    }
  | { readonly kind: "rename-folder"; readonly folderId: string; readonly name: string }
  | { readonly kind: "remove-folder"; readonly folderId: string }
  | { readonly kind: "step-folder"; readonly folderId: string; readonly direction: "up" | "down" }
  | { readonly kind: "favorite"; readonly projectKey: string; readonly favorite: boolean }
  | { readonly kind: "hide"; readonly projectKey: string }
  | { readonly kind: "show"; readonly projectKey: string }
  | { readonly kind: "snooze"; readonly projectKey: string; readonly until: string }
  | { readonly kind: "wake"; readonly projectKey: string };

function railEntries(local: LocalProjectRail, context: ProjectRailChangeContext): RailRowEntry[] {
  return buildRailEntries(local.layout, context.knownProjectKeys, [
    ...local.hiddenProjects,
    ...activeSnoozedProjectKeys(local.snoozedProjects, context.nowMs),
  ]);
}

function entryId(entry: RailRowEntry): string {
  return entry.kind === "project"
    ? railProjectEntry(entry.projectKey)
    : railFolderEntry(entry.folderId);
}

function folderOf(entries: ReadonlyArray<RailRowEntry>, projectKey: string) {
  return (
    entries.find(
      (entry): entry is Extract<RailRowEntry, { kind: "folder" }> =>
        entry.kind === "folder" && entry.projectKeys.includes(projectKey),
    ) ?? null
  );
}

/** One change on the device's rail, by the desktop rail's rules (`ProjectRail.tsx` actions). */
export function applyProjectRailChange(
  local: LocalProjectRail,
  change: ProjectRailChange,
  context: ProjectRailChangeContext,
): LocalProjectRail {
  const withLayout = (layout: LocalProjectRail["layout"]) =>
    layout === local.layout ? local : { ...local, layout };
  switch (change.kind) {
    case "step-project": {
      const entries = railEntries(local, context);
      const folder = folderOf(entries, change.projectKey);
      const placement =
        folder === null
          ? railStepPlacement(
              entries.map(entryId),
              railProjectEntry(change.projectKey),
              null,
              change.direction,
            )
          : railStepPlacement(
              folder.projectKeys,
              change.projectKey,
              folder.folderId,
              change.direction,
            );
      return placement
        ? withLayout(moveRailProject(local.layout, change.projectKey, placement))
        : local;
    }
    case "set-folder": {
      const current = folderOf(railEntries(local, context), change.projectKey)?.folderId ?? null;
      if (current === change.folderId) return local;
      return withLayout(
        moveRailProject(
          local.layout,
          change.projectKey,
          change.folderId !== null
            ? { folderId: change.folderId, anchor: null }
            : { folderId: null, anchor: { item: railFolderEntry(current!), side: "after" } },
        ),
      );
    }
    case "new-folder":
      return withLayout(
        createRailFolder(local.layout, {
          folderId: change.folderId,
          name: change.name,
          ...(change.projectKey === undefined ? {} : { projectKey: change.projectKey }),
        }),
      );
    case "rename-folder":
      return withLayout(renameRailFolder(local.layout, change.folderId, change.name));
    case "remove-folder":
      return withLayout(removeRailFolder(local.layout, change.folderId));
    case "step-folder": {
      const placement = railStepPlacement(
        railEntries(local, context).map(entryId),
        railFolderEntry(change.folderId),
        null,
        change.direction,
      );
      return placement
        ? withLayout(moveRailFolder(local.layout, change.folderId, placement.anchor))
        : local;
    }
    case "favorite": {
      const favoriteProjects = change.favorite
        ? addRailProjectKey(local.favoriteProjects, change.projectKey)
        : removeRailProjectKey(local.favoriteProjects, change.projectKey);
      return favoriteProjects === local.favoriteProjects ? local : { ...local, favoriteProjects };
    }
    case "hide": {
      const hiddenProjects = addRailProjectKey(local.hiddenProjects, change.projectKey);
      return hiddenProjects === local.hiddenProjects ? local : { ...local, hiddenProjects };
    }
    case "show": {
      const hiddenProjects = removeRailProjectKey(local.hiddenProjects, change.projectKey);
      return hiddenProjects === local.hiddenProjects ? local : { ...local, hiddenProjects };
    }
    case "snooze":
      return {
        ...local,
        snoozedProjects: { ...local.snoozedProjects, [change.projectKey]: change.until },
      };
    case "wake": {
      if (!(change.projectKey in local.snoozedProjects)) return local;
      const { [change.projectKey]: _woken, ...snoozedProjects } = local.snoozedProjects;
      return { ...local, snoozedProjects };
    }
  }
}

/**
 * The value to send for a change: the whole rail, with every known project placed as desktop
 * places it before a change, stamped later than the value it replaces so last write wins.
 * Null when the change leaves the rail as it was.
 */
export function editSharedProjectRail(
  shared: SharedProjectRail,
  change: ProjectRailChange,
  context: ProjectRailChangeContext,
): SharedProjectRail | null {
  const local = localProjectRailFromShared(shared);
  const placed = {
    ...local,
    layout: materializeRailLayout(local.layout, context.knownProjectKeys),
  };
  const changed = applyProjectRailChange(placed, change, context);
  if (changed === placed) return null;
  const next = sharedProjectRailContentFromLocal(changed);
  if (sameSharedProjectRail(next, shared)) return null;
  return { ...next, updatedAt: nextProjectRailEditTime(context.nowMs, shared.updatedAt) };
}

/**
 * The rail the drawer shows while a write is on its way: the edit, until the server's value
 * changes from the one the edit was made on (the server now holds this edit, or a newer one).
 */
export function effectiveProjectRail(
  server: SharedProjectRail | null,
  pending: { readonly base: string | null; readonly rail: SharedProjectRail } | null,
): SharedProjectRail | null {
  if (pending === null) return server;
  return (server?.updatedAt ?? null) === pending.base ? pending.rail : server;
}

/**
 * Projects to bring back after a message was sent in them: the hidden or snoozed ones, as
 * desktop does on send. Keys are project scope keys.
 */
export function projectsToBringBack(
  rail: SharedProjectRail,
  sentProjectKeys: ReadonlyArray<string>,
): ProjectRailChange[] {
  return [...new Set(sentProjectKeys)].flatMap((projectKey): ProjectRailChange[] => [
    ...(rail.hiddenProjects.includes(projectKey) ? [{ kind: "show" as const, projectKey }] : []),
    ...(projectKey in rail.snoozedProjects ? [{ kind: "wake" as const, projectKey }] : []),
  ]);
}

/** One environment's shared rail, as its settings hold it. */
export interface EnvironmentProjectRail<Id extends string = string> {
  readonly environmentId: Id;
  readonly rail: SharedProjectRail;
}

/**
 * The rail the drawer reads and writes: the primary environment's, the first in the catalog's
 * order whose settings hold a seeded rail. The rail lives only there, as on desktop, so every
 * change (order, folders, favorites, hidden and snoozed) writes to it. A missing or empty rail
 * is not seeded yet: the drawer keeps its recent list and writes nothing over it.
 */
export function primaryProjectRail<Id extends string>(
  rails: ReadonlyArray<{
    readonly environmentId: Id;
    readonly rail: SharedProjectRail | undefined;
  }>,
): EnvironmentProjectRail<Id> | null {
  for (const { environmentId, rail } of rails) {
    if (rail && !isEmptySharedProjectRail(rail)) return { environmentId, rail };
  }
  return null;
}
