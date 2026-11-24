import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  isEmptySharedProjectRail,
  localProjectRailFromShared,
  nextProjectRailEditTime,
  railProjectReturn,
  sameSharedProjectRail,
  sharedProjectRailContentFromLocal,
  type LocalProjectRail,
  type SharedProjectRail,
  type SharedProjectRailContent,
} from "@t3tools/client-runtime/state/project-rail";

import {
  normalizeThreadStatusFilter,
  threadStatusFilters,
  type ThreadStatusFilter,
} from "@t3tools/client-runtime/state/thread-status-filter";

import { resolveStorage } from "../../lib/storage";
import {
  EMPTY_RAIL_LAYOUT,
  addRailProjectKey,
  materializeRailLayout,
  revealRailProject,
  removeRailProjectKey,
  type NoProjectPosition,
  type RailLayoutState,
} from "./railLayout.logic";

const RailFolderSchema = Schema.Struct({
  name: Schema.String,
  collapsed: Schema.Boolean,
  projects: Schema.Array(Schema.String),
});

const PersistedRailSchema = Schema.Struct({
  layout: Schema.Struct({
    top: Schema.Array(Schema.String),
    folders: Schema.Record(Schema.String, RailFolderSchema),
  }),
  noProjectPosition: Schema.Literals(["top", "bottom"]),
  lastThreadByProject: Schema.Record(Schema.String, Schema.String),
  // Added after the first release; older saved state has neither.
  hiddenProjects: Schema.optionalKey(Schema.Array(Schema.String)),
  shelvesCollapsed: Schema.optionalKey(Schema.Boolean),
  favoriteProjects: Schema.optionalKey(Schema.Array(Schema.String)),
  // Project rail key to the time it comes back; added after hidden projects.
  snoozedProjects: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  // "favorites" is from before Favorites became its own toggle; it loads as favoritesOnly.
  // "workingDone" is the thread list's tab; it decodes so it can be moved onto a tab the rail shows.
  filter: Schema.optionalKey(
    Schema.Literals(["all", "favorites", "waiting", "working", "done", "workingDone"]),
  ),
  favoritesOnly: Schema.optionalKey(Schema.Boolean),
  // The thread column beside the rail, added after the folders and filters.
  threadColumnOpen: Schema.optionalKey(Schema.Boolean),
  threadColumnScope: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ scope: Schema.String, madeUnder: Schema.NullOr(Schema.String) })),
  ),
  // T3 Zip: when this device last changed the shared fields without the server confirming it.
  // Null once the server holds this device's rail; absent in state from before the rail synced.
  sharedPendingSince: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // T3 Zip: `updatedAt` of the server rail this device last adopted or had confirmed; null if
  // it never synced.
  sharedBaseUpdatedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
type PersistedRail = Omit<Required<typeof PersistedRailSchema.Type>, "filter"> & {
  readonly filter: RailFilter;
};
/** The rail's own queue filter, shown without the thread list; it keeps Working and Done apart. */
type RailFilter = Exclude<ThreadStatusFilter, "workingDone">;

const isRailFilter = (filter: ThreadStatusFilter): filter is RailFilter => filter !== "workingDone";

/** The rail's filter tabs: the split set, which keeps Working and Done apart. */
export const RAIL_QUEUE_FILTERS: ReadonlyArray<RailFilter> =
  threadStatusFilters(false).filter(isRailFilter);

/** A saved filter moved onto a tab the rail shows; see `normalizeThreadStatusFilter`. */
function railFilterFromSaved(filter: ThreadStatusFilter): RailFilter {
  const normalized = normalizeThreadStatusFilter(filter, false);
  return isRailFilter(normalized) ? normalized : DEFAULT_RAIL.filter;
}

const decodePersistedRail = Schema.decodeUnknownOption(PersistedRailSchema);

const DEFAULT_RAIL: PersistedRail = {
  layout: EMPTY_RAIL_LAYOUT,
  noProjectPosition: "bottom",
  lastThreadByProject: {},
  hiddenProjects: [],
  shelvesCollapsed: false,
  favoriteProjects: [],
  snoozedProjects: {},
  filter: "all",
  favoritesOnly: false,
  threadColumnOpen: true,
  threadColumnScope: null,
  sharedPendingSince: null,
  sharedBaseUpdatedAt: null,
};

/** The fields the server shares with the phone (`ServerSettings.projectRail`), folding aside. */
export function selectSharedProjectRail(state: LocalProjectRail): SharedProjectRailContent {
  return sharedProjectRailContentFromLocal(state);
}

/**
 * One-time copies of a rail the first sync replaced, in case it is wanted back: this device's
 * own rail when it takes the server's, and the server's when this device's rail replaces it.
 */
const PROJECT_RAIL_PRE_SYNC_BACKUP_KEY = "t3code:project-rail:pre-sync-backup";
export const PROJECT_RAIL_REPLACED_SERVER_BACKUP_KEY = "t3code:project-rail:replaced-server-backup";

/** Saves `rail` under `key` unless something is already there. */
export function backUpProjectRailOnce(key: string, rail: SharedProjectRailContent): void {
  if (typeof window === "undefined" || isEmptySharedProjectRail(rail)) return;
  try {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), rail }));
  } catch {
    // Storage can be full or blocked; the backup is a courtesy.
  }
}

/**
 * Saved rail state, read field by field when it does not decode as a whole. One value this
 * build cannot read (a filter from a newer build, a hand-edited entry) then falls back to its
 * default alone, and the folders, hidden projects and favorites beside it are kept.
 */
function readPersistedRail(persisted: unknown): Partial<typeof PersistedRailSchema.Type> {
  const whole = decodePersistedRail(persisted);
  if (whole._tag === "Some") return whole.value;
  if (typeof persisted !== "object" || persisted === null) return {};
  const saved = persisted as Readonly<Record<string, unknown>>;
  // The required fields at their defaults, so each saved field can be decoded on its own.
  const base = {
    layout: DEFAULT_RAIL.layout,
    noProjectPosition: DEFAULT_RAIL.noProjectPosition,
    lastThreadByProject: DEFAULT_RAIL.lastThreadByProject,
  };
  const readable: Record<string, unknown> = {};
  for (const key of Object.keys(PersistedRailSchema.fields)) {
    if (!(key in saved)) continue;
    const decoded = decodePersistedRail({ ...base, [key]: saved[key] });
    if (decoded._tag === "Some") {
      readable[key] = (decoded.value as Readonly<Record<string, unknown>>)[key];
    }
  }
  return readable;
}

interface ProjectRailStore extends PersistedRail {
  /**
   * Projects a message was just sent in, as `environmentId:projectId`. The rail brings each
   * one back if it is hidden or snoozed, then empties the list. Not saved.
   */
  readonly sentInProjects: readonly string[];
  readonly noteSentInProject: (memberKey: string) => void;
  readonly clearSentInProjects: () => void;
  /** Applies a layout change on top of the stored order with every known project placed. */
  readonly updateLayout: (
    knownProjectKeys: readonly string[],
    change: (layout: RailLayoutState) => RailLayoutState,
  ) => void;
  readonly replaceLayout: (layout: RailLayoutState) => void;
  readonly setNoProjectPosition: (position: NoProjectPosition) => void;
  readonly rememberThread: (projectKey: string, threadKey: string) => void;
  /** Opens the folder holding a project. Call it before jumping into that project. */
  readonly revealProject: (projectKey: string) => void;
  /** Hidden projects leave the rail but keep their folder and position for when they return. */
  readonly hideProject: (projectKey: string) => void;
  readonly showProject: (projectKey: string) => void;
  /** A snoozed project leaves the rail until `until`, then comes back where it was. */
  readonly snoozeProject: (projectKey: string, until: string) => void;
  /** Brings snoozed projects back now. */
  readonly wakeProjects: (projectKeys: readonly string[]) => void;
  /** Puts back a snooze Undo replaces; undefined removes it. */
  readonly restoreProjectSnooze: (projectKey: string, until: string | undefined) => void;
  readonly setShelvesCollapsed: (collapsed: boolean) => void;
  readonly setProjectFavorite: (projectKey: string, favorite: boolean) => void;
  readonly setFilter: (filter: RailFilter) => void;
  readonly setFavoritesOnly: (favoritesOnly: boolean) => void;
  readonly setThreadColumnOpen: (open: boolean) => void;
  /** Shows a project's threads (or every project's) in the column; see `resolveThreadColumnScope`. */
  readonly chooseThreadColumnScope: (scope: string, madeUnder: string | null) => void;
  /** Takes the server's rail, keeping this device's folder folding. Not an edit: nothing is sent. */
  readonly adoptSharedRail: (rail: SharedProjectRail) => void;
  /** The server holds this device's rail, as the value stamped `updatedAt`. */
  readonly confirmSharedRail: (updatedAt: string) => void;
}

const SHARED_FIELDS = ["layout", "favoriteProjects", "hiddenProjects", "snoozedProjects"] as const;

/**
 * Stamps `sharedPendingSince` on any change to the shared fields' content, so the sync sends it.
 * Folding a folder or a layout rebuilt with the same content is not a shared change.
 */
function markSharedEdits(
  state: ProjectRailStore,
  next: Partial<ProjectRailStore>,
  nowMs: () => number,
): Partial<ProjectRailStore> {
  if ((next as unknown) === state || "sharedPendingSince" in next) return next;
  if (!SHARED_FIELDS.some((field) => field in next && next[field] !== state[field])) return next;
  const before = selectSharedProjectRail(state);
  const after = selectSharedProjectRail({ ...state, ...next } as ProjectRailStore);
  if (sameSharedProjectRail(before, after)) return next;
  return {
    ...next,
    sharedPendingSince: nextProjectRailEditTime(nowMs(), state.sharedBaseUpdatedAt),
  };
}

/**
 * T3 Zip: folders, order, favorites, hidden and snoozed projects are shared with the phone
 * through the primary server's settings (see `railSync.ts`) and kept here too, so the rail shows
 * at once and works against servers without the field. The rest is device-local.
 */
export const useProjectRailStore = create<ProjectRailStore>()(
  persist(
    (rawSet, get) => {
      const set = (
        partial:
          | Partial<ProjectRailStore>
          | ((state: ProjectRailStore) => Partial<ProjectRailStore>),
      ) =>
        rawSet((state) =>
          markSharedEdits(
            state,
            typeof partial === "function" ? partial(state) : partial,
            Date.now,
          ),
        );
      return {
        ...DEFAULT_RAIL,
        sentInProjects: [],
        noteSentInProject: (memberKey) =>
          set((state) =>
            state.sentInProjects.includes(memberKey)
              ? state
              : { sentInProjects: [...state.sentInProjects, memberKey] },
          ),
        clearSentInProjects: () =>
          set((state) => (state.sentInProjects.length === 0 ? state : { sentInProjects: [] })),
        updateLayout: (knownProjectKeys, change) =>
          set((state) => {
            const layout = change(materializeRailLayout(state.layout, knownProjectKeys));
            return layout === state.layout ? state : { layout };
          }),
        replaceLayout: (layout) => set({ layout }),
        setNoProjectPosition: (noProjectPosition) => set({ noProjectPosition }),
        rememberThread: (projectKey, threadKey) =>
          set((state) =>
            state.lastThreadByProject[projectKey] === threadKey
              ? state
              : { lastThreadByProject: { ...state.lastThreadByProject, [projectKey]: threadKey } },
          ),
        revealProject: (projectKey) =>
          set((state) => {
            const layout = revealRailProject(state.layout, projectKey);
            return layout === state.layout ? state : { layout };
          }),
        hideProject: (projectKey) =>
          set((state) => {
            const hiddenProjects = addRailProjectKey(state.hiddenProjects, projectKey);
            return hiddenProjects === state.hiddenProjects ? state : { hiddenProjects };
          }),
        showProject: (projectKey) =>
          set((state) => {
            const hiddenProjects = removeRailProjectKey(state.hiddenProjects, projectKey);
            return hiddenProjects === state.hiddenProjects ? state : { hiddenProjects };
          }),
        snoozeProject: (projectKey, until) =>
          set((state) => ({ snoozedProjects: { ...state.snoozedProjects, [projectKey]: until } })),
        wakeProjects: (projectKeys) =>
          set((state) => {
            if (!projectKeys.some((key) => key in state.snoozedProjects)) return state;
            const snoozedProjects = { ...state.snoozedProjects };
            for (const key of projectKeys) delete snoozedProjects[key];
            return { snoozedProjects };
          }),
        restoreProjectSnooze: (projectKey, until) =>
          set((state) => {
            const snoozedProjects = { ...state.snoozedProjects };
            if (until === undefined) delete snoozedProjects[projectKey];
            else snoozedProjects[projectKey] = until;
            return { snoozedProjects };
          }),
        setShelvesCollapsed: (shelvesCollapsed) => set({ shelvesCollapsed }),
        setProjectFavorite: (projectKey, favorite) =>
          set((state) => {
            const favoriteProjects = favorite
              ? addRailProjectKey(state.favoriteProjects, projectKey)
              : removeRailProjectKey(state.favoriteProjects, projectKey);
            return favoriteProjects === state.favoriteProjects ? state : { favoriteProjects };
          }),
        setFilter: (filter) => set({ filter }),
        setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
        setThreadColumnOpen: (threadColumnOpen) => set({ threadColumnOpen }),
        chooseThreadColumnScope: (scope, madeUnder) =>
          set((state) =>
            state.threadColumnScope?.scope === scope &&
            state.threadColumnScope.madeUnder === madeUnder
              ? state
              : { threadColumnScope: { scope, madeUnder } },
          ),
        adoptSharedRail: (rail) => {
          const state = get();
          // Only a device that never synced loses a rail of its own here.
          if (state.sharedBaseUpdatedAt === null) {
            backUpProjectRailOnce(PROJECT_RAIL_PRE_SYNC_BACKUP_KEY, selectSharedProjectRail(state));
          }
          rawSet({
            ...localProjectRailFromShared(rail, state.layout),
            sharedPendingSince: null,
            sharedBaseUpdatedAt: rail.updatedAt,
          });
        },
        confirmSharedRail: (updatedAt) =>
          rawSet((state) =>
            state.sharedPendingSince === null && state.sharedBaseUpdatedAt === updatedAt
              ? state
              : { sharedPendingSince: null, sharedBaseUpdatedAt: updatedAt },
          ),
      };
    },
    {
      name: "t3code:project-rail:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({
        layout,
        noProjectPosition,
        lastThreadByProject,
        hiddenProjects,
        shelvesCollapsed,
        favoriteProjects,
        snoozedProjects,
        filter,
        favoritesOnly,
        threadColumnOpen,
        threadColumnScope,
        sharedPendingSince,
        sharedBaseUpdatedAt,
      }) => ({
        layout,
        noProjectPosition,
        lastThreadByProject,
        hiddenProjects,
        shelvesCollapsed,
        favoriteProjects,
        snoozedProjects,
        filter,
        favoritesOnly,
        threadColumnOpen,
        threadColumnScope,
        sharedPendingSince,
        sharedBaseUpdatedAt,
      }),
      // Storage is user-editable and may come from a newer build; see `readPersistedRail`.
      merge: (persisted, current) => {
        const { filter, sharedPendingSince, ...rest } = readPersistedRail(persisted);
        const merged = { ...current, ...rest };
        return {
          ...merged,
          // A rail saved before syncing counts as an edit made now, so it seeds the server or
          // wins over a value the phone wrote first. After that the saved marker is used.
          sharedPendingSince:
            sharedPendingSince !== undefined
              ? sharedPendingSince
              : isEmptySharedProjectRail(selectSharedProjectRail(merged))
                ? null
                : new Date().toISOString(),
          ...(filter === undefined
            ? {}
            : filter === "favorites"
              ? { filter: "all" as const, favoritesOnly: true }
              : { filter: railFilterFromSaved(filter) }),
        };
      },
    },
  ),
);

/**
 * Brings a hidden or snoozed project back to the rail, where it was, through the same actions
 * the Hidden and Snoozed shelves' Show and Wake buttons call, so the shared rail syncs as it does
 * for them. A project already in the rail is left alone. Returns whether anything changed.
 */
export function bringBackRailProject(projectKey: string): boolean {
  const store = useProjectRailStore.getState();
  const change = railProjectReturn(store, projectKey);
  if (change === null) return false;
  if (change.show) store.showProject(projectKey);
  if (change.wake) store.wakeProjects([projectKey]);
  store.revealProject(projectKey);
  return true;
}
