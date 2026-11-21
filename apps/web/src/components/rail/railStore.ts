import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
  filter: Schema.optionalKey(Schema.Literals(["all", "favorites", "waiting", "working", "done"])),
  favoritesOnly: Schema.optionalKey(Schema.Boolean),
  // The thread column beside the rail, added after the folders and filters.
  threadColumnOpen: Schema.optionalKey(Schema.Boolean),
  threadColumnScope: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ scope: Schema.String, madeUnder: Schema.NullOr(Schema.String) })),
  ),
});
type PersistedRail = Omit<Required<typeof PersistedRailSchema.Type>, "filter"> & {
  readonly filter: RailFilter;
};
export type RailFilter = "all" | "waiting" | "working" | "done";

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
};

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
}

/** Device-local, like the sidebar's project order in the UI state store. */
export const useProjectRailStore = create<ProjectRailStore>()(
  persist(
    (set) => ({
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
    }),
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
      }),
      // Storage is user-editable and may come from a newer build; see `readPersistedRail`.
      merge: (persisted, current) => {
        const { filter, ...rest } = readPersistedRail(persisted);
        return {
          ...current,
          ...rest,
          ...(filter === undefined
            ? {}
            : filter === "favorites"
              ? { filter: "all" as const, favoritesOnly: true }
              : { filter }),
        };
      },
    },
  ),
);
