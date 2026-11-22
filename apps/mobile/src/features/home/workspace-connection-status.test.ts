import { describe, expect, it } from "vite-plus/test";

import type { WorkspaceState } from "../../state/workspaceModel";
import { workspaceConnectionStatusPresentation } from "./workspace-connection-status";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasSyncingConnectedEnvironment: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("workspace connection status", () => {
  it.each([
    ["reconnecting", "Could not reach sleeping laptop"],
    ["error", "Could not reach sleeping laptop"],
  ] as const)(
    "keeps the brand while a secondary environment is %s (%s)",
    (connectionState, connectionError) => {
      const state = workspaceState({
        hasConnectingEnvironment: connectionState !== "error",
        hasPendingShellSnapshot: true,
        connectionError,
        connectingEnvironments:
          connectionState === "error"
            ? []
            : [
                {
                  environmentId: "environment-2" as never,
                  environmentLabel: "Sleeping laptop",
                  displayUrl: "",
                  isRelayManaged: false,
                  isEnabled: true,
                  connectionState,
                  connectionError,
                  connectionErrorTraceId: null,
                },
              ],
      });

      expect(workspaceConnectionStatusPresentation(state)).toBeNull();
    },
  );

  it("shows connected shell catch-up even while a secondary environment is unreachable", () => {
    const state = workspaceState({
      hasSyncingConnectedEnvironment: true,
      hasPendingShellSnapshot: true,
      hasConnectingEnvironment: true,
      connectionError: "Could not reach sleeping laptop",
      connectingEnvironments: [
        {
          environmentId: "environment-2" as never,
          environmentLabel: "Sleeping laptop",
          displayUrl: "",
          isRelayManaged: false,
          isEnabled: true,
          connectionState: "reconnecting",
          connectionError: "Could not reach sleeping laptop",
          connectionErrorTraceId: null,
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Syncing threads...",
      showsProgress: true,
      connectionTrouble: false,
    });
  });

  it("marks offline, reconnecting and failing as connection trouble, and loading as not", () => {
    const trouble = (overrides: Partial<WorkspaceState>) =>
      workspaceConnectionStatusPresentation(workspaceState(overrides))?.connectionTrouble;

    expect(trouble({ networkStatus: "offline" })).toBe(true);
    expect(
      trouble({
        hasReadyEnvironment: false,
        hasConnectingEnvironment: true,
        connectingEnvironments: [
          {
            environmentId: "environment-1" as never,
            environmentLabel: "Laptop",
            displayUrl: "",
            isRelayManaged: false,
            isEnabled: true,
            connectionState: "reconnecting",
            connectionError: null,
            connectionErrorTraceId: null,
          },
        ],
      }),
    ).toBe(true);
    expect(trouble({ hasReadyEnvironment: false, connectionError: "Could not reach laptop" })).toBe(
      true,
    );
    expect(trouble({ hasReadyEnvironment: false, hasLoadedShellSnapshot: true })).toBe(true);
    expect(
      trouble({
        hasReadyEnvironment: false,
        hasLoadedShellSnapshot: false,
        hasPendingShellSnapshot: true,
      }),
    ).toBe(false);
  });
});
