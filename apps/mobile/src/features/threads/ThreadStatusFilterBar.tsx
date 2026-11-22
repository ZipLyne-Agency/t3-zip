import type { ThreadStatusFilterCounts } from "@t3tools/client-runtime/state/thread-status-filter";
import { useGT } from "gt-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import type { ThreadListStatusFilter } from "../../persistence/mobile-preferences";

const FILTERS: readonly ThreadListStatusFilter[] = ["all", "waiting", "working", "done"];

/** Each filter's count takes its status color, as the rows' status labels do. */
const COUNT_CLASS: Record<ThreadListStatusFilter, string> = {
  all: "text-foreground",
  waiting: "text-warning-foreground",
  working: "text-adaptive-sky-600-400",
  done: "text-adaptive-emerald-700-300",
};

/**
 * Four equal tiles above the thread list: All, Needs You, Working and Done, each with its count
 * over its label. Equal widths and a fixed count line keep the bar still as counts change, and
 * a label at a large text size shrinks to fit instead of cutting off.
 */
export const ThreadStatusFilterBar = memo(function ThreadStatusFilterBar(props: {
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
    }
  };
  const count = (filter: ThreadListStatusFilter) =>
    filter === "all" ? props.openCount : props.counts[filter];
  const sidebar = props.pane === "sidebar";
  return (
    <View
      accessibilityRole="tablist"
      className={cn(
        "flex-row gap-1 rounded-2xl p-1",
        sidebar ? "mx-2 mb-2 mt-1 bg-adaptive-neutral-950-a5-white-a5" : "mx-5 mb-3 bg-subtle",
      )}
    >
      {FILTERS.map((filter) => {
        const selected = props.selected === filter;
        const value = count(filter);
        const name = label(filter);
        return (
          <Pressable
            key={filter}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={gt("{name}, {count, plural, one {# thread} other {# threads}}", {
              name,
              count: value,
            })}
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
              className={cn(
                "font-t3-bold",
                value === 0 && !selected ? "text-foreground-tertiary" : COUNT_CLASS[filter],
              )}
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {value}
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
