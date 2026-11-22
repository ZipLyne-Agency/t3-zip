import type { MenuAction } from "@react-native-menu/menu";
import { describe, expect, it } from "vite-plus/test";

import {
  projectDrawerFolderMenu,
  projectDrawerProjectMenu,
  readFolderMenuEvent,
  readProjectMenuEvent,
} from "./project-drawer-menu";

const base = {
  layoutActions: true,
  favorite: false,
  canMoveUp: true,
  canMoveDown: false,
  folders: [
    { folderId: "f1", name: "Work" },
    { folderId: "f2", name: "Play" },
  ],
  folderId: "f2",
  snoozePresets: [{ id: "later", label: "Later Today", whenLabel: "6:00 PM" }],
} as const;

function outline(actions: ReadonlyArray<MenuAction>): unknown[] {
  return actions.map((action) =>
    action.subactions
      ? {
          [action.displayInline ? `inline:${action.title}` : action.title]: outline(
            action.subactions,
          ),
        }
      : `${action.title}${action.state === "on" ? " ✓" : ""}${action.attributes?.disabled ? " (off)" : ""}`,
  );
}

describe("project drawer menus", () => {
  it("draws desktop's project menu, with its dividers as inline groups on iOS", () => {
    expect(outline(projectDrawerProjectMenu({ ...base, platform: "ios" }))).toEqual([
      { "inline:": ["New Thread", "Rename", "Add to Favorites"] },
      { "inline:": ["Move Up", "Move Down (off)"] },
      { "inline:": [{ "inline:Folder": ["Work", "Play ✓", "No Folder"] }, "New Folder…"] },
      {
        "inline:": [
          { "Snooze Project": ["Until I Wake It", "Later Today", "Custom…"] },
          "Hide Project",
        ],
      },
    ]);
  });

  it("lists the same items in order on Android, with folders and snooze as submenus", () => {
    expect(
      outline(
        projectDrawerProjectMenu({ ...base, favorite: true, folderId: null, platform: "android" }),
      ),
    ).toEqual([
      "New Thread",
      "Rename",
      "Remove from Favorites",
      "Move Up",
      "Move Down (off)",
      { Folder: ["Work", "Play", "No Folder ✓"] },
      "New Folder…",
      { "Snooze Project": ["Until I Wake It", "Later Today", "Custom…"] },
      "Hide Project",
    ]);
  });

  it("offers only New Thread and Rename without the shared layout", () => {
    expect(
      outline(projectDrawerProjectMenu({ ...base, layoutActions: false, platform: "ios" })),
    ).toEqual(["New Thread", "Rename"]);
  });

  it("draws desktop's folder menu", () => {
    expect(
      outline(projectDrawerFolderMenu({ platform: "ios", canMoveUp: false, canMoveDown: true })),
    ).toEqual([
      { "inline:": ["Rename"] },
      { "inline:": ["Move Up (off)", "Move Down"] },
      { "inline:": ["Remove Folder"] },
    ]);
  });

  it("reads every menu event back", () => {
    expect(readProjectMenuEvent("folder:f1")).toEqual({ kind: "folder", folderId: "f1" });
    expect(readProjectMenuEvent("folder:none")).toEqual({ kind: "folder", folderId: null });
    expect(readProjectMenuEvent("snooze:forever")).toEqual({ kind: "snooze-forever" });
    expect(readProjectMenuEvent("snooze:custom")).toEqual({ kind: "snooze-custom" });
    expect(readProjectMenuEvent("snooze:later")).toEqual({
      kind: "snooze-preset",
      event: "snooze:later",
    });
    expect(readProjectMenuEvent("favorite:off")).toEqual({ kind: "favorite", favorite: false });
    expect(readProjectMenuEvent("group-0")).toBeNull();
    expect(readFolderMenuEvent("remove")).toEqual({ kind: "remove" });
  });
});
