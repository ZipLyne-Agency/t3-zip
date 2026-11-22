import type { MenuAction } from "@react-native-menu/menu";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

/**
 * The project and folder long-press menus, in the desktop rail's order and labels. iOS draws
 * desktop's dividers as inline groups. Android's menu has no dividers and only one level of
 * submenus, so it lists the groups one after another and keeps the folder and snooze choices
 * in submenus.
 */
type Platform = "ios" | "android";

const NO_FOLDER = "folder:none";

export type ProjectMenuEvent =
  | { readonly kind: "new-thread" }
  | { readonly kind: "rename" }
  | { readonly kind: "favorite"; readonly favorite: boolean }
  | { readonly kind: "move"; readonly direction: "up" | "down" }
  | { readonly kind: "folder"; readonly folderId: string | null }
  | { readonly kind: "new-folder" }
  | { readonly kind: "snooze-forever" }
  | { readonly kind: "snooze-custom" }
  /** A preset: `event` is what the snooze helpers read (`snooze:<preset id>`). */
  | { readonly kind: "snooze-preset"; readonly event: string }
  | { readonly kind: "hide" };

export type FolderMenuEvent =
  | { readonly kind: "rename" }
  | { readonly kind: "move"; readonly direction: "up" | "down" }
  | { readonly kind: "remove" };

function grouped(platform: Platform, groups: ReadonlyArray<ReadonlyArray<MenuAction>>) {
  const filled = groups.filter((group) => group.length > 0);
  if (platform === "android" || filled.length === 1) return filled.flat();
  return filled.map((subactions, index): MenuAction => ({
    id: `group-${index}`,
    title: "",
    displayInline: true,
    subactions: [...subactions],
  }));
}

function moveActions(
  input: { readonly canMoveUp: boolean; readonly canMoveDown: boolean },
  resolve: MessageResolver,
): MenuAction[] {
  return [
    {
      id: "move-up",
      title: resolve(msg("Move Up")),
      image: "arrow.up",
      attributes: { disabled: !input.canMoveUp },
    },
    {
      id: "move-down",
      title: resolve(msg("Move Down")),
      image: "arrow.down",
      attributes: { disabled: !input.canMoveDown },
    },
  ];
}

export function projectDrawerProjectMenu(
  input: {
    readonly platform: Platform;
    /** False without a shared rail or without settings access: only New Thread and Rename. */
    readonly layoutActions: boolean;
    readonly favorite: boolean;
    readonly canMoveUp: boolean;
    readonly canMoveDown: boolean;
    readonly folders: ReadonlyArray<{ readonly folderId: string; readonly name: string }>;
    readonly folderId: string | null;
    readonly snoozePresets: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly whenLabel: string;
    }>;
  },
  resolve: MessageResolver = m,
): MenuAction[] {
  const top: MenuAction[] = [
    { id: "new-thread", title: resolve(msg("New Thread")), image: "square.and.pencil" },
    { id: "rename", title: resolve(msg("Rename")), image: "pencil" },
  ];
  if (!input.layoutActions) return top;
  top.push(
    input.favorite
      ? { id: "favorite:off", title: resolve(msg("Remove from Favorites")), image: "star.slash" }
      : { id: "favorite:on", title: resolve(msg("Add to Favorites")), image: "star" },
  );
  const folderChoices: MenuAction[] = [
    ...input.folders.map((folder): MenuAction => ({
      id: `folder:${folder.folderId}`,
      title: folder.name,
      state: folder.folderId === input.folderId ? "on" : "off",
    })),
    {
      id: NO_FOLDER,
      title: resolve(msg("No Folder")),
      state: input.folderId === null ? "on" : "off",
    },
  ];
  const folderTitle = resolve(
    msg("Folder", { $context: "menu group: the folder a project is in" }),
  );
  const newFolder: MenuAction = {
    id: "new-folder",
    title: resolve(msg("New Folder…")),
    image: "folder.badge.plus",
  };
  const snooze: MenuAction = {
    id: "snooze",
    title: resolve(msg("Snooze Project")),
    image: "moon.zzz",
    subactions: [
      { id: "snooze:forever", title: resolve(msg("Until I Wake It")) },
      ...input.snoozePresets.map((preset): MenuAction => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
      { id: "snooze:custom", title: resolve(msg("Custom…", { $context: "custom snooze time" })) },
    ],
  };
  const hide: MenuAction = {
    id: "hide",
    title: resolve(msg("Hide Project")),
    image: "eye.slash",
  };
  const folderGroup: MenuAction[] =
    input.platform === "ios"
      ? [
          { id: "folder", title: folderTitle, displayInline: true, subactions: folderChoices },
          newFolder,
        ]
      : [
          { id: "folder", title: folderTitle, image: "folder", subactions: folderChoices },
          newFolder,
        ];
  return grouped(input.platform, [top, moveActions(input, resolve), folderGroup, [snooze, hide]]);
}

export function projectDrawerFolderMenu(
  input: {
    readonly platform: Platform;
    readonly canMoveUp: boolean;
    readonly canMoveDown: boolean;
  },
  resolve: MessageResolver = m,
): MenuAction[] {
  return grouped(input.platform, [
    [{ id: "rename", title: resolve(msg("Rename")), image: "pencil" }],
    moveActions(input, resolve),
    [
      {
        id: "remove",
        title: resolve(msg("Remove Folder")),
        subtitle: resolve(msg("Its projects stay in the list.")),
        image: "folder.badge.minus",
      },
    ],
  ]);
}

export function readProjectMenuEvent(event: string): ProjectMenuEvent | null {
  switch (event) {
    case "new-thread":
      return { kind: "new-thread" };
    case "rename":
      return { kind: "rename" };
    case "favorite:on":
      return { kind: "favorite", favorite: true };
    case "favorite:off":
      return { kind: "favorite", favorite: false };
    case "move-up":
      return { kind: "move", direction: "up" };
    case "move-down":
      return { kind: "move", direction: "down" };
    case "new-folder":
      return { kind: "new-folder" };
    case NO_FOLDER:
      return { kind: "folder", folderId: null };
    case "snooze:forever":
      return { kind: "snooze-forever" };
    case "snooze:custom":
      return { kind: "snooze-custom" };
    case "hide":
      return { kind: "hide" };
  }
  if (event.startsWith("folder:"))
    return { kind: "folder", folderId: event.slice("folder:".length) };
  if (event.startsWith("snooze:")) return { kind: "snooze-preset", event };
  return null;
}

export function readFolderMenuEvent(event: string): FolderMenuEvent | null {
  switch (event) {
    case "rename":
      return { kind: "rename" };
    case "move-up":
      return { kind: "move", direction: "up" };
    case "move-down":
      return { kind: "move", direction: "down" };
    case "remove":
      return { kind: "remove" };
  }
  return null;
}
