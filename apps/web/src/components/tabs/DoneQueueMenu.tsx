import { useAtomValue } from "@effect/atom-react";
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { nextRailQueueKey, railQueueAge } from "../rail/railQueue.logic";
import type { RailQueueItem } from "../rail/useRailQueue";
import { TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

/**
 * Finished threads in every project, the longest-waiting first. Open Next goes to the oldest
 * one that is not open already; the rest open from the list. Hidden while nothing is done.
 */
export function DoneQueueMenu(props: {
  readonly items: ReadonlyArray<RailQueueItem>;
  readonly activeKey: string | null;
  readonly nowMs: number;
  readonly onOpen: (item: RailQueueItem) => void;
}) {
  const { items, activeKey, nowMs, onOpen } = props;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const gt = useGT();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const nextKey = nextRailQueueKey(items, activeKey);
  const next = items.find((item) => item.key === nextKey) ?? null;
  const nextShortcut = shortcutLabelForCommand(keybindings, "thread.nextDone");

  const choose = (item: RailQueueItem) => {
    setOpen(false);
    onOpen(item);
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            className="shrink-0"
            size="xs"
            variant="ghost-muted"
            aria-label={gt(
              "Done, {count, plural, one {{count} thread} other {{count} threads}} finished",
              { count: items.length },
            )}
          />
        }
      >
        <TopStatusIcon icon="done" className="size-3.5 text-success-foreground" />
        <T>Done</T>
        <span className="text-success-foreground tabular-nums">{items.length}</span>
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="w-80">
        {next ? (
          <>
            <MenuItem onClick={() => choose(next)}>
              <ArrowRightIcon aria-hidden className="size-3.5" />
              <span className="min-w-0 flex-1 truncate font-medium">
                <T>Open Next</T>
              </span>
              {nextShortcut ? <MenuItemDetail>{nextShortcut}</MenuItemDetail> : null}
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel className="flex items-center justify-between">
            <span>
              <T>Oldest First</T>
            </span>
            <span className="tabular-nums">{items.length}</span>
          </MenuGroupLabel>
          <div className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <MenuItem
                key={item.key}
                data-active-tab={item.key === activeKey ? "true" : undefined}
                onClick={() => choose(item)}
                className="items-start"
              >
                <TopStatusIcon icon="done" className="mt-0.5 size-3.5 text-success-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate", item.key === activeKey && "font-medium")}>
                    {item.thread.title}
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {item.projectName ?? gt("Unknown project")}
                  </span>
                </span>
                <MenuItemDetail>{railQueueAge(item.sinceMs, nowMs)}</MenuItemDetail>
              </MenuItem>
            ))}
          </div>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
