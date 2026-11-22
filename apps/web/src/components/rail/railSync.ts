/**
 * T3 Zip: keeps the rail's shared fields (folders, order, favorites, hidden and snoozed
 * projects) in step with the primary server's `projectRail` setting, so the phone shows the same
 * rail and the desktop picks up the phone's changes live. The local store stays the source the
 * rail renders from; this only adopts the server's value or sends the device's.
 */
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { serverEnvironment } from "~/state/server";
import { environmentSession, readEnvironmentScope } from "~/state/session";

import {
  backUpProjectRailOnce,
  PROJECT_RAIL_REPLACED_SERVER_BACKUP_KEY,
  selectSharedProjectRail,
  useProjectRailStore,
} from "./railStore";
import { createProjectRailSync, type ServerProjectRail } from "./railSync.logic";

const primaryLiveProjectRailAtom = Atom.make((get): ServerProjectRail | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const projection = AsyncResult.getOrElse(
    get(serverEnvironment.configProjection({ environmentId, input: {} })),
    () => null,
  );
  // A cached config can be older than the server; acting on it could seed over a newer value.
  if (projection?.source !== "live") return null;
  return { environmentId, projectRail: projection.config.settings.projectRail };
}).pipe(Atom.withLabel("web-primary-live-project-rail"));

/** Starts the rail sync for the app's lifetime. Returns a stop function. */
export function startProjectRailSync(): () => void {
  const sync = createProjectRailSync({
    readServer: () => appAtomRegistry.get(primaryLiveProjectRailAtom),
    readLocal: () => {
      const state = useProjectRailStore.getState();
      return {
        content: selectSharedProjectRail(state),
        pendingSince: state.sharedPendingSince,
        neverSynced: state.sharedBaseUpdatedAt === null,
      };
    },
    canWrite: (environmentId) =>
      // Before the session has loaded, let the server decide; a refusal is retried quietly.
      appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId))._tag === "Initial" ||
      readEnvironmentScope(environmentId, AuthSettingsWriteScope),
    write: async (environmentId, rail) => {
      const result = await runAtomCommand(
        appAtomRegistry,
        serverEnvironment.updateSettings,
        { environmentId, input: { patch: { projectRail: rail } } },
        { label: "project rail sync", reportFailure: false },
      );
      return result._tag === "Success";
    },
    adopt: (rail) => useProjectRailStore.getState().adoptSharedRail(rail),
    confirm: (updatedAt) => useProjectRailStore.getState().confirmSharedRail(updatedAt),
    backUpReplacedServerRail: (rail) =>
      backUpProjectRailOnce(PROJECT_RAIL_REPLACED_SERVER_BACKUP_KEY, rail),
    now: () => new Date().toISOString(),
  });
  const unsubscribeServer = appAtomRegistry.subscribe(primaryLiveProjectRailAtom, sync.run);
  const unsubscribeStore = useProjectRailStore.subscribe((state, previous) => {
    if (
      state.layout !== previous.layout ||
      state.favoriteProjects !== previous.favoriteProjects ||
      state.hiddenProjects !== previous.hiddenProjects ||
      state.snoozedProjects !== previous.snoozedProjects ||
      state.sharedPendingSince !== previous.sharedPendingSince
    ) {
      sync.run();
    }
  });
  sync.run();
  return () => {
    unsubscribeServer();
    unsubscribeStore();
  };
}
