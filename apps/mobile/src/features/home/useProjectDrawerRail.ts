import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useEffect, useEffectEvent } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  clearSentThreadMessages,
  sentThreadMessagesAtom,
  type SentThreadMessage,
} from "../../state/project-rail-sends";
import {
  editSharedProjectRail,
  effectiveProjectRail,
  primaryProjectRail,
  projectsToBringBack,
  type EnvironmentProjectRail,
  type ProjectRailChange,
  type SharedProjectRail,
} from "./project-drawer";

/**
 * Environments with settings, connected or remembered from the last connection, and the rail
 * those settings hold, in the catalog's order. Reading the remembered rail keeps folders in
 * place while the phone reconnects; writes wait for a live connection.
 */
function railsFromPresentations(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
): Array<{
  readonly environmentId: EnvironmentId;
  readonly rail: SharedProjectRail | undefined;
  readonly connected: boolean;
}> {
  return [...presentations].flatMap(([environmentId, presentation]) =>
    presentation.serverConfig
      ? [
          {
            environmentId,
            rail: presentation.serverConfig.settings.projectRail,
            connected: presentation.connection.phase === "connected",
          },
        ]
      : [],
  );
}

type PendingRail = { readonly base: string | null; readonly rail: SharedProjectRail };

/** Writes this device sent and the server has not echoed yet, by environment. */
const pendingRailsAtom = Atom.make<ReadonlyMap<EnvironmentId, PendingRail>>(new Map()).pipe(
  Atom.keepAlive,
);

function setPending(environmentId: EnvironmentId, pending: PendingRail | null) {
  const next = new Map(appAtomRegistry.get(pendingRailsAtom));
  if (pending === null) next.delete(environmentId);
  else next.set(environmentId, pending);
  appAtomRegistry.set(pendingRailsAtom, next);
}

/** The primary environment's rail, with this device's unconfirmed write over it. */
function primaryRail(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
  pending: ReadonlyMap<EnvironmentId, PendingRail>,
):
  | (EnvironmentProjectRail<EnvironmentId> & {
      readonly server: SharedProjectRail;
      readonly connected: boolean;
    })
  | null {
  const rails = railsFromPresentations(presentations);
  const primary = primaryProjectRail(rails);
  if (primary === null) return null;
  const connected = rails.some(
    (entry) => entry.environmentId === primary.environmentId && entry.connected,
  );
  const rail = effectiveProjectRail(primary.rail, pending.get(primary.environmentId) ?? null);
  return rail
    ? { environmentId: primary.environmentId, rail, server: primary.rail, connected }
    : null;
}

// One write at a time, so each builds on the one before it.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueRailWrite(write: () => Promise<void>) {
  writeQueue = writeQueue.then(write).catch(() => undefined);
}

/**
 * The drawer's shared rail, read from and written whole to the primary environment only. Null
 * `rail` means none is seeded: the drawer keeps its recent list and offers no layout actions.
 */
export function useProjectDrawerRail(input: {
  readonly knownProjectKeys: ReadonlyArray<string>;
  /** The project scope a sent message belongs to, or null when it is not known here. */
  readonly projectKeyOfSent: (message: SentThreadMessage) => string | null;
}) {
  const gt = useGT();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const pending = useAtomValue(pendingRailsAtom);
  const primary = primaryRail(presentations, pending);
  const writable = useEnvironmentsWithScope(primary ? [primary] : [], AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "project rail update",
    reportFailure: false,
  });

  const apply = (change: ProjectRailChange) => {
    const knownProjectKeys = input.knownProjectKeys;
    enqueueRailWrite(async () => {
      // Build on the latest value held, so a write never drops one before it.
      const latest = primaryRail(
        appAtomRegistry.get(environmentPresentations.presentationsAtom),
        appAtomRegistry.get(pendingRailsAtom),
      );
      if (latest === null || !latest.connected || !writable.has(latest.environmentId)) return;
      const { environmentId } = latest;
      const next = editSharedProjectRail(latest.rail, change, {
        knownProjectKeys,
        nowMs: Date.now(),
      });
      if (next === null) return;
      const write = { base: latest.server.updatedAt, rail: next };
      setPending(environmentId, write);
      const result = await updateSettings({
        environmentId,
        input: { patch: { projectRail: next } },
      });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      // Restore the server's value unless a later write replaced this one.
      if (appAtomRegistry.get(pendingRailsAtom).get(environmentId) === write) {
        setPending(environmentId, null);
      }
      Dialog.alert(gt("Could not save the project list"), gt("Try again."));
    });
  };

  const rail = primary?.rail ?? null;
  // Shows hidden projects and wakes snoozed ones with the shelves' own writes; without a
  // shared rail there is nothing to write.
  const bringBack = (projectKeys: ReadonlyArray<string>) => {
    if (rail === null) return;
    for (const change of projectsToBringBack(rail, projectKeys)) apply(change);
  };
  const sent = useAtomValue(sentThreadMessagesAtom);
  const bringBackSent = useEffectEvent((messages: ReadonlyArray<SentThreadMessage>) => {
    clearSentThreadMessages(messages);
    bringBack(messages.flatMap((message) => input.projectKeyOfSent(message) ?? []));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a message sent from the composer, which cannot see project scopes, brings its hidden or snoozed project back, as on desktop
  useEffect(() => {
    if (sent.length > 0) bringBackSent(sent);
  }, [sent]);

  return {
    rail,
    canEdit: primary !== null && primary.connected && writable.has(primary.environmentId),
    apply,
    bringBack,
  };
}
