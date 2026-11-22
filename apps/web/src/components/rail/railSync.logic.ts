/**
 * T3 Zip: the rail sync's decisions, apart from the app's atoms so they can be tested. See
 * `railSync.ts`.
 */
import {
  isEmptySharedProjectRail,
  resolveProjectRailSync,
  sameSharedProjectRail,
  type SharedProjectRail,
  type SharedProjectRailContent,
} from "@t3tools/client-runtime/state/project-rail";
import type { EnvironmentId } from "@t3tools/contracts";

export interface ServerProjectRail {
  readonly environmentId: EnvironmentId;
  /** Undefined when the server has none yet, or is a build without the field. */
  readonly projectRail: SharedProjectRail | undefined;
}

export interface ProjectRailSyncDeps {
  /** The primary server's live settings value; null until a live config has arrived. */
  readonly readServer: () => ServerProjectRail | null;
  readonly readLocal: () => {
    readonly content: SharedProjectRailContent;
    readonly pendingSince: string | null;
    /** This device has never adopted or had confirmed a server rail. */
    readonly neverSynced: boolean;
  };
  readonly canWrite: (environmentId: EnvironmentId) => boolean;
  /** Resolves true when the server accepted the value. Never shows a toast. */
  readonly write: (environmentId: EnvironmentId, rail: SharedProjectRail) => Promise<boolean>;
  readonly adopt: (rail: SharedProjectRail) => void;
  /** The server holds the device's rail, as the value stamped `updatedAt`. */
  readonly confirm: (updatedAt: string) => void;
  /** Keeps a server rail a never-synced device is about to replace. */
  readonly backUpReplacedServerRail: (rail: SharedProjectRail) => void;
  readonly now: () => string;
}

/**
 * One write in flight at a time, and no decision while it is: what arrives meanwhile is looked
 * at once it settles. The same content is never sent twice in a row, so a server that drops the
 * field (an older build) gets one write per change. A failed write is sent again only when the
 * device's rail or the server's changes, never on unrelated config updates.
 */
export function createProjectRailSync(deps: ProjectRailSyncDeps): { readonly run: () => void } {
  let inFlight = false;
  let runAgain = false;
  let lastSent: SharedProjectRailContent | null = null;
  let failed: {
    readonly content: SharedProjectRailContent;
    readonly server: SharedProjectRail | undefined;
  } | null = null;

  const run = (): void => {
    if (inFlight) {
      runAgain = true;
      return;
    }
    const server = deps.readServer();
    if (server === null) return;
    const local = deps.readLocal();
    if (
      server.projectRail !== undefined &&
      sameSharedProjectRail(server.projectRail, local.content)
    ) {
      lastSent = null;
      failed = null;
      deps.confirm(server.projectRail.updatedAt);
      return;
    }
    const step = resolveProjectRailSync({
      server: server.projectRail,
      local: local.content,
      pendingSince: local.pendingSince,
    });
    if (step.kind === "none") return;
    if (step.kind === "adopt") {
      lastSent = null;
      failed = null;
      deps.adopt(step.rail);
      return;
    }
    if (lastSent !== null && sameSharedProjectRail(lastSent, local.content)) return;
    if (
      failed !== null &&
      failed.server === server.projectRail &&
      sameSharedProjectRail(failed.content, local.content)
    ) {
      return;
    }
    if (!deps.canWrite(server.environmentId)) return;
    if (
      local.neverSynced &&
      server.projectRail !== undefined &&
      !isEmptySharedProjectRail(server.projectRail)
    ) {
      deps.backUpReplacedServerRail(server.projectRail);
    }
    // Stamped with the edit's own time, so an old offline edit does not beat a newer one.
    const rail: SharedProjectRail = {
      ...local.content,
      updatedAt: local.pendingSince ?? deps.now(),
    };
    const serverRail = server.projectRail;
    inFlight = true;
    lastSent = rail;
    failed = null;
    void deps
      .write(server.environmentId, rail)
      .catch(() => false)
      .then((saved) => {
        if (!saved && lastSent === rail) {
          lastSent = null;
          failed = { content: rail, server: serverRail };
        }
        inFlight = false;
        if (runAgain) {
          runAgain = false;
          run();
        }
      });
  };

  return { run };
}
