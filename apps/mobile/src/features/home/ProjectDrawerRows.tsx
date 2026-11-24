import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { CustomSnoozeSheet } from "../threads/CustomSnoozeSheet";
import {
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozePresets,
} from "../threads/threadListV2";
import { INDEFINITE_PROJECT_SNOOZE_UNTIL, type ProjectDrawerItem } from "./project-drawer";
import {
  projectDrawerFolderMenu,
  projectDrawerProjectMenu,
  readFolderMenuEvent,
  readProjectMenuEvent,
} from "./project-drawer-menu";
import type { ProjectSwitcherRow } from "./project-switcher";
import type { ProjectDrawerData } from "./useProjectDrawer";

export const DRAWER_ICON_SIZE = 28;
const MENU_PLATFORM = Platform.OS === "android" ? "android" : "ios";

type Translate = ReturnType<typeof useGT>;

export function rowAccessibilityName(gt: Translate, row: ProjectSwitcherRow) {
  return gt("{name}, {count, plural, =0 {none need you} one {# needs you} other {# need you}}", {
    name: row.title,
    count: row.waitingCount,
  });
}

/** A row of the drawer: No Project, All Projects, or a project, with how many need the user. */
export function DrawerRow(props: {
  readonly row: ProjectSwitcherRow;
  readonly selected: boolean;
  readonly nowMs: number;
  readonly favorite?: boolean;
  /** A second line, such as why a search match is not in the list. */
  readonly detail?: string;
  /** Projects in a folder sit one step in, under the folder's name. */
  readonly indented?: boolean;
  readonly onPress: () => void;
  readonly onTouchStart?: () => void;
  readonly onLongPress?: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { row } = props;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={
        props.detail === undefined
          ? rowAccessibilityName(gt, row)
          : `${rowAccessibilityName(gt, row)}, ${props.detail}`
      }
      onPress={props.onPress}
      onTouchStart={props.onTouchStart}
      onLongPress={props.onLongPress}
      className={cn(
        "min-h-[52px] flex-row items-center gap-3 rounded-xl px-3",
        props.indented && "pl-6",
        props.selected && "bg-adaptive-neutral-200-800",
      )}
    >
      <RowIcon row={row} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1">
          <AppText
            textRole="body"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            className="shrink font-t3-medium text-foreground"
          >
            {row.title}
          </AppText>
          {props.favorite ? (
            <View accessibilityLabel={gt("Favorite")} accessible>
              <SymbolView name="star.fill" size={11} tintColorClassName="accent-foreground-muted" />
            </View>
          ) : null}
        </View>
        {props.detail === undefined ? null : (
          <AppText textRole="label" numberOfLines={1} className="text-foreground-muted">
            {props.detail}
          </AppText>
        )}
      </View>
      <CountPill count={row.waitingCount} />
      <AppText
        textRole="label"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        className="w-11 text-right text-foreground-muted"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {row.lastActiveMs === null
          ? ""
          : relativeTime(new Date(row.lastActiveMs).toISOString(), props.nowMs, m)}
      </AppText>
    </RowPressable>
  );
}

export function RowIcon(props: { readonly row: ProjectSwitcherRow }) {
  const { project } = props.row;
  if (props.row.kind === "project" && project) {
    return (
      <View
        className="items-center justify-center"
        style={{ width: DRAWER_ICON_SIZE, height: DRAWER_ICON_SIZE }}
      >
        <ProjectFavicon
          environmentId={project.environmentId}
          faviconPath={project.faviconPath}
          projectIcon={project.projectIcon}
          size={DRAWER_ICON_SIZE}
          projectTitle={project.title}
          workspaceRoot={project.workspaceRoot}
        />
      </View>
    );
  }
  return (
    <View
      className="items-center justify-center rounded-lg bg-subtle-strong"
      style={{ width: DRAWER_ICON_SIZE, height: DRAWER_ICON_SIZE }}
    >
      <SymbolView
        name={props.row.kind === "all" ? "square.grid.2x2" : "circle.dashed"}
        size={16}
        tintColorClassName="accent-foreground-muted"
      />
    </View>
  );
}

/** Threads that need the user; the slot keeps its width at zero so nothing beside it moves. */
export function CountPill(props: { readonly count: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="h-[22px] min-w-6 items-center justify-center rounded-full bg-warning px-[7px]"
      style={{ opacity: props.count > 0 ? 1 : 0 }}
    >
      <AppText
        textRole="label"
        numberOfLines={1}
        className="font-t3-semibold text-warning-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {props.count}
      </AppText>
    </View>
  );
}

/** A project in the rail's order; holding it opens the desktop rail's project menu. */
export function DrawerProjectRow(props: {
  readonly item: Extract<ProjectDrawerItem, { kind: "project" }>;
  readonly drawer: ProjectDrawerData;
  readonly selected: boolean;
  /** Favorites Only lists projects without their folders, so none sits indented. */
  readonly flat?: boolean;
  readonly onPick: () => void;
  /** New Thread leaves the drawer for the composer. */
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { item, drawer } = props;
  const { row } = item;
  const projectKey = row.key;
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const presets = drawer.snoozePresetsOf(row);
  const snoozePresets = resolveThreadListV2SnoozePresets(
    { secondary: drawer.layoutActions ? "snooze" : null, now: drawer.now, presets },
    m,
  );
  const actions = projectDrawerProjectMenu(
    {
      platform: MENU_PLATFORM,
      layoutActions: drawer.layoutActions,
      favorite: item.favorite,
      canMoveUp: item.canMoveUp,
      canMoveDown: item.canMoveDown,
      folders: drawer.model.folders,
      folderId: item.folderId,
      snoozePresets,
    },
    m,
  );
  const snooze = (until: string) => drawer.apply({ kind: "snooze", projectKey, until });

  const handleAction = (event: string) => {
    const action = readProjectMenuEvent(event);
    if (action === null) return;
    switch (action.kind) {
      case "new-thread":
        drawer.newThread(row);
        props.onClose();
        return;
      case "rename":
        Dialog.prompt({
          title: gt("Rename Project"),
          initialValue: row.title,
          confirmText: gt("Rename", { $context: "verb, confirms renaming a project" }),
          onConfirm: (title) => drawer.renameProject(row, title),
        });
        return;
      case "favorite":
        drawer.apply({ kind: "favorite", projectKey, favorite: action.favorite });
        return;
      case "move":
        drawer.apply({ kind: "step-project", projectKey, direction: action.direction });
        return;
      case "folder":
        drawer.apply({ kind: "set-folder", projectKey, folderId: action.folderId });
        return;
      case "new-folder":
        promptFolderName(gt("New Folder"), "", gt("Create"), (name) =>
          drawer.newFolder(projectKey, name),
        );
        return;
      case "snooze-forever":
        snooze(INDEFINITE_PROJECT_SNOOZE_UNTIL);
        return;
      case "snooze-custom":
        setCustomSnoozeOpen(true);
        return;
      case "snooze-preset": {
        const selection = resolveThreadListV2SnoozeMenuSelection({
          event: action.event,
          displayedPresets: snoozePresets,
          now: new Date(),
          presets,
        });
        if (selection._tag === "selected") snooze(selection.preset.snoozedUntil);
        else if (selection._tag === "expired") {
          Dialog.alert(
            gt("Could not snooze project"),
            gt("That snooze time has passed. Choose another time."),
          );
        }
        return;
      }
      case "hide":
        drawer.apply({ kind: "hide", projectKey });
        return;
    }
  };

  return (
    <View collapsable={false}>
      {customSnoozeOpen ? (
        <CustomSnoozeSheet onClose={() => setCustomSnoozeOpen(false)} onSnooze={snooze} />
      ) : null}
      <Menu
        accessibilityLabel={rowAccessibilityName(gt, row)}
        actions={actions}
        onPressAction={({ nativeEvent }) => handleAction(nativeEvent.event)}
        shouldOpenOnLongPress
      >
        <DrawerRow
          row={row}
          selected={props.selected}
          nowMs={drawer.nowMs}
          favorite={item.favorite}
          indented={!props.flat && item.folderId !== null}
          onPress={props.onPick}
        />
      </Menu>
    </View>
  );
}

function promptFolderName(
  title: string,
  initialValue: string,
  confirmText: string,
  onName: (name: string) => void,
) {
  Dialog.prompt({
    title,
    initialValue,
    confirmText,
    onConfirm: (value) => {
      const name = value.trim();
      if (name !== "") onName(name);
    },
  });
}

/** A folder: tap folds it on this device; holding it opens the desktop rail's folder menu. */
export function DrawerFolderRow(props: {
  readonly item: Extract<ProjectDrawerItem, { kind: "folder" }>;
  readonly drawer: ProjectDrawerData;
}) {
  const gt = useGT();
  const m = useMessages();
  const { item, drawer } = props;
  const expanded = !item.collapsed;
  const handleAction = (event: string) => {
    const action = readFolderMenuEvent(event);
    if (action === null) return;
    switch (action.kind) {
      case "rename":
        promptFolderName(gt("Rename Folder"), item.name, gt("Rename"), (name) =>
          drawer.apply({ kind: "rename-folder", folderId: item.folderId, name }),
        );
        return;
      case "move":
        drawer.apply({ kind: "step-folder", folderId: item.folderId, direction: action.direction });
        return;
      case "remove":
        drawer.apply({ kind: "remove-folder", folderId: item.folderId });
        return;
    }
  };
  const header = (
    <RowPressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={gt(
        "{name}, folder, {count, plural, one {# project} other {# projects}}",
        { name: item.name, count: item.projectCount },
      )}
      onPress={() => drawer.toggleFolder(item.folderId)}
      className="min-h-11 flex-row items-center gap-2 rounded-xl px-3"
    >
      <View className="w-4 items-center">
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
      <AppText
        textRole="footnote"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className="flex-1 font-t3-semibold text-foreground-muted"
      >
        {item.name}
      </AppText>
      {/* Folded, the folder carries its projects' count so nothing waiting goes unseen. */}
      <CountPill count={expanded ? 0 : item.waitingCount} />
    </RowPressable>
  );
  if (!drawer.layoutActions) return header;
  return (
    <Menu
      accessibilityLabel={item.name}
      actions={projectDrawerFolderMenu(
        { platform: MENU_PLATFORM, canMoveUp: item.canMoveUp, canMoveDown: item.canMoveDown },
        m,
      )}
      onPressAction={({ nativeEvent }) => handleAction(nativeEvent.event)}
      shouldOpenOnLongPress
    >
      {header}
    </Menu>
  );
}
