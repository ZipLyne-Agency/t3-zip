import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { GlassView } from "expo-glass-effect";
import { useGT } from "gt-react-native";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { MaskedView } from "@expo/ui/community/masked-view";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { OverlayPortalScope } from "../../components/ui/OverlayPortal";
import { RowPressable } from "../../components/ui/RowPressable";
import { SearchField } from "../../components/ui/SearchField";
import { cn } from "../../lib/cn";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { DrawerShelfKind } from "./drawer-shelves";
import { favoriteProjectDrawerItems, visibleProjectDrawerItems } from "./project-drawer";
import {
  CountPill,
  DRAWER_ICON_SIZE,
  DrawerFolderRow,
  DrawerProjectRow,
  DrawerRow,
  RowIcon,
  rowAccessibilityName,
} from "./ProjectDrawerRows";
import {
  DrawerShelfPanel,
  DrawerShelfTiles,
  useDesktopUpdateNote,
  shelfCounts,
  useDrawerSettledShelf,
  useShelfTitles,
} from "./ProjectDrawerShelves";
import { DrawerSearchResults } from "./ProjectDrawerSearch";
import type { ProjectSwitcherRow } from "./project-switcher";
import type { ProjectDrawerData, ProjectSwitcherRows } from "./useProjectDrawer";

const ButtonGlass = withUniwind(GlassView, {
  style: { fromClassName: "className" },
  tintColor: { fromClassName: "tintColorClassName", styleProperty: "accentColor" },
});

const DRAWER_WIDTH_FRACTION = 0.84;
// Tablets and wide windows keep a phone-sized drawer.
const DRAWER_MAX_WIDTH = 420;
const DRAWER_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

/** The row the button names: the selected project, or All Projects when it is gone. */
export function currentProjectSwitcherRow(
  rows: ProjectSwitcherRows,
  selectedKey: string | null,
): ProjectSwitcherRow | null {
  return (
    [...rows.fixed, ...rows.recent].find((row) => row.key === selectedKey) ??
    rows.fixed.find((row) => row.kind === "all") ??
    null
  );
}

/**
 * The home screen's project picker when it sits in the list: a button naming the current project
 * and how many of its threads need the user, which opens a drawer of every project.
 */
export function ProjectSwitcher(props: { readonly drawer: ProjectDrawerData }) {
  const [open, setOpen] = useState(false);
  const current = currentProjectSwitcherRow(props.drawer.rows, props.drawer.selectedKey);
  if (!current) return null;
  return (
    <>
      <ProjectSwitcherButton row={current} open={open} onPress={() => setOpen(true)} />
      {open ? (
        <ProjectSwitcherDrawer drawer={props.drawer} onClosed={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** The button alone, for a header that opens the drawer its screen hosts. */
export function ProjectSwitcherButton(props: {
  readonly row: ProjectSwitcherRow;
  readonly open: boolean;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  const { themeAppearance } = useAppearancePreferences();
  const { row } = props;
  const content = (
    <>
      <RowIcon row={row} />
      <AppText
        textRole="body"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className="shrink font-t3-semibold text-foreground"
      >
        {row.title}
      </AppText>
      <CountPill count={row.waitingCount} />
    </>
  );
  const layout = "h-11 flex-row items-center gap-2.5 rounded-xl pl-2 pr-3";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("Switch Project, {scope}", {
        scope: rowAccessibilityName(gt, row),
      })}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      className="min-w-0 shrink active:opacity-70"
    >
      {NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <ButtonGlass isInteractive colorScheme={themeAppearance} className={layout}>
          {content}
        </ButtonGlass>
      ) : (
        <View className={cn(layout, "border border-border bg-subtle")}>{content}</View>
      )}
    </Pressable>
  );
}

interface DrawerProps {
  readonly drawer: ProjectDrawerData;
  readonly onClosed: () => void;
}

export function ProjectSwitcherDrawer(props: DrawerProps) {
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const closing = useRef(false);
  // A shelf's list shows in place of the projects; back returns to them before closing.
  const [panel, setPanel] = useState<DrawerShelfKind | null>(null);
  const { onClosed } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the Reanimated slide-in once the drawer mounts
  useEffect(() => {
    progress.set(withTiming(1, DRAWER_TIMING));
  }, [progress]);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    progress.set(
      withTiming(0, DRAWER_TIMING, (finished) => {
        if (finished === true) runOnJS(onClosed)();
      }),
    );
  };
  // A pick removes the drawer in the same render that switches the scope, with no slide-out, so
  // the tap closes it at once even while the new scope's threads are still rendering.
  const closeNow = () => {
    closing.current = true;
    onClosed();
  };
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => (panel === null ? close() : setPanel(null))}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* A Modal is its own native hierarchy, so it measures its own safe area. */}
        <SafeAreaProvider style={{ flex: 1 }}>
          {/* Menus and sheets opened in the drawer draw in its window, above it. */}
          <OverlayPortalScope>
            <DrawerBody
              {...props}
              panel={panel}
              onPanelChange={setPanel}
              progress={progress}
              drag={drag}
              onClose={close}
              onCloseNow={closeNow}
            />
          </OverlayPortalScope>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

function DrawerBody(
  props: DrawerProps & {
    readonly panel: DrawerShelfKind | null;
    readonly onPanelChange: (panel: DrawerShelfKind | null) => void;
    readonly progress: SharedValue<number>;
    readonly drag: SharedValue<number>;
    readonly onClose: () => void;
    readonly onCloseNow: () => void;
  },
) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { themeVariables } = useAppearancePreferences();
  const panelWidth = Math.min(Math.round(windowWidth * DRAWER_WIDTH_FRACTION), DRAWER_MAX_WIDTH);
  const searchRef = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState("");
  const { progress, drag, onClose: close, onCloseNow: closeNow, drawer, panel } = props;
  const settled = useDrawerSettledShelf(drawer, panel === "settled");
  const shelfTitles = useShelfTitles();
  const bottomInset = Math.max(insets.bottom, 12);

  // Closes first, so picking the project already shown, or All Projects, never waits on the switch.
  const pick = (projectKey: string | null) => {
    closeNow();
    drawer.onPick(projectKey);
  };
  const openThread = (thread: EnvironmentThreadShell) => {
    drawer.openThread(thread);
    close();
  };

  const handleSwipeEnd = useEffectEvent((translationX: number, velocityX: number) => {
    if (translationX < -panelWidth * 0.3 || velocityX < -600) close();
    else drag.set(withTiming(0, DRAWER_TIMING));
  });
  // Built once, so threads streaming in while the drawer is open never reset a swipe.
  const [swipeToClose] = useState(() =>
    Gesture.Pan()
      .activeOffsetX(-12)
      .failOffsetY([-14, 14])
      .onUpdate((event) => {
        drag.set(Math.min(0, event.translationX));
      })
      .onEnd((event) => {
        runOnJS(handleSwipeEnd)(event.translationX, event.velocityX);
      }),
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.get() - (1 - progress.get()) * (panelWidth + 24) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * Math.max(0, 1 + drag.get() / panelWidth),
  }));

  const searching = query.trim() !== "";
  const { favoritesOnly } = drawer;
  const listed = favoritesOnly
    ? favoriteProjectDrawerItems(drawer.model.items)
    : drawer.model.items;
  const items = visibleProjectDrawerItems(listed);

  return (
    <View className="flex-1">
      <Animated.View className="absolute inset-0" style={backdropStyle}>
        <Pressable
          className="flex-1 bg-backdrop"
          accessibilityRole="button"
          accessibilityLabel={gt("Close Projects")}
          onPress={close}
        />
      </Animated.View>
      <GestureDetector gesture={swipeToClose}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, width: panelWidth },
            panelStyle,
          ]}
        >
          <GlassSurface
            className="flex-1 bg-sheet"
            tintColorClassName="accent-sheet/20"
            fallbackColor={themeVariables["--color-sheet"]}
            style={{
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderTopRightRadius: 22,
              borderBottomRightRadius: 22,
              paddingTop: insets.top,
              paddingLeft: insets.left,
            }}
          >
            <View
              className={cn("h-14 flex-row items-center pr-2", panel === null ? "pl-5" : "pl-1")}
            >
              {panel === null ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("Back to Projects")}
                  onPress={() => props.onPanelChange(null)}
                  className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
                >
                  <SymbolView
                    name="chevron.left"
                    size={18}
                    tintColorClassName="accent-foreground"
                  />
                </Pressable>
              )}
              <AppText
                textRole="title"
                accessibilityRole="header"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                className="flex-1 font-t3-semibold text-foreground"
              >
                {panel !== null
                  ? shelfTitles[panel].panel
                  : favoritesOnly
                    ? gt("Favorites", { $context: "project switcher drawer title: favorites only" })
                    : gt("Projects", { $context: "project switcher drawer title" })}
              </AppText>
              {/* Only a shared layout has favorites; the title takes the space, so nothing moves. */}
              {panel === null && drawer.model.shared ? (
                <FavoritesOnlyButton
                  on={favoritesOnly}
                  favoriteCount={favoriteProjectDrawerItems(drawer.model.items).length}
                  onChange={drawer.setFavoritesOnly}
                />
              ) : null}
              {panel === null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("Close")}
                  onPress={close}
                  className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
                >
                  <SymbolView name="xmark" size={18} tintColorClassName="accent-foreground-muted" />
                </Pressable>
              ) : null}
            </View>
            {panel !== null ? (
              <DrawerShelfPanel
                kind={panel}
                drawer={drawer}
                settled={settled}
                bottomInset={bottomInset}
                onOpenThread={openThread}
                onPickProject={(row) => pick(row.key)}
              />
            ) : (
              <>
                <View className="flex-row px-3 pb-2">
                  <SearchField
                    autoFocus={false}
                    inputRef={searchRef}
                    accessibilityLabel={gt("Search projects and threads")}
                    clearAccessibilityLabel={gt("Clear search")}
                    placeholder={gt("Search", { $context: "search field placeholder" })}
                    value={query}
                    onChangeText={setQuery}
                  />
                </View>
                <MaskedView style={{ flex: 1 }} maskElement={<BottomFadeMask height={32} />}>
                  <ScrollView
                    className="flex-1"
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ gap: 2, paddingHorizontal: 8, paddingBottom: 24 }}
                  >
                    {drawer.onClearEnvironmentFilter ? (
                      <ClearEnvironmentFilterRow
                        onPress={() => {
                          drawer.onClearEnvironmentFilter?.();
                          close();
                        }}
                      />
                    ) : null}
                    {searching ? (
                      <DrawerSearchResults
                        drawer={drawer}
                        query={query}
                        onPickProject={pick}
                        onOpenThread={openThread}
                      />
                    ) : (
                      <>
                        {drawer.model.fixed.map((row) => (
                          <DrawerRow
                            key={row.key ?? "all"}
                            row={row}
                            selected={row.key === drawer.selectedKey}
                            nowMs={drawer.nowMs}
                            onPress={() => pick(row.key)}
                          />
                        ))}
                        {!drawer.model.shared && items.length > 0 ? (
                          <AppText
                            textRole="label"
                            accessibilityRole="header"
                            numberOfLines={1}
                            className="px-3 pb-1.5 pt-3.5 font-t3-medium text-foreground-muted"
                          >
                            {gt("Recent", {
                              $context: "project switcher: projects by last activity",
                            })}
                          </AppText>
                        ) : null}
                        {items.map((item) =>
                          item.kind === "folder" ? (
                            <DrawerFolderRow
                              key={`folder:${item.folderId}`}
                              item={item}
                              drawer={drawer}
                            />
                          ) : (
                            <DrawerProjectRow
                              key={`project:${item.row.key}`}
                              item={item}
                              flat={favoritesOnly}
                              drawer={drawer}
                              selected={item.row.key === drawer.selectedKey}
                              onPick={() => pick(item.row.key)}
                              onClose={close}
                            />
                          ),
                        )}
                        {favoritesOnly && items.length === 0 ? (
                          <AppText textRole="body" className="px-3 py-4 text-foreground-muted">
                            {gt("No favorites yet. Hold a project and choose Add to Favorites.")}
                          </AppText>
                        ) : null}
                      </>
                    )}
                  </ScrollView>
                </MaskedView>
                {drawer.model.shared ? null : <DesktopUpdateLine />}
                <View style={{ paddingBottom: bottomInset }}>
                  <DrawerShelfTiles
                    counts={shelfCounts(drawer, settled)}
                    onOpen={props.onPanelChange}
                  />
                </View>
              </>
            )}
          </GlassSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Until the Mac app shares its project layout, the drawer is a plain list; this says why.
 * It sits outside the scrolling list, so the list keeps its place when the layout arrives.
 */
function DesktopUpdateLine() {
  const note = useDesktopUpdateNote();
  return (
    <AppText textRole="footnote" className="px-5 pb-2 pt-1 text-foreground-muted">
      {note}
    </AppText>
  );
}

/** The desktop rail's star: lists only favorite projects, or every project again. */
function FavoritesOnlyButton(props: {
  readonly on: boolean;
  readonly favoriteCount: number;
  readonly onChange: (on: boolean) => void;
}) {
  const gt = useGT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.on }}
      accessibilityLabel={
        props.on
          ? gt("Show All Projects")
          : gt("Show Favorites Only ({count})", { count: props.favoriteCount })
      }
      onPress={() => props.onChange(!props.on)}
      className={cn(
        "h-11 w-11 items-center justify-center rounded-full active:opacity-60",
        props.on && "bg-subtle-strong",
      )}
    >
      <SymbolView
        name={props.on ? "star.fill" : "star"}
        size={18}
        tintColorClassName={props.on ? "accent-warning-foreground" : "accent-foreground-muted"}
      />
    </Pressable>
  );
}

function ClearEnvironmentFilterRow(props: { readonly onPress: () => void }) {
  const gt = useGT();
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={gt("Clear Environment Filter")}
      onPress={props.onPress}
      className="min-h-[52px] flex-row items-center gap-3 rounded-xl px-3"
    >
      <View
        className="items-center justify-center rounded-lg bg-subtle-strong"
        style={{ width: DRAWER_ICON_SIZE, height: DRAWER_ICON_SIZE }}
      >
        <SymbolView
          name="xmark.circle.fill"
          size={16}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
      <AppText
        textRole="body"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className="flex-1 font-t3-medium text-foreground"
      >
        {gt("Clear Environment Filter")}
      </AppText>
    </RowPressable>
  );
}

/** Fades the list out over its last rows, the cue that it scrolls, without painting a color. */
function BottomFadeMask(props: { readonly height: number }) {
  const gradientId = `project-switcher-fade-${useId().replaceAll(":", "")}`;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: "black" }} />
      <Svg width="100%" height={props.height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <Stop offset={0} stopColor="black" stopOpacity={1} />
            <Stop offset={1} stopColor="black" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
