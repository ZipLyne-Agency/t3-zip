import { describe, expect, it } from "vite-plus/test";

import { installConfirmationMessage, restartContinuation, updateIdleTooltip } from "./t3ZipUpdate";

const version = { availableVersion: null, downloadedVersion: "0.1.10-nightly.20261116.4800" };

describe("installConfirmationMessage", () => {
  it("says running threads continue when the setting is on", () => {
    expect(installConfirmationMessage(version, "all", "T3 Zip")).toBe(
      "Install update 0.1.10-nightly.20261116.4800 and restart T3 Zip?\n\nRunning threads stop for the restart and continue when T3 Zip reopens. Commands they had running start over.",
    );
  });

  it("does not promise a continue the setting turns off", () => {
    expect(installConfirmationMessage(version, "none", "T3 Zip")).toContain("stay stopped");
    expect(installConfirmationMessage(version, "some", "T3 Zip")).toContain(
      "the rest stay stopped",
    );
  });

  it("keeps T3 Code's own wording", () => {
    expect(installConfirmationMessage(version, "all", "T3 Code")).toContain("restart T3 Code?");
  });
});

describe("restartContinuation", () => {
  const settings = (global: boolean, project?: boolean) =>
    ({
      continueThreadsAfterServerUpdate: global,
      projectSettingsOverrides:
        project === undefined ? {} : { p1: { continueThreadsAfterServerUpdate: project } },
    }) as unknown as Parameters<typeof restartContinuation>[0];

  it("reads the setting and any project that differs from it", () => {
    expect(restartContinuation(settings(true))).toBe("all");
    expect(restartContinuation(settings(false))).toBe("none");
    expect(restartContinuation(settings(true, false))).toBe("some");
    expect(restartContinuation(settings(false, true))).toBe("some");
    expect(restartContinuation(settings(true, true))).toBe("all");
  });
});

describe("updateIdleTooltip", () => {
  it("names the problem that stopped the last update", () => {
    expect(
      updateIdleTooltip({
        enabled: true,
        status: "error",
        errorContext: "check",
        message: "Merging v0.1.11 conflicts in: apps/web/src/a.ts. Nothing changed.",
      }),
    ).toEqual({
      title: "Last update did not finish",
      detail: "Merging v0.1.11 conflicts in: apps/web/src/a.ts. Nothing changed.",
    });
  });

  it("offers a check otherwise", () => {
    expect(
      updateIdleTooltip({ enabled: true, status: "up-to-date", errorContext: null, message: null }),
    ).toEqual({ title: "Check for updates", detail: null });
  });
});
