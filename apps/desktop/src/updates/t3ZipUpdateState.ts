import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * What `scripts/t3zip-update.sh` leaves in `~/Library/Caches/t3zip` for T3 Zip to show on its
 * update button: a build that is ready to install, or the problem that stopped the last update.
 */
const StagedBuild = Schema.Struct({ tag: Schema.String, sha: Schema.String });
const Attention = Schema.Struct({ message: Schema.String });

const decodeStagedBuild = Schema.decodeUnknownOption(Schema.fromJsonString(StagedBuild));
const decodeAttention = Schema.decodeUnknownOption(Schema.fromJsonString(Attention));

export interface T3ZipUpdateFiles {
  /** Contents of `staged.json`, when a verified build is waiting. */
  readonly staged: Option.Option<string>;
  /** Contents of `attention.json`, when the last update needs someone. */
  readonly attention: Option.Option<string>;
}

export interface T3ZipUpdateInput extends T3ZipUpdateFiles {
  readonly base: DesktopUpdateState;
  /** A check started from this app is merging and building right now. */
  readonly checking: boolean;
  readonly checkedAt: string | null;
  /** Why the last click on Update did not install, shown once. */
  readonly installRefusal: string | null;
}

/** A nightly tag is `v0.1.10-nightly.20261116.4800`; the button shows it without the `v`. */
export function versionOfTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function resolveT3ZipUpdateState(input: T3ZipUpdateInput): DesktopUpdateState {
  const base: DesktopUpdateState = {
    ...input.base,
    enabled: true,
    checkedAt: input.checkedAt,
    availableVersion: null,
    downloadedVersion: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
  const staged = Option.flatMap(input.staged, decodeStagedBuild);
  if (Option.isSome(staged)) {
    const version = versionOfTag(staged.value.tag);
    return {
      ...base,
      status: "downloaded",
      availableVersion: version,
      downloadedVersion: version,
      message: input.installRefusal,
      canRetry: true,
    };
  }
  if (input.checking) return { ...base, status: "checking" };
  const attention = Option.flatMap(input.attention, decodeAttention);
  if (Option.isSome(attention)) {
    return { ...base, status: "error", errorContext: "check", message: attention.value.message };
  }
  return { ...base, status: input.checkedAt === null ? "idle" : "up-to-date" };
}

/** Whether two states show the same thing; only these fields ever change in T3 Zip. */
export function sameT3ZipUpdateState(left: DesktopUpdateState, right: DesktopUpdateState): boolean {
  return (
    left.enabled === right.enabled &&
    left.status === right.status &&
    left.downloadedVersion === right.downloadedVersion &&
    left.message === right.message &&
    left.checkedAt === right.checkedAt
  );
}
