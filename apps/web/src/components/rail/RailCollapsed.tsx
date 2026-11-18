import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { SidebarMenu } from "../ui/sidebar";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { NoProjectPosition, RailRowEntry } from "./railLayout.logic";
import {
  addRailCounts,
  EMPTY_RAIL_COUNTS,
  railNeedsLabel,
  summarizeRailFolder,
} from "./railStatus.logic";
import type { RailProject } from "./useRailModel";
import { NoProjectChip } from "./RailRows";

function Badge(props: {
  label: string;
  detail: string;
  needs: number;
  working: boolean;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const accessibleLabel = [
    props.label,
    props.needs > 0 ? railNeedsLabel(props.needs) : null,
    props.working ? "working" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={accessibleLabel}
            aria-current={props.selected ? "true" : undefined}
            data-selected={props.selected}
            onClick={props.onClick}
            className="relative mx-auto flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[selected=true]:bg-sidebar-row-selected"
          />
        }
      >
        {props.children}
        {props.needs > 0 ? (
          // The tinted count sits on an opaque sidebar disc so the icon under it never shows through.
          <span aria-hidden className="absolute -top-1 -right-1 rounded-full bg-sidebar">
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/24 px-1 text-3xs font-semibold tabular-nums text-warning-foreground ring-1 ring-inset ring-warning/50">
              {props.needs}
            </span>
          </span>
        ) : null}
        {props.working ? (
          <span
            aria-hidden
            className="absolute right-1 bottom-1 size-2 rounded-full bg-info ring-2 ring-sidebar"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="right">
        <span className="block font-medium">{props.label}</span>
        <span className="block text-xs opacity-80">{props.detail}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

function ProjectBadge(props: {
  project: RailProject;
  selected: boolean;
  onOpen: (projectKey: string) => void;
}) {
  const { group, counts, summary } = props.project;
  return (
    <Badge
      label={group.displayName}
      detail={summary}
      needs={counts.needs}
      working={counts.working > 0}
      selected={props.selected}
      onClick={() => props.onOpen(group.projectKey)}
    >
      <ProjectFavicon project={group} className="size-5" />
    </Badge>
  );
}

function Divider() {
  return <hr aria-hidden className="mx-3 my-1 border-sidebar-border" />;
}

/**
 * The folded rail: one badge per project with its needs-you count and a working dot, folder
 * names as small labels, and a divider before loose projects and before No Project.
 */
export function RailCollapsed(props: {
  entries: readonly RailRowEntry[];
  projects: ReadonlyMap<string, RailProject>;
  noProject: RailProject | null;
  showNoProject: boolean;
  noProjectPosition: NoProjectPosition;
  selectedProjectKey: string | null;
  onOpenProject: (projectKey: string) => void;
  onOpenNoProject: () => void;
  onToggleFolder: (folderId: string) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const noProjectSelected =
    props.noProject !== null && props.selectedProjectKey === props.noProject.group.projectKey;
  const noProjectBadge = props.showNoProject ? (
    <Badge
      label={gt("No Project")}
      detail={props.noProject?.summary ?? gt("No open threads")}
      needs={props.noProject?.counts.needs ?? 0}
      working={(props.noProject?.counts.working ?? 0) > 0}
      selected={noProjectSelected}
      onClick={props.onOpenNoProject}
    >
      <NoProjectChip className="size-6" />
    </Badge>
  ) : null;

  const items: ReactNode[] = [];
  let previous: RailRowEntry["kind"] | null = null;
  for (const entry of props.entries) {
    if (entry.kind === "project") {
      const project = props.projects.get(entry.projectKey);
      if (!project) continue;
      if (previous === "folder") items.push(<Divider key={`divider:${entry.projectKey}`} />);
      items.push(
        <ProjectBadge
          key={entry.projectKey}
          project={project}
          selected={props.selectedProjectKey === entry.projectKey}
          onOpen={props.onOpenProject}
        />,
      );
      previous = "project";
      continue;
    }
    const projects = entry.projectKeys.flatMap((key) => props.projects.get(key) ?? []);
    items.push(
      <p
        key={`label:${entry.folderId}`}
        className="mt-1.5 truncate px-1 text-center text-3xs font-semibold uppercase tracking-wide text-sidebar-muted-foreground"
      >
        {entry.name}
      </p>,
    );
    if (entry.collapsed) {
      const counts = projects.reduce(
        (total, project) => addRailCounts(total, project.counts),
        EMPTY_RAIL_COUNTS,
      );
      items.push(
        <Badge
          key={`folder:${entry.folderId}`}
          label={entry.name}
          detail={summarizeRailFolder(projects.length, counts)}
          needs={counts.needs}
          working={counts.working > 0}
          selected={projects.some(
            (project) => project.group.projectKey === props.selectedProjectKey,
          )}
          onClick={() => props.onToggleFolder(entry.folderId)}
        >
          <span className="text-xs font-semibold text-sidebar-muted-foreground">
            {projects.length}
          </span>
        </Badge>,
      );
    } else {
      for (const project of projects) {
        items.push(
          <ProjectBadge
            key={project.group.projectKey}
            project={project}
            selected={props.selectedProjectKey === project.group.projectKey}
            onOpen={props.onOpenProject}
          />,
        );
      }
    }
    previous = "folder";
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The sidebar toggle floats over the top of the window, so the badges start below it. */}
      <div aria-hidden className="h-(--workspace-topbar-height) shrink-0" />
      {props.noProjectPosition === "top" && noProjectBadge ? (
        <div className="flex shrink-0 flex-col pb-1">
          {noProjectBadge}
          <Divider />
        </div>
      ) : null}
      <ScrollArea hideScrollbars scrollFade className="min-h-0 flex-1">
        <nav aria-label={gt("Projects")} className="flex flex-col gap-1 py-1">
          {items}
        </nav>
      </ScrollArea>
      <div className={cn("flex shrink-0 flex-col gap-1 pt-1 pb-3")}>
        {props.noProjectPosition === "bottom" && noProjectBadge ? (
          <>
            <Divider />
            {noProjectBadge}
          </>
        ) : null}
        <Divider />
        {/* The classic footer's update control is a round icon, so it fits the folded rail. */}
        <SidebarMenu className="items-center [&>li]:ml-0">
          <SidebarUpdatePill />
        </SidebarMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Settings")}
                onClick={() => void navigate({ to: "/settings" })}
                className="mx-auto flex size-10 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <SettingsIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="right">
            <T>Settings</T>
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}
