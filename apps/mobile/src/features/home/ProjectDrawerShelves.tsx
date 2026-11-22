import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useGT } from "gt-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { RowPressable } from "../../components/ui/RowPressable";
import { useFormattingLocale } from "../../i18n/I18nProvider";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { THREAD_LIST_V2_SETTLED_PAGE_COUNT } from "../threads/threadListV2";
import type { DrawerShelfKind } from "./drawer-shelves";
import { isIndefiniteProjectSnooze } from "./project-drawer";
import type { ProjectSwitcherRow } from "./project-switcher";
import type { ProjectDrawerData } from "./useProjectDrawer";

const SETTLED_FIRST_PAGE = 25;
const SHELF_ICONS: Record<DrawerShelfKind, AppSymbolName> = {
  snoozed: "moon.zzz",
  muted: "bell.slash",
  settled: "checkmark.circle",
  hidden: "eye.slash",
};

/**
 * The Settled shelf's rows: local settled threads, then older pages read from the server while
 * the panel is open, as the thread list's Settled shelf reads them.
 */
export function useDrawerSettledShelf(drawer: ProjectDrawerData, open: boolean) {
  const [visibleCount, setVisibleCount] = useState(SETTLED_FIRST_PAGE);
  const shelf = useOlderSettledShelf({
    scopes: drawer.shelves.settledScopes,
    expanded: open,
    visibleCount,
  });
  const listed = drawer.shelves.settled.filter(shelf.isListed);
  useOlderSettledShelfGrowth(shelf, listed);
  const count = listed.length + shelf.unloadedCount(drawer.shelves.scopeThreads);
  const threads = listed.slice(0, visibleCount);
  return {
    threads,
    count,
    loading: shelf.loading,
    failed: shelf.failed,
    hasMore: threads.length < count,
    showMore: () => setVisibleCount((current) => current + THREAD_LIST_V2_SETTLED_PAGE_COUNT),
    retry: shelf.retry,
  };
}

export type DrawerSettledShelf = ReturnType<typeof useDrawerSettledShelf>;

export function shelfCounts(
  drawer: ProjectDrawerData,
  settled: DrawerSettledShelf,
): Record<DrawerShelfKind, number> {
  return {
    snoozed: drawer.shelves.snoozed.length + drawer.model.snoozed.length,
    muted: drawer.shelves.muted.length,
    settled: settled.count,
    hidden: drawer.model.hidden.length,
  };
}

export function useShelfTitles(): Record<DrawerShelfKind, { tile: string; panel: string }> {
  const gt = useGT();
  return {
    snoozed: { tile: gt("Snoozed"), panel: gt("Snoozed") },
    muted: { tile: gt("Muted"), panel: gt("Muted Threads") },
    settled: { tile: gt("Settled"), panel: gt("Settled Threads") },
    hidden: { tile: gt("Hidden"), panel: gt("Hidden Projects") },
  };
}

/** The four shelves under the project list, each a tile that opens its list in the drawer. */
export function DrawerShelfTiles(props: {
  readonly counts: Record<DrawerShelfKind, number>;
  readonly onOpen: (kind: DrawerShelfKind) => void;
}) {
  const gt = useGT();
  const titles = useShelfTitles();
  const kinds: DrawerShelfKind[] = ["snoozed", "muted", "settled", "hidden"];
  return (
    <View className="flex-row gap-1.5 border-t border-border px-2 pt-2">
      {kinds.map((kind) => (
        <RowPressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={gt("{label}: {count}", {
            label: titles[kind].tile,
            count: props.counts[kind],
          })}
          onPress={() => props.onOpen(kind)}
          className="h-14 flex-1 items-center justify-center gap-0.5 rounded-xl bg-subtle"
        >
          <View className="flex-row items-center gap-1">
            <SymbolView
              name={SHELF_ICONS[kind]}
              size={14}
              tintColorClassName="accent-foreground-muted"
            />
            <AppText
              textRole="footnote"
              numberOfLines={1}
              className="font-t3-semibold text-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {props.counts[kind]}
            </AppText>
          </View>
          <AppText
            textRole="caption"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            className="px-1 text-foreground-muted"
          >
            {titles[kind].tile}
          </AppText>
        </RowPressable>
      ))}
    </View>
  );
}

function useUntilLabel() {
  const gt = useGT();
  const locale = useFormattingLocale();
  return (until: string, nowMs: number) => {
    const at = new Date(until);
    const withinWeek = at.getTime() - nowMs < 6 * 86_400_000;
    const time = at.toLocaleString(
      locale,
      withinWeek
        ? { weekday: "short", hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
    );
    return gt("Until {time}", { time });
  };
}

/** One shelf's list, shown in place of the project list at the same size. */
export function DrawerShelfPanel(props: {
  readonly kind: DrawerShelfKind;
  readonly drawer: ProjectDrawerData;
  readonly settled: DrawerSettledShelf;
  readonly bottomInset: number;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onPickProject: (row: ProjectSwitcherRow) => void;
}) {
  const gt = useGT();
  const untilLabel = useUntilLabel();
  const { drawer, settled } = props;
  const { nowMs } = drawer;
  const threadUntil = (until: string | null | undefined) =>
    until ? untilLabel(until, nowMs) : null;

  let body: ReactNode;
  let footer: ReactNode = null;
  switch (props.kind) {
    case "snoozed": {
      const projects = drawer.model.snoozed;
      const threads = drawer.shelves.snoozed;
      body =
        projects.length + threads.length === 0 ? (
          <ShelfEmpty>{gt("Nothing is snoozed.")}</ShelfEmpty>
        ) : (
          <>
            {projects.length > 0 ? <ShelfSubheading>{gt("Projects")}</ShelfSubheading> : null}
            {projects.map(({ row, until }) => (
              <ShelfProjectRow
                key={row.key}
                row={row}
                detail={
                  isIndefiniteProjectSnooze(until)
                    ? gt("Until You Wake It")
                    : untilLabel(until, nowMs)
                }
                actionLabel={gt("Wake")}
                onAction={() => drawer.apply({ kind: "wake", projectKey: row.key })}
                onOpen={() => props.onPickProject(row)}
              />
            ))}
            {threads.length > 0 ? <ShelfSubheading>{gt("Threads")}</ShelfSubheading> : null}
            {threads.map((thread) => (
              <ShelfThreadRow
                key={`${thread.environmentId}:${thread.id}`}
                thread={thread}
                detail={threadUntil(thread.snoozedUntil)}
                actionLabel={gt("Wake")}
                onAction={() => drawer.wakeThread(thread)}
                onOpen={() => props.onOpenThread(thread)}
              />
            ))}
          </>
        );
      break;
    }
    case "muted": {
      const threads = drawer.shelves.muted;
      body =
        threads.length === 0 ? (
          <ShelfEmpty>{gt("Nothing is muted.")}</ShelfEmpty>
        ) : (
          threads.map((thread) => (
            <ShelfThreadRow
              key={`${thread.environmentId}:${thread.id}`}
              thread={thread}
              detail={threadUntil(thread.mutedUntil) ?? gt("Until Unmuted")}
              actionLabel={gt("Unmute")}
              onAction={() => drawer.unmuteThread(thread)}
              onOpen={() => props.onOpenThread(thread)}
            />
          ))
        );
      if (threads.length > 0) {
        footer = <ShelfFooterButton label={gt("Unmute All")} onPress={drawer.unmuteAll} />;
      }
      break;
    }
    case "settled": {
      body =
        settled.threads.length === 0 && !settled.loading ? (
          <ShelfEmpty>
            {settled.failed ? gt("Settled threads did not load.") : gt("Nothing is settled yet.")}
          </ShelfEmpty>
        ) : (
          settled.threads.map((thread) => (
            <ShelfThreadRow
              key={`${thread.environmentId}:${thread.id}`}
              thread={thread}
              detail={null}
              actionLabel={gt("Reopen")}
              onAction={() => drawer.reopenThread(thread)}
              onOpen={() => props.onOpenThread(thread)}
            />
          ))
        );
      footer = settled.failed ? (
        <ShelfFooterButton label={gt("Try Again")} onPress={settled.retry} />
      ) : settled.hasMore ? (
        <ShelfFooterButton
          label={settled.loading ? gt("Loading…") : gt("Show More")}
          disabled={settled.loading}
          onPress={settled.showMore}
        />
      ) : null;
      break;
    }
    case "hidden": {
      const projects = drawer.model.hidden;
      body =
        projects.length === 0 ? (
          <ShelfEmpty>{gt("Nothing is hidden.")}</ShelfEmpty>
        ) : (
          projects.map((row) => (
            <ShelfProjectRow
              key={row.key}
              row={row}
              detail={null}
              actionLabel={gt("Show")}
              onAction={() => drawer.apply({ kind: "show", projectKey: row.key })}
              onOpen={() => props.onPickProject(row)}
            />
          ))
        );
      break;
    }
  }

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          gap: 2,
          paddingHorizontal: 8,
          paddingBottom: footer === null ? props.bottomInset + 8 : 8,
        }}
      >
        {body}
      </ScrollView>
      {footer === null ? null : (
        <View
          className="flex-row justify-end border-t border-border px-3 pt-2"
          style={{ paddingBottom: props.bottomInset }}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

function ShelfSubheading(props: { readonly children: ReactNode }) {
  return (
    <AppText
      textRole="label"
      accessibilityRole="header"
      numberOfLines={1}
      className="px-3 pb-1.5 pt-3.5 font-t3-medium text-foreground-muted"
    >
      {props.children}
    </AppText>
  );
}

function ShelfEmpty(props: { readonly children: ReactNode }) {
  return (
    <AppText textRole="body" className="px-3 py-4 text-foreground-muted">
      {props.children}
    </AppText>
  );
}

function ShelfFooterButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      className="h-11 items-center justify-center rounded-full bg-secondary px-5 active:opacity-70"
    >
      <AppText
        textRole="footnote"
        numberOfLines={1}
        className="font-t3-medium text-secondary-foreground"
      >
        {props.label}
      </AppText>
    </Pressable>
  );
}

/** A row that opens its thread or project, with its one action beside it, not inside it. */
function ShelfRowFrame(props: {
  readonly accessibilityLabel: string;
  readonly leading?: ReactNode;
  readonly title: string;
  readonly detail: string | null;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <View className="min-h-[52px] flex-row items-center gap-1">
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        onPress={props.onOpen}
        className="min-h-[52px] flex-1 flex-row items-center gap-3 rounded-xl px-3"
      >
        {props.leading}
        <View className="min-w-0 flex-1">
          <AppText textRole="body" numberOfLines={1} className="font-t3-medium text-foreground">
            {props.title}
          </AppText>
          {props.detail === null ? null : (
            <AppText textRole="label" numberOfLines={1} className="text-foreground-muted">
              {props.detail}
            </AppText>
          )}
        </View>
      </RowPressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.actionLabel}, ${props.title}`}
        onPress={props.onAction}
        className="h-11 min-w-[72px] items-center justify-center rounded-full bg-secondary px-3 active:opacity-70"
      >
        <AppText
          textRole="footnote"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          className="font-t3-medium text-secondary-foreground"
        >
          {props.actionLabel}
        </AppText>
      </Pressable>
    </View>
  );
}

function ShelfThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly detail: string | null;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <ShelfRowFrame
      accessibilityLabel={
        props.detail === null ? props.thread.title : `${props.thread.title}, ${props.detail}`
      }
      title={props.thread.title}
      detail={props.detail}
      actionLabel={props.actionLabel}
      onAction={props.onAction}
      onOpen={props.onOpen}
    />
  );
}

function ShelfProjectRow(props: {
  readonly row: ProjectSwitcherRow;
  readonly detail: string | null;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly onOpen: () => void;
}) {
  const { project } = props.row;
  return (
    <ShelfRowFrame
      accessibilityLabel={
        props.detail === null ? props.row.title : `${props.row.title}, ${props.detail}`
      }
      leading={
        project ? (
          <ProjectFavicon
            environmentId={project.environmentId}
            faviconPath={project.faviconPath}
            projectIcon={project.projectIcon}
            size={28}
            projectTitle={project.title}
            workspaceRoot={project.workspaceRoot}
          />
        ) : null
      }
      title={props.row.title}
      detail={props.detail}
      actionLabel={props.actionLabel}
      onAction={props.onAction}
      onOpen={props.onOpen}
    />
  );
}
