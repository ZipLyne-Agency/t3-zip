import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { resolveT3ZipUpdateState, versionOfTag } from "./t3ZipUpdateState.ts";
import { createInitialDesktopUpdateState } from "./updateMachine.ts";

const base = createInitialDesktopUpdateState(
  "0.1.9",
  { hostArch: "arm64", appArch: "arm64", runningUnderArm64Translation: false },
  "nightly",
);
const staged = JSON.stringify({ tag: "v0.1.10-nightly.20261116.4800", sha: "69ead95" });
const attention = JSON.stringify({ subject: "t3zip-update-conflict", message: "Merge conflicts." });
const none = {
  base,
  staged: Option.none<string>(),
  attention: Option.none<string>(),
  checking: false,
  checkedAt: null,
  installRefusal: null,
};

describe("resolveT3ZipUpdateState", () => {
  it("offers a staged build as ready to install", () => {
    const state = resolveT3ZipUpdateState({ ...none, staged: Option.some(staged) });
    expect(state.enabled).toBe(true);
    expect(state.status).toBe("downloaded");
    expect(state.downloadedVersion).toBe("0.1.10-nightly.20261116.4800");
    expect(state.message).toBeNull();
  });

  it("shows a staged build over an older problem and carries why a click did not install", () => {
    const state = resolveT3ZipUpdateState({
      ...none,
      staged: Option.some(staged),
      attention: Option.some(attention),
      installRefusal: "An update is being prepared. Try again in a few minutes.",
    });
    expect(state.status).toBe("downloaded");
    expect(state.message).toBe("An update is being prepared. Try again in a few minutes.");
  });

  it("reports the problem that stopped the last update", () => {
    const state = resolveT3ZipUpdateState({ ...none, attention: Option.some(attention) });
    expect(state.status).toBe("error");
    expect(state.errorContext).toBe("check");
    expect(state.message).toBe("Merge conflicts.");
    expect(state.downloadedVersion).toBeNull();
  });

  it("is checking while this app's check runs, then up to date", () => {
    expect(resolveT3ZipUpdateState({ ...none, checking: true }).status).toBe("checking");
    expect(resolveT3ZipUpdateState({ ...none, checkedAt: "2026-11-17T04:00:00.000Z" }).status).toBe(
      "up-to-date",
    );
    expect(resolveT3ZipUpdateState(none).status).toBe("idle");
  });

  it("ignores a file it cannot read", () => {
    const state = resolveT3ZipUpdateState({
      ...none,
      staged: Option.some("{ half a file"),
      attention: Option.some("[]"),
    });
    expect(state.status).toBe("idle");
  });
});

describe("versionOfTag", () => {
  it("drops the leading v", () => {
    expect(versionOfTag("v0.1.10-nightly.20261116.4800")).toBe("0.1.10-nightly.20261116.4800");
    expect(versionOfTag("0.1.10")).toBe("0.1.10");
  });
});
