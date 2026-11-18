import type { CSSProperties } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClientSettings } from "../../hooks/useSettings";
import ThreadSidebar from "../Sidebar";
import type { SidebarRouteReveal } from "../sidebar/routeReveal";
import { ProjectRail } from "./ProjectRail";

// The sidebar sheet takes over below `md`; the rail is a desktop-width layout only.
const DESKTOP_QUERY = "(min-width: 768px)";

/** True when the left sidebar shows the project rail: the setting asks for it at desktop width. */
export function useProjectRailLayout(): boolean {
  const layout = useClientSettings((settings) => settings.sidebarLayout);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return layout === "project-rail" && desktop;
}

/**
 * Sidebar provider variables for the rail. Folded, it stays 64px wide, so page headers pad only
 * for the part of the floating sidebar toggle that reaches past it. Open, the classic inset
 * applies, so the sidebar header keeps the brand clear of the window controls and the toggle.
 * AppSidebarLayout sets `--rail-titlebar-content-left` on the provider only while folded.
 */
export const PROJECT_RAIL_PROVIDER_STYLE = {
  "--sidebar-width-icon": "4rem",
  "--workspace-titlebar-content-left":
    "var(--rail-titlebar-content-left, calc(var(--workspace-controls-left) + var(--workspace-titlebar-control-size) + var(--workspace-titlebar-control-gap)))",
} as CSSProperties;

export function AppSidebarBody(props: { routeReveal: SidebarRouteReveal }) {
  const projectRail = useProjectRailLayout();
  return projectRail ? <ProjectRail /> : <ThreadSidebar routeReveal={props.routeReveal} />;
}
