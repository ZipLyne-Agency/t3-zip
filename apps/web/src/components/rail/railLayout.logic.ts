/**
 * The project rail's own order: top-level entries hold folders and loose projects, and a
 * folder holds projects. Folders are one level deep. Projects are keyed by their sidebar
 * project group key, so grouping settings decide what one rail row is.
 */

export interface RailFolder {
  readonly name: string;
  readonly collapsed: boolean;
  readonly projects: readonly string[];
}

export interface RailLayoutState {
  /** `p:<projectKey>` and `f:<folderId>` entries, in rail order. */
  readonly top: readonly string[];
  readonly folders: Readonly<Record<string, RailFolder>>;
}

export type NoProjectPosition = "top" | "bottom";

export const EMPTY_RAIL_LAYOUT: RailLayoutState = { top: [], folders: {} };

const PROJECT_PREFIX = "p:";
const FOLDER_PREFIX = "f:";

export const railProjectEntry = (projectKey: string) => `${PROJECT_PREFIX}${projectKey}`;
export const railFolderEntry = (folderId: string) => `${FOLDER_PREFIX}${folderId}`;
const isRailFolderEntry = (entry: string) => entry.startsWith(FOLDER_PREFIX);
const railEntryId = (entry: string) => entry.slice(2);

/**
 * Where an entry lands. `folderId: null` is the top level. Items are the entries of that
 * container: `p:`/`f:` entries at the top level, bare project keys inside a folder. A missing
 * anchor, or `anchor: null`, places the entry at the end.
 */
export interface RailPlacement {
  readonly folderId: string | null;
  readonly anchor: { readonly item: string; readonly side: "before" | "after" } | null;
}

function itemsOf(state: RailLayoutState, folderId: string | null): readonly string[] {
  if (folderId === null) return state.top;
  return state.folders[folderId]?.projects ?? [];
}

function withItems(
  state: RailLayoutState,
  folderId: string | null,
  items: readonly string[],
): RailLayoutState {
  if (folderId === null) return { ...state, top: items };
  const folder = state.folders[folderId];
  if (!folder) return state;
  return { ...state, folders: { ...state.folders, [folderId]: { ...folder, projects: items } } };
}

function insertAt(
  items: readonly string[],
  item: string,
  anchor: RailPlacement["anchor"],
): string[] {
  const next = items.filter((candidate) => candidate !== item);
  const anchorIndex = anchor ? next.indexOf(anchor.item) : -1;
  if (anchorIndex < 0) return [...next, item];
  next.splice(anchor!.side === "before" ? anchorIndex : anchorIndex + 1, 0, item);
  return next;
}

/** The folder holding a project, or null when it sits at the top level or nowhere. */
function railFolderOf(state: RailLayoutState, projectKey: string): string | null {
  for (const [folderId, folder] of Object.entries(state.folders)) {
    if (folder.projects.includes(projectKey)) return folderId;
  }
  return null;
}

function withoutProject(state: RailLayoutState, projectKey: string): RailLayoutState {
  const entry = railProjectEntry(projectKey);
  const folders: Record<string, RailFolder> = {};
  for (const [folderId, folder] of Object.entries(state.folders)) {
    folders[folderId] = folder.projects.includes(projectKey)
      ? { ...folder, projects: folder.projects.filter((key) => key !== projectKey) }
      : folder;
  }
  return { top: state.top.filter((candidate) => candidate !== entry), folders };
}

/**
 * Places every known project the stored order does not hold yet at the end of the top level,
 * in the order given, and drops duplicate or dangling entries. Projects that are not known
 * right now (a disconnected environment) keep their place.
 */
export function materializeRailLayout(
  state: RailLayoutState,
  knownProjectKeys: readonly string[],
): RailLayoutState {
  const placed = new Set<string>();
  const folders: Record<string, RailFolder> = {};
  const top: string[] = [];
  for (const entry of state.top) {
    if (isRailFolderEntry(entry)) {
      const folderId = railEntryId(entry);
      const folder = state.folders[folderId];
      if (!folder || folders[folderId]) continue;
      const projects = folder.projects.filter((key) => !placed.has(key));
      for (const key of projects) placed.add(key);
      folders[folderId] =
        projects.length === folder.projects.length ? folder : { ...folder, projects };
      top.push(entry);
      continue;
    }
    const projectKey = railEntryId(entry);
    if (placed.has(projectKey)) continue;
    placed.add(projectKey);
    top.push(entry);
  }
  for (const key of knownProjectKeys) {
    if (placed.has(key)) continue;
    placed.add(key);
    top.push(railProjectEntry(key));
  }
  return { top, folders };
}

export type RailRowEntry =
  | { readonly kind: "project"; readonly projectKey: string }
  | {
      readonly kind: "folder";
      readonly folderId: string;
      readonly name: string;
      readonly collapsed: boolean;
      readonly projectKeys: readonly string[];
    };

/** What the rail shows: the stored order with new projects appended and unknown ones hidden. */
/**
 * The rows the rail shows. Hidden projects keep their place in the layout and are only left
 * out here, so showing one again puts it back in the same folder and position.
 */
export function buildRailEntries(
  state: RailLayoutState,
  knownProjectKeys: readonly string[],
  hiddenProjectKeys: readonly string[] = [],
): RailRowEntry[] {
  const hidden = new Set(hiddenProjectKeys);
  const known = new Set(knownProjectKeys.filter((key) => !hidden.has(key)));
  const layout = materializeRailLayout(state, knownProjectKeys);
  return layout.top.flatMap((entry): RailRowEntry[] => {
    if (isRailFolderEntry(entry)) {
      const folderId = railEntryId(entry);
      const folder = layout.folders[folderId]!;
      return [
        {
          kind: "folder",
          folderId,
          name: folder.name,
          collapsed: folder.collapsed,
          projectKeys: folder.projects.filter((key) => known.has(key)),
        },
      ];
    }
    const projectKey = railEntryId(entry);
    return known.has(projectKey) ? [{ kind: "project", projectKey }] : [];
  });
}

/** Project keys in the order the rail shows them, folded folders included. */
export function railProjectOrder(entries: readonly RailRowEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "project" ? [entry.projectKey] : entry.projectKeys,
  );
}

export function moveRailProject(
  state: RailLayoutState,
  projectKey: string,
  placement: RailPlacement,
): RailLayoutState {
  if (placement.folderId !== null && !state.folders[placement.folderId]) return state;
  const item = placement.folderId === null ? railProjectEntry(projectKey) : projectKey;
  if (placement.anchor?.item === item) return state;
  const removed = withoutProject(state, projectKey);
  return withItems(
    removed,
    placement.folderId,
    insertAt(itemsOf(removed, placement.folderId), item, placement.anchor),
  );
}

/** Folders only live at the top level, so the anchor is a top-level entry. */
export function moveRailFolder(
  state: RailLayoutState,
  folderId: string,
  anchor: RailPlacement["anchor"],
): RailLayoutState {
  const entry = railFolderEntry(folderId);
  if (!state.top.includes(entry) || anchor?.item === entry) return state;
  return { ...state, top: insertAt(state.top, entry, anchor) };
}

/**
 * A new folder. Alone it goes to the top of the list. Made from a project, it takes the
 * project's place and holds it; a project already in a folder gets the new folder right
 * after that folder, since folders do not nest.
 */
export function createRailFolder(
  state: RailLayoutState,
  input: { readonly folderId: string; readonly name: string; readonly projectKey?: string },
): RailLayoutState {
  const entry = railFolderEntry(input.folderId);
  if (state.folders[input.folderId]) return state;
  const folder: RailFolder = {
    name: input.name,
    collapsed: false,
    projects: input.projectKey === undefined ? [] : [input.projectKey],
  };
  if (input.projectKey === undefined) {
    return { top: [entry, ...state.top], folders: { ...state.folders, [input.folderId]: folder } };
  }
  const holder = railFolderOf(state, input.projectKey);
  const spot =
    holder === null
      ? state.top.indexOf(railProjectEntry(input.projectKey))
      : state.top.indexOf(railFolderEntry(holder)) + 1;
  const removed = withoutProject(state, input.projectKey);
  const top = [...removed.top];
  // `spot` was read before the project left the top level, and the folder takes that index.
  top.splice(spot < 0 ? top.length : Math.min(spot, top.length), 0, entry);
  return { top, folders: { ...removed.folders, [input.folderId]: folder } };
}

/** An empty or blank name keeps the folder's current name. */
export function renameRailFolder(
  state: RailLayoutState,
  folderId: string,
  name: string,
): RailLayoutState {
  const folder = state.folders[folderId];
  const trimmed = name.trim();
  if (!folder || trimmed.length === 0 || trimmed === folder.name) return state;
  return { ...state, folders: { ...state.folders, [folderId]: { ...folder, name: trimmed } } };
}

/** Removing a folder never removes a project: its projects take the folder's place. */
export function removeRailFolder(state: RailLayoutState, folderId: string): RailLayoutState {
  const folder = state.folders[folderId];
  const at = state.top.indexOf(railFolderEntry(folderId));
  if (!folder) return state;
  const top = [...state.top];
  const projects = folder.projects.map(railProjectEntry);
  if (at < 0) top.push(...projects);
  else top.splice(at, 1, ...projects);
  const { [folderId]: _removed, ...folders } = state.folders;
  return { top, folders };
}

/** A removed folder as Undo needs it: its contents and its place in the top level. */
export interface RemovedRailFolder {
  readonly folderId: string;
  readonly folder: RailFolder;
  readonly index: number;
}

export function snapshotRailFolder(
  state: RailLayoutState,
  folderId: string,
): RemovedRailFolder | null {
  const folder = state.folders[folderId];
  if (!folder) return null;
  return { folderId, folder, index: state.top.indexOf(railFolderEntry(folderId)) };
}

/**
 * Undo for Remove Folder: the folder takes back the projects that are still loose at the top
 * level, where removing it left them, and returns where the first of them sits, else to its
 * old index. A project moved into another folder since then stays there, and changes made to
 * other entries stay.
 */
export function restoreRailFolder(
  state: RailLayoutState,
  removed: RemovedRailFolder,
): RailLayoutState {
  if (state.folders[removed.folderId]) return state;
  const loose = new Set(state.top);
  const projects = removed.folder.projects.filter((projectKey) =>
    loose.has(railProjectEntry(projectKey)),
  );
  const own = new Set(projects.map(railProjectEntry));
  const firstOwn = state.top.findIndex((entry) => own.has(entry));
  const top = state.top.filter((entry) => !own.has(entry));
  const at =
    firstOwn >= 0 ? firstOwn : removed.index < 0 ? top.length : Math.min(removed.index, top.length);
  top.splice(at, 0, railFolderEntry(removed.folderId));
  return {
    top,
    folders: { ...state.folders, [removed.folderId]: { ...removed.folder, projects } },
  };
}

export function setRailFolderCollapsed(
  state: RailLayoutState,
  folderId: string,
  collapsed: boolean,
): RailLayoutState {
  const folder = state.folders[folderId];
  if (!folder || folder.collapsed === collapsed) return state;
  return { ...state, folders: { ...state.folders, [folderId]: { ...folder, collapsed } } };
}

/** Opens the folder holding the project, so a jump never lands inside a folded folder. */
export function revealRailProject(state: RailLayoutState, projectKey: string): RailLayoutState {
  const folderId = railFolderOf(state, projectKey);
  return folderId === null ? state : setRailFolderCollapsed(state, folderId, false);
}

/**
 * Move Up and Move Down for a row, among its visible siblings. Returns null at either end.
 * Projects move inside their folder; folders move among the top-level entries.
 */
export function railStepPlacement(
  siblings: readonly string[],
  item: string,
  folderId: string | null,
  direction: "up" | "down",
): RailPlacement | null {
  const index = siblings.indexOf(item);
  if (index < 0) return null;
  if (direction === "up") {
    const previous = siblings[index - 1];
    return previous === undefined ? null : { folderId, anchor: { item: previous, side: "before" } };
  }
  const next = siblings[index + 1];
  return next === undefined ? null : { folderId, anchor: { item: next, side: "after" } };
}

/** A rail row as drag and drop sees it. Keys are `p:`, `f:` and `e:` (an empty folder's slot). */
export type RailDropRow =
  | {
      readonly kind: "project";
      readonly projectKey: string;
      readonly folderId: string | null;
      /** The bottom row of the top-level entry this row belongs to. */
      readonly lastRowKey: string;
    }
  | { readonly kind: "folder"; readonly folderId: string; readonly lastRowKey: string }
  | { readonly kind: "empty"; readonly folderId: string };

export type RailDragItem =
  | { readonly kind: "project"; readonly projectKey: string }
  | { readonly kind: "folder"; readonly folderId: string };

export type RailDrop =
  | {
      readonly kind: "line";
      readonly rowKey: string;
      readonly edge: "top" | "bottom";
      readonly placement: RailPlacement;
    }
  | { readonly kind: "into"; readonly folderId: string; readonly placement: RailPlacement };

export function railDropRowKey(row: RailDropRow): string {
  if (row.kind === "project") return railProjectEntry(row.projectKey);
  if (row.kind === "folder") return railFolderEntry(row.folderId);
  return `e:${row.folderId}`;
}

/** The top-level entry a row belongs to. */
function topEntryOf(row: Exclude<RailDropRow, { kind: "empty" }>): string {
  if (row.kind === "folder" || row.folderId !== null) return railFolderEntry(row.folderId!);
  return railProjectEntry(row.projectKey);
}

/**
 * Where a drag would land with the pointer at `y`, a fraction of the hovered row's height.
 * A project drops above or below a project, onto a folder's name to file it (the top quarter
 * of the name still means "above the folder"), or into an empty folder. A folder only moves
 * among top-level entries, so over another folder's projects it goes after that folder.
 */
export function resolveRailDrop(drag: RailDragItem, row: RailDropRow, y: number): RailDrop | null {
  const rowKey = railDropRowKey(row);
  if (drag.kind === "project") {
    if (row.kind === "empty") {
      return {
        kind: "into",
        folderId: row.folderId,
        placement: { folderId: row.folderId, anchor: null },
      };
    }
    if (row.kind === "folder") {
      if (y < 0.25) {
        return {
          kind: "line",
          rowKey,
          edge: "top",
          placement: { folderId: null, anchor: { item: rowKey, side: "before" } },
        };
      }
      return {
        kind: "into",
        folderId: row.folderId,
        placement: { folderId: row.folderId, anchor: null },
      };
    }
    if (row.projectKey === drag.projectKey) return null;
    const item = row.folderId === null ? rowKey : row.projectKey;
    const side = y < 0.5 ? "before" : "after";
    return {
      kind: "line",
      rowKey,
      edge: side === "before" ? "top" : "bottom",
      placement: { folderId: row.folderId, anchor: { item, side } },
    };
  }
  if (row.kind === "empty") {
    if (row.folderId === drag.folderId) return null;
    const entry = railFolderEntry(row.folderId);
    return {
      kind: "line",
      rowKey,
      edge: "bottom",
      placement: { folderId: null, anchor: { item: entry, side: "after" } },
    };
  }
  const entry = topEntryOf(row);
  if (entry === railFolderEntry(drag.folderId)) return null;
  const insideFolder = row.kind === "project" && row.folderId !== null;
  if (!insideFolder && y < 0.5) {
    return {
      kind: "line",
      rowKey,
      edge: "top",
      placement: { folderId: null, anchor: { item: entry, side: "before" } },
    };
  }
  return {
    kind: "line",
    rowKey: row.lastRowKey,
    edge: "bottom",
    placement: { folderId: null, anchor: { item: entry, side: "after" } },
  };
}

export function applyRailDrop(
  state: RailLayoutState,
  drag: RailDragItem,
  drop: RailDrop,
): RailLayoutState {
  if (drag.kind === "project") return moveRailProject(state, drag.projectKey, drop.placement);
  if (drop.placement.folderId !== null) return state;
  return moveRailFolder(state, drag.folderId, drop.placement.anchor);
}

/**
 * Adds a project to a rail list (hidden, favorites); its place in the layout stays as it was.
 * Returns the same list when nothing changes.
 */
export function addRailProjectKey(list: readonly string[], projectKey: string): readonly string[] {
  return list.includes(projectKey) ? list : [...list, projectKey];
}

/** Removes a project from a rail list; the same list when it was not there. */
export function removeRailProjectKey(
  list: readonly string[],
  projectKey: string,
): readonly string[] {
  return list.includes(projectKey) ? list.filter((key) => key !== projectKey) : list;
}
