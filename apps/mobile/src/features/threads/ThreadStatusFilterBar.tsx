import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ThreadStatusFilterCounts } from "@t3tools/client-runtime/state/thread-status-filter";
import { useGT } from "gt-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import type { ThreadListStatusFilter } from "../../persistence/mobile-preferences";

/** Each filter's count takes its status color, as the rows' status labels do. */
const COUNT_CLASS: Record<"all" | "waiting" | "working" | "done", string> = {
  all: "text-foreground",
  waiting: "text-warning-foreground",
  working: "text-adaptive-sky-600-400",
  done: "text-adaptive-emerald-700-300",
};

/**
 * Equal tiles above the thread list, each with its count over its label: All, Waiting, Working
 * and Done, or for one project All, Waiting and Working · Done with both counts. Equal widths
 * and a fixed count line keep the bar still as counts change, and a label at a large text size
 * shrinks to fit instead of cutting off.
 */
export const ThreadStatusFilterBar = memo(function ThreadStatusFilterBar(props: {
  readonly filters: ReadonlyArray<ThreadListStatusFilter>;
  readonly selected: ThreadListStatusFilter;
  readonly counts: ThreadStatusFilterCounts;
  /** Open threads in scope, the All tile's count. */
  readonly openCount: number;
  readonly onSelect: (filter: ThreadListStatusFilter) => void;
  readonly pane?: "screen" | "sidebar";
}) {
  const gt = useGT();
  const label = (filter: ThreadListStatusFilter) => {
    switch (filter) {
      case "all":
        return gt("All", { $context: "thread list filter: every open thread" });
      case "waiting":
        return gt("Waiting", { $context: "thread list filter: threads waiting on you" });
      case "working":
        return gt("Working", { $context: "thread list filter: running threads" });
      case "done":
        return gt("Done", { $context: "thread list filter: finished threads" });
      case "workingDone":
        return gt("Working · Done", {
          $context: "thread list filter: running and finished threads together, for one project",
        });
    }
  };
  const count = (filter: "all" | "waiting" | "working" | "done") =>
    filter === "all" ? props.openCount : props.counts[filter];
  const countText = (filter: "all" | "waiting" | "working" | "done", selected: boolean) => {
    const value = count(filter);
    return (
      <AppText
        className={cn(
          "font-t3-bold",
          value === 0 && !selected ? "text-foreground-tertiary" : COUNT_CLASS[filter],
        )}
      >
        {value}
      </AppText>
    );
  };
  const sidebar = props.pane === "sidebar";
  return (
    <View
      accessibilityRole="tablist"
      className={cn(
        "flex-row gap-1 rounded-2xl p-1",
        sidebar ? "mx-2 mb-2 mt-1 bg-adaptive-neutral-950-a5-white-a5" : "mx-5 mb-3 bg-subtle",
      )}
    >
      {props.filters.map((filter) => {
        const selected = props.selected === filter;
        const name = label(filter);
        return (
          <Pressable
            key={filter}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              filter === "workingDone"
                ? gt("Working: {working}, Done: {done}", {
                    working: props.counts.working,
                    done: props.counts.done,
                  })
                : gt("{name}, {count, plural, one {# thread} other {# threads}}", {
                    name,
                    count: count(filter),
                  })
            }
            onPress={() => props.onSelect(filter)}
            className={cn(
              "min-h-[52px] flex-1 items-center justify-center rounded-xl border px-1 py-1.5 active:opacity-70",
              // A solid neutral one step past the track, so the pick shows in light and dark.
              selected ? "border-border bg-adaptive-neutral-200-800" : "border-transparent",
            )}
          >
            <AppText
              textRole="headline"
              numberOfLines={1}
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {filter === "workingDone" ? (
                <>
                  {countText("working", selected)}
                  <AppText className="text-foreground-tertiary">{" · "}</AppText>
                  {countText("done", selected)}
                </>
              ) : (
                countText(filter, selected)
              )}
            </AppText>
            <AppText
              textRole="caption"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              className={cn(
                "font-t3-medium",
                selected ? "text-foreground" : "text-foreground-muted",
              )}
            >
              {name}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
});

/**
 * Done's New and Opened headings, drawn like the list's other section headings. The first one
 * carries Clear All, which clears every thread Done lists.
 */
export const ThreadStatusSectionHeader = memo(function ThreadStatusSectionHeader(props: {
  readonly section: "new" | "opened";
  readonly count: number;
  readonly clearAllCount: number;
  readonly onClearAll: () => void;
  readonly pane?: "screen" | "sidebar";
}) {
  const gt = useGT();
  const sidebar = props.pane === "sidebar";
  const label =
    props.section === "new"
      ? gt("New", { $context: "Done section: finished threads you have not opened" })
      : gt("Opened", { $context: "Done section: finished threads you opened but not cleared" });
  return (
    <View
      className={cn(
        "mt-4 mb-1.5 min-h-[28px] flex-row items-center gap-2.5",
        sidebar ? "px-3" : "px-5",
      )}
    >
      <AppText
        accessibilityRole="header"
        numberOfLines={1}
        className={cn(
          "text-xs font-t3-medium",
          sidebar ? "text-drawer-foreground-muted" : "text-foreground-tertiary",
        )}
      >
        {label}
        {"  "}
        <AppText
          className="text-xs font-t3-medium text-foreground-tertiary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {props.count}
        </AppText>
      </AppText>
      <View className={cn("h-px flex-1", sidebar ? "bg-drawer-border" : "bg-border")} />
      {props.clearAllCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt(
            "{count, plural, one {Clear # thread from Done} other {Clear all # threads from Done}}",
            { count: props.clearAllCount },
          )}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          onPress={props.onClearAll}
          className="min-h-[28px] justify-center active:opacity-60"
        >
          <AppText
            numberOfLines={1}
            className="text-xs font-t3-semibold text-adaptive-emerald-700-300"
          >
            {gt("Clear All", { $context: "button: clear every finished thread from Done" })}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
});

const PROJECT_ICON_SIZE = 16;

/** A project's name and thread count over its threads inside a Done heading, as on desktop. */
export const ThreadStatusProjectHeader = memo(function ThreadStatusProjectHeader(props: {
  readonly title: string | null;
  readonly project: EnvironmentProject | null;
  readonly scratch: boolean;
  readonly count: number;
  readonly pane?: "screen" | "sidebar";
}) {
  const gt = useGT();
  const sidebar = props.pane === "sidebar";
  const title = props.title ?? gt("Unknown Project");
  const { project } = props;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={gt("{title}, {count, plural, one {# thread} other {# threads}}", {
        title,
        count: props.count,
      })}
      className={cn("mt-2 min-h-[28px] flex-row items-center gap-2", sidebar ? "px-3" : "px-5")}
    >
      {project && !props.scratch ? (
        <ProjectFavicon
          environmentId={project.environmentId}
          faviconPath={project.faviconPath}
          projectIcon={project.projectIcon}
          size={PROJECT_ICON_SIZE}
          projectTitle={project.title}
          workspaceRoot={project.workspaceRoot}
        />
      ) : (
        <View
          className="items-center justify-center rounded bg-subtle-strong"
          style={{ width: PROJECT_ICON_SIZE, height: PROJECT_ICON_SIZE }}
        >
          <SymbolView name="circle.dashed" size={11} tintColorClassName="accent-foreground-muted" />
        </View>
      )}
      <AppText
        numberOfLines={1}
        className={cn(
          "shrink text-[13px] font-t3-medium",
          sidebar ? "text-drawer-foreground" : "text-foreground-secondary",
        )}
      >
        {title}
      </AppText>
      <AppText
        className="text-xs font-t3-medium text-foreground-tertiary"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {props.count}
      </AppText>
    </View>
  );
});
