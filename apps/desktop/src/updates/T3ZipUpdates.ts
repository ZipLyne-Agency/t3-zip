import type { DesktopUpdateState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import { T3_ZIP_UPDATE_SCRIPT } from "../app/T3Zip.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { runT3ZipUpdateScript, startT3ZipUpdateScript } from "./t3ZipUpdateScript.ts";
import { resolveT3ZipUpdateState, sameT3ZipUpdateState } from "./t3ZipUpdateState.ts";
import { createInitialDesktopUpdateState } from "./updateMachine.ts";

/**
 * T3 Zip's update source: `scripts/t3zip-update.sh` builds the fork on this Mac and this reports
 * that build through T3 Code's updater service, so the update button, menu and settings work
 * unchanged. "downloaded" is a staged build; Install hands over to the script.
 */

const REFRESH_INTERVAL = "1 minute";
/** Checks from these places merge and build; the rest only read what is already staged. */
const SYNC_REASONS: ReadonlySet<string> = new Set(["menu", "web-ui"]);

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("t3zip-updater");

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopState = yield* DesktopState.DesktopState;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const fileSystem = yield* FileSystem.FileSystem;

  const cacheDirectory = environment.path.join(
    environment.homeDirectory,
    "Library",
    "Caches",
    "t3zip",
  );
  const stagedPath = environment.path.join(cacheDirectory, "staged.json");
  const attentionPath = environment.path.join(cacheDirectory, "attention.json");

  const baseState = createInitialDesktopUpdateState(
    environment.appVersion,
    environment.runtimeInfo,
    "nightly",
  );
  const stateRef = yield* Ref.make<DesktopUpdateState>(baseState);
  const availableRef = yield* Ref.make(false);
  const checkingRef = yield* Ref.make(false);
  const installingRef = yield* Ref.make(false);
  const checkedAtRef = yield* Ref.make<string | null>(null);
  const installRefusalRef = yield* Ref.make<string | null>(null);

  const stateChanges = yield* PubSub.sliding<DesktopUpdateState>(16);
  // Serialize writes and publishes against subscription so snapshots cannot overlap a change.
  const stateMutex = yield* Semaphore.make(1);

  const emitState = Ref.get(stateRef).pipe(
    Effect.flatMap((state) => electronWindow.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, state)),
  );

  const readFile = (path: string) => fileSystem.readFileString(path, "utf-8").pipe(Effect.option);

  /** Rereads the script's files and publishes the state when it changed. */
  const refresh: Effect.Effect<DesktopUpdateState> = Effect.gen(function* () {
    if (!(yield* Ref.get(availableRef))) return yield* Ref.get(stateRef);
    const next = resolveT3ZipUpdateState({
      base: baseState,
      staged: yield* readFile(stagedPath),
      attention: yield* readFile(attentionPath),
      checking: yield* Ref.get(checkingRef),
      checkedAt: yield* Ref.get(checkedAtRef),
      installRefusal: yield* Ref.get(installRefusalRef),
    });
    const previous = yield* Ref.get(stateRef);
    if (sameT3ZipUpdateState(previous, next)) return previous;
    yield* stateMutex.withPermits(1)(
      Ref.set(stateRef, next).pipe(Effect.andThen(PubSub.publish(stateChanges, next))),
    );
    yield* emitState;
    return next;
  });

  /** Merges, checks and builds in the background, then shows what came of it. */
  const startSync = Effect.gen(function* () {
    if (yield* Ref.getAndSet(checkingRef, true)) return;
    yield* logInfo("starting a merge and build");
    yield* Effect.promise(() => startT3ZipUpdateScript("sync")).pipe(
      Effect.tap((code) => logInfo("merge and build finished", { code })),
      Effect.andThen(Ref.set(checkingRef, false)),
      Effect.andThen(DateTime.now),
      Effect.tap((now) => Ref.set(checkedAtRef, DateTime.formatIso(now))),
      Effect.andThen(refresh),
      Effect.forkDetach,
    );
  });

  const refused = (state: DesktopUpdateState) => ({
    accepted: false,
    completed: false,
    failed: false,
    state,
  });

  const install = Effect.gen(function* () {
    const state = yield* refresh;
    if (state.status !== "downloaded" || (yield* Ref.get(installingRef))) return refused(state);

    // Ask the script first, so a click while a build is being prepared says why.
    const check = yield* Effect.promise(() => runT3ZipUpdateScript("can-install"));
    if (check.code !== 0) {
      yield* logInfo("install refused", { reason: check.output });
      yield* Ref.set(
        installRefusalRef,
        check.output.length > 0 ? check.output : "The update could not be installed right now.",
      );
      const withReason = yield* refresh;
      // The reason is shown once; the next refresh drops it.
      yield* Ref.set(installRefusalRef, null);
      return { accepted: true, completed: false, failed: true, state: withReason };
    }

    yield* Ref.set(installingRef, true);
    yield* logInfo("handing the install to the update script", {
      version: state.downloadedVersion,
    });
    yield* Effect.promise(() =>
      startT3ZipUpdateScript("install", { T3ZIP_UPDATE_FROM_APP: "1" }),
    ).pipe(
      // Reached only when the script ended without closing this app, so the click can be retried.
      Effect.tap((code) => logWarning("the install ended without restarting the app", { code })),
      Effect.andThen(Ref.set(installingRef, false)),
      Effect.andThen(refresh),
      Effect.forkDetach,
    );
    return { accepted: true, completed: false, failed: false, state };
  });

  return DesktopUpdates.DesktopUpdates.of({
    getState: Ref.get(stateRef),
    isActionActive: Effect.zipWith(
      Ref.get(checkingRef),
      Ref.get(installingRef),
      (checking, installing) => checking || installing,
    ),
    isInstallActive: Ref.get(installingRef),
    subscribe: stateMutex.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(stateChanges);
        const latest = yield* Ref.get(stateRef);
        return { latest, changes: Stream.fromSubscription(subscription) };
      }),
    ),
    emitState,
    disabledReason: Ref.get(stateRef).pipe(
      Effect.map((state) => (state.enabled ? Option.none() : Option.fromNullishOr(state.message))),
    ),
    configure: Effect.gen(function* () {
      const scriptExists = yield* fileSystem
        .exists(T3_ZIP_UPDATE_SCRIPT)
        .pipe(Effect.orElseSucceed(() => false));
      yield* Ref.set(availableRef, scriptExists);
      // Stays off: it lets servers and other devices ask this app for an upstream release,
      // which T3 Zip never installs. The button in this window does not need it.
      yield* Ref.set(desktopState.canInstallUpdates, false);
      if (!scriptExists) {
        yield* logWarning("the update script is missing", { path: T3_ZIP_UPDATE_SCRIPT });
        yield* Ref.set(stateRef, {
          ...baseState,
          message: `T3 Zip updates need ${T3_ZIP_UPDATE_SCRIPT}, which is missing.`,
        });
        yield* emitState;
        return;
      }
      yield* refresh;
      yield* Effect.sleep(REFRESH_INTERVAL).pipe(
        Effect.andThen(refresh),
        Effect.forever,
        Effect.forkScoped,
      );
    }),
    // T3 Zip has one track: the newest upstream nightly merged into the fork.
    setChannel: Effect.fn("desktop.t3zipUpdates.setChannel")(function* () {
      return yield* Ref.get(stateRef);
    }),
    check: Effect.fn("desktop.t3zipUpdates.check")(function* (reason: string) {
      yield* Effect.annotateCurrentSpan({ reason });
      const current = yield* refresh;
      if (!current.enabled) return { checked: false, state: current };
      if (current.status !== "downloaded" && SYNC_REASONS.has(reason)) yield* startSync;
      return { checked: true, state: yield* refresh };
    }),
    // Nothing is downloaded: the script builds ahead of time.
    download: Ref.get(stateRef).pipe(
      Effect.map((state) => ({
        accepted: false,
        completed: state.status === "downloaded",
        state,
      })),
    ),
    install: install.pipe(
      Effect.map(({ accepted, completed, state }) => ({ accepted, completed, state })),
      Effect.withSpan("desktop.t3zipUpdates.install"),
    ),
    installPrepared: Effect.fn("desktop.t3zipUpdates.installPrepared")(function* (expectedVersion) {
      const state = yield* refresh;
      if (state.downloadedVersion !== expectedVersion) return refused(state);
      return yield* install;
    }),
  });
});

export const layer = Layer.effect(DesktopUpdates.DesktopUpdates, make);
