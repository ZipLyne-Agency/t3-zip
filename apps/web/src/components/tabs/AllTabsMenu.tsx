import { useAtomValue } from "@effect/atom-react";
import { BellOffIcon, ChevronDownIcon, SquarePenIcon } from "lucide-react";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../../keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSearchInput,
  MenuTrigger,
} from "../ui/menu";
import { muteEndLabel } from "./threadMute.logic";
import { groupAllTabs } from "./threadTabs.logic";
import { draftPenClassName, TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { useThreadMuteActions } from "./useThreadMuteActions";
import type { TabEntry } from "./useThreadTabs";

/** Every open tab of the project, grouped by what it needs from you, with a search box. */
export function AllTabsMenu(props: {
  readonly tabs: ReadonlyArray<TabEntry>;
  readonly activeKey: string | null;
  readonly nowMs: number;
  readonly onOpen: (tab: TabEntry) => void;
}) {
  const { tabs, nowMs, onOpen } = props;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { formatTime } = useThreadMuteActions();
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = groupAllTabs(tabs, query);
  const tabIndex = new Map(tabs.map((tab, index) => [tab.key, index]));
  const nextNeedsYou = shortcutLabelForCommand(keybindings, "thread.nextNeedsYou");
  const nextDone = shortcutLabelForCommand(keybindings, "thread.nextDone");
  const firstJump = shortcutLabelForCommand(keybindings, threadJumpCommandForIndex(0));
  const lastJump = shortcutLabelForCommand(
    keybindings,
    threadJumpCommandForIndex(Math.min(tabs.length, 9) - 1),
  );

  const choose = (tab: TabEntry) => {
    setOpen(false);
    onOpen(tab);
  };

  const sideText = (tab: TabEntry) => {
    if (tab.mute !== null) {
      return tab.mute.until === null
        ? gt("Until Unmuted")
        : gt("Until {end}", { end: muteEndLabel(tab.mute.until, nowMs, formatTime) });
    }
    const index = tabIndex.get(tab.key) ?? -1;
    return shortcutLabelForCommand(keybindings, threadJumpCommandForIndex(index));
  };

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <MenuTrigger
        render={
          <Button
            className="shrink-0"
            size="xs"
            variant="ghost-muted"
            aria-label={gt("All Tabs, {count} open", { count: tabs.length })}
          />
        }
      >
        <T>All Tabs</T>
        <span className="text-muted-foreground/80 tabular-nums">{tabs.length}</span>
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="w-80">
        <MenuSearchInput
          autoFocus
          value={query}
          placeholder={gt("Find a Thread")}
          aria-label={gt("Find a Thread")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const first = groups[0]?.items[0];
            if (!first) return;
            event.preventDefault();
            choose(first);
          }}
        />
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-center text-muted-foreground text-xs">
            {tabs.length === 0 ? gt("No open threads in this project.") : gt("No threads match.")}
          </p>
        ) : (
          groups.map((group) => (
            <MenuGroup key={group.label}>
              <MenuGroupLabel className="flex items-center justify-between">
                <span>{group.label}</span>
                <span className="tabular-nums">{group.items.length}</span>
              </MenuGroupLabel>
              {group.items.map((tab) => {
                const side = sideText(tab);
                return (
                  <MenuItem
                    key={tab.key}
                    data-active-tab={tab.key === props.activeKey ? "true" : undefined}
                    onClick={() => choose(tab)}
                  >
                    {tab.kind === "draft" ? (
                      <SquarePenIcon
                        aria-label={gt("Unsent draft")}
                        className={draftPenClassName}
                      />
                    ) : tab.icon !== null ? (
                      <TopStatusIcon
                        icon={tab.icon.icon}
                        className={cn("size-3.5", tab.icon.className)}
                      />
                    ) : (
                      <span aria-hidden className="size-3.5 shrink-0" />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        tab.key === props.activeKey && "font-medium",
                      )}
                    >
                      {tab.title}
                    </span>
                    {tab.mute !== null ? (
                      <BellOffIcon
                        aria-label={gt("Muted", { $context: "adjective, a muted thread" })}
                        className="size-3 text-muted-foreground"
                      />
                    ) : null}
                    {side ? <MenuItemDetail>{side}</MenuItemDetail> : null}
                  </MenuItem>
                );
              })}
            </MenuGroup>
          ))
        )}
        {firstJump || nextNeedsYou || nextDone ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 border-border/70 border-t px-2 pt-2 pb-1 text-muted-foreground text-xs">
            {firstJump && lastJump && tabs.length > 0 ? (
              <span>
                <T>
                  <Var>
                    {firstJump === lastJump
                      ? firstJump
                      : gt("{first} to {last}", { first: firstJump, last: lastJump })}
                  </Var>{" "}
                  Jump to Tab
                </T>
              </span>
            ) : null}
            {nextNeedsYou ? (
              <span>
                <T>
                  <Var>{nextNeedsYou}</Var> Next That Needs You
                </T>
              </span>
            ) : null}
            {nextDone ? (
              <span>
                <T>
                  <Var>{nextDone}</Var> Next Done
                </T>
              </span>
            ) : null}
          </div>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
