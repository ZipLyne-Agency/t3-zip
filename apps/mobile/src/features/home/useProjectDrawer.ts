import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { OlderSettledScope } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useMemo } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { projectEnvironment } from "../../state/projects";
import type { SentThreadMessage } from "../../state/project-rail-sends";
import { useAtomCommand } from "../../state/use-atom-command";
import { olderSettledScopes } from "../threads/useThreadListV2";
import { buildDrawerThreadShelves } from "./drawer-shelves";
import {
  buildProjectDrawerModel,
  type ProjectDrawerModel,
  railProjectKeysForMembers,
  type ProjectRailChange,
  type SharedProjectRail,
} from "./project-drawer";
import type { ProjectSwitcherRow } from "./project-switcher";
import { useProjectDrawerRail } from "./useProjectDrawerRail";

export type ProjectSwitcherRows = {
  readonly fixed: ReadonlyArray<ProjectSwitcherRow>;
  readonly recent: ReadonlyArray<ProjectSwitcherRow>;
};

/** Everything the project drawer shows and does, built once by Home for both of its hosts. */
export interface ProjectDrawerData {
  /** The switcher rows before the rail is applied, for the button that opens the drawer. */
  readonly rows: ProjectSwitcherRows;
  readonly model: ProjectDrawerModel;
  /** The shared rail the model is built from; null in the plain recent list. */
  readonly rail: SharedProjectRail | null;
  /** Shared rail present and writable: the layout actions show. */
  readonly layoutActions: boolean;
  readonly selectedKey: string | null;
  readonly nowMs: number;
  /** The list's minute, for snooze preset times. */
  readonly now: string;
  readonly snoozePresetsOf: (
    row: ProjectSwitcherRow,
  ) => ReadonlyArray<SnoozePresetSetting> | undefined;
  readonly shelves: {
    readonly snoozed: ReadonlyArray<EnvironmentThreadShell>;
    readonly muted: ReadonlyArray<EnvironmentThreadShell>;
    readonly settled: ReadonlyArray<EnvironmentThreadShell>;
    /** Threads the settled pages count against: the drawer's environment, not archived. */
    readonly scopeThreads: ReadonlyArray<EnvironmentThreadShell>;
    readonly settledScopes: ReadonlyArray<OlderSettledScope>;
  };
  readonly onPick: (projectKey: string | null) => void;
  /** Set only while an environment filter is on; the drawer then offers to clear it. */
  readonly onClearEnvironmentFilter: (() => void) | undefined;
  readonly apply: (change: ProjectRailChange) => void;
  /** Shows the project if hidden and wakes it if snoozed, as sending a message there does. */
  readonly bringBack: (projectKey: string) => void;
  /** The project scope a thread belongs to, on any environment. */
  readonly projectKeyOfThread: (thread: EnvironmentThreadShell) => string | null;
  /** Environments a search in the drawer asks for message matches. */
  readonly searchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly toggleFolder: (folderId: string) => void;
  /** Favorites Only, kept on this device; only a shared layout has favorites. */
  readonly favoritesOnly: boolean;
  readonly setFavoritesOnly: (favoritesOnly: boolean) => void;
  readonly newFolder: (projectKey: string | undefined, name: string) => void;
  readonly newThread: (row: ProjectSwitcherRow) => void;
  readonly renameProject: (row: ProjectSwitcherRow, title: string) => void;
  readonly openThread: (thread: EnvironmentThreadShell) => void;
  readonly wakeThread: (thread: EnvironmentThreadShell) => void;
  readonly unmuteThread: (thread: EnvironmentThreadShell) => void;
  readonly unmuteAll: () => void;
  readonly reopenThread: (thread: EnvironmentThreadShell) => void;
}

interface DrawerScope {
  readonly key: string;
  readonly representative: EnvironmentProject;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
}

export function useProjectDrawer(input: {
  readonly rows: ProjectSwitcherRows;
  /** The scopes the rows list, in the drawer's environment. */
  readonly scopes: ReadonlyArray<DrawerScope>;
  /** Every project scope on every environment, to find where a sent message belongs. */
  readonly allScopes: ReadonlyArray<DrawerScope>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly searchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly selectedKey: string | null;
  readonly now: string;
  readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly snoozePresetsByEnvironmentId: ReadonlyMap<
    EnvironmentId,
    ReadonlyArray<SnoozePresetSetting>
  >;
  readonly onPick: (projectKey: string | null) => void;
  readonly onClearEnvironmentFilter: (() => void) | undefined;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSetThreadMuted: (thread: EnvironmentThreadShell, muted: boolean) => Promise<boolean>;
  readonly onUnsettleThread: (thread: EnvironmentThreadShell) => void;
}): ProjectDrawerData {
  const gt = useGT();
  const nowMs = Date.parse(input.now);
  const knownProjectKeys = input.rows.recent.flatMap((row) => (row.key === null ? [] : [row.key]));
  const scopeByKey = new Map(input.scopes.map((scope) => [scope.key, scope]));
  const railGroups = input.allScopes.map((scope) => ({
    projectKey: scope.key,
    memberProjectRefs: scope.projectRefs,
  }));
  const projectKeyOf = (environmentId: EnvironmentId, projectId: ProjectId) =>
    railProjectKeysForMembers(railGroups, [scopedProjectKey(environmentId, projectId)])[0] ?? null;
  const projectKeyOfSent = (message: SentThreadMessage) => {
    const projectId =
      input.threads.find(
        (thread) =>
          thread.environmentId === message.environmentId && thread.id === message.threadId,
      )?.projectId ?? message.projectId;
    return projectId === null ? null : projectKeyOf(message.environmentId, projectId);
  };
  const rail = useProjectDrawerRail({
    knownProjectKeys,
    projectKeyOfSent,
  });

  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const collapsedList = AsyncResult.isSuccess(preferences)
    ? preferences.value.projectDrawerCollapsedFolders
    : undefined;
  const collapsedFolders = useMemo(() => new Set(collapsedList ?? []), [collapsedList]);
  const toggleFolder = (folderId: string) => {
    void savePreferences({
      transform: (current) => {
        const folded = current.projectDrawerCollapsedFolders ?? [];
        return {
          projectDrawerCollapsedFolders: folded.includes(folderId)
            ? folded.filter((id) => id !== folderId)
            : [...folded, folderId],
        };
      },
    });
  };

  const favoritesOnlySaved = AsyncResult.isSuccess(preferences)
    ? preferences.value.projectDrawerFavoritesOnly === true
    : false;
  const setFavoritesOnly = (favoritesOnly: boolean) => {
    void savePreferences({ projectDrawerFavoritesOnly: favoritesOnly });
  };

  const model = buildProjectDrawerModel({
    rows: input.rows,
    rail: rail.rail,
    collapsedFolders,
    nowMs,
  });

  const scopeThreads = input.threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      (input.environmentId === null || thread.environmentId === input.environmentId),
  );
  const threadShelves = buildDrawerThreadShelves({
    threads: scopeThreads,
    nowMs,
    configLoaded: (environmentId) => input.settlementEnvironmentIds.has(environmentId),
  });

  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const renameProject = (row: ProjectSwitcherRow, title: string) => {
    const scope = row.key === null ? undefined : scopeByKey.get(row.key);
    const trimmed = title.trim();
    if (!scope || trimmed === "" || trimmed === row.title) return;
    for (const ref of scope.projectRefs) {
      void updateProject({
        environmentId: ref.environmentId,
        input: { projectId: ref.projectId, title: trimmed },
      });
    }
  };

  const { onSetThreadMuted, onUnsnoozeThread, onUnsettleThread, onSelectThread } = input;
  const unmuteAll = () => {
    const muted = threadShelves.muted;
    void Promise.all(muted.map((thread) => onSetThreadMuted(thread, false))).then((results) => {
      if (results.some((ok) => !ok)) {
        Dialog.alert(gt("Some threads could not be unmuted"), gt("Try again."));
      }
    });
  };

  return {
    rows: input.rows,
    model,
    rail: rail.rail,
    layoutActions: model.shared && rail.canEdit,
    selectedKey: input.selectedKey,
    nowMs,
    now: input.now,
    snoozePresetsOf: (row) =>
      row.project ? input.snoozePresetsByEnvironmentId.get(row.project.environmentId) : undefined,
    shelves: {
      ...threadShelves,
      scopeThreads,
      settledScopes: olderSettledScopes({
        environmentId: input.environmentId,
        projectRefs: null,
        settlementEnvironmentIds: input.settlementEnvironmentIds,
      }),
    },
    onPick: input.onPick,
    onClearEnvironmentFilter: input.onClearEnvironmentFilter,
    apply: rail.apply,
    bringBack: (projectKey) => rail.bringBack([projectKey]),
    projectKeyOfThread: (thread) => projectKeyOf(thread.environmentId, thread.projectId),
    searchEnvironmentIds: input.searchEnvironmentIds,
    toggleFolder,
    favoritesOnly: favoritesOnlySaved && model.shared,
    setFavoritesOnly,
    newFolder: (projectKey, name) =>
      rail.apply({
        kind: "new-folder",
        folderId: uuidv4(),
        name,
        ...(projectKey === undefined ? {} : { projectKey }),
      }),
    newThread: (row) => {
      if (row.project) input.onNewThreadInProject(row.project);
    },
    renameProject,
    openThread: onSelectThread,
    wakeThread: (thread) => void onUnsnoozeThread(thread),
    unmuteThread: (thread) => void onSetThreadMuted(thread, false),
    unmuteAll,
    reopenThread: onUnsettleThread,
  };
}
