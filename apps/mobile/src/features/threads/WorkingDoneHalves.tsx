import { useGT } from "gt-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/**
 * The combined Working · Done tab: Done fills the top half and Working the bottom half, each
 * with a fixed heading over its own scrolling list. The halves split the space evenly and never
 * resize with what they hold.
 */
export function WorkingDoneHalves(props: {
  readonly doneCount: number;
  readonly workingCount: number;
  readonly done: ReactNode;
  readonly working: ReactNode;
  readonly pane: "screen" | "sidebar";
}) {
  const gt = useGT();
  return (
    <View className="flex-1">
      <View style={{ flex: 1, flexBasis: 0 }}>
        <HalfHeading
          label={gt("Done", { $context: "thread list filter: finished threads" })}
          count={props.doneCount}
          countClassName="text-adaptive-emerald-700-300"
          pane={props.pane}
        />
        <View className="flex-1">{props.done}</View>
      </View>
      <View
        className={cn(
          "border-t",
          props.pane === "sidebar" ? "border-drawer-border" : "border-border",
        )}
        style={{ flex: 1, flexBasis: 0 }}
      >
        <HalfHeading
          label={gt("Working", { $context: "thread list filter: running threads" })}
          count={props.workingCount}
          countClassName="text-adaptive-sky-600-400"
          pane={props.pane}
        />
        <View className="flex-1">{props.working}</View>
      </View>
    </View>
  );
}

function HalfHeading(props: {
  readonly label: string;
  readonly count: number;
  readonly countClassName: string;
  readonly pane: "screen" | "sidebar";
}) {
  const sidebar = props.pane === "sidebar";
  return (
    <View className={cn("min-h-[36px] flex-row items-center gap-2", sidebar ? "px-3" : "px-5")}>
      <AppText
        accessibilityRole="header"
        textRole="footnote"
        numberOfLines={1}
        className={cn("font-t3-semibold", sidebar ? "text-drawer-foreground" : "text-foreground")}
      >
        {props.label}
      </AppText>
      <AppText
        textRole="footnote"
        className={cn(
          "font-t3-semibold",
          props.count === 0 ? "text-foreground-tertiary" : props.countClassName,
        )}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {props.count}
      </AppText>
    </View>
  );
}

/** What a half shows when it lists nothing: one short line. */
export function WorkingDoneHalfEmpty(props: {
  readonly children: string;
  readonly pane: "screen" | "sidebar";
}) {
  return (
    <AppText
      textRole="footnote"
      className={cn(
        "py-3",
        props.pane === "sidebar"
          ? "px-3 text-drawer-foreground-muted"
          : "px-5 text-foreground-muted",
      )}
    >
      {props.children}
    </AppText>
  );
}
