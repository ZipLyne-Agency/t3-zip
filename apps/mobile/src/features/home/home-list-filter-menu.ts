import type { EnvironmentId } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { msg } from "gt-react-native";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { m, type MessageResolver } from "../../i18n/messages";
import type { WorkspaceEnvironment } from "../../state/workspaceModel";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function homeListFilterEnvironments(environments: ReadonlyArray<WorkspaceEnvironment>) {
  return Arr.sort(
    environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.environmentLabel,
        connectionState: environment.connectionState,
      })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

export function buildHomeListFilterMenuItems(
  props: {
    readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
    readonly selectedEnvironmentId: EnvironmentId | null;
    readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
    /** The split-view sidebar's project filter; Home picks projects in its project switcher. */
    readonly projects?: ReadonlyArray<HomeListFilterMenuProject>;
    readonly selectedProjectKey?: string | null;
    readonly onProjectChange?: (projectKey: string | null) => void;
  },
  resolve: MessageResolver = m,
): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [
    {
      id: "environment",
      title: resolve(msg("Environment", { $context: "filter menu heading" })),
      items: [
        {
          id: "environment:all",
          title: resolve(msg("All environments")),
          subtitle: resolve(msg("Show threads from every environment")),
          selected: props.selectedEnvironmentId === null,
          onPress: () => props.onEnvironmentChange(null),
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          selected: props.selectedEnvironmentId === environment.environmentId,
          onPress: () => props.onEnvironmentChange(environment.environmentId),
        })),
      ],
    },
  ];

  const { onProjectChange } = props;
  if (props.projects && props.projects.length > 0 && onProjectChange) {
    items.push({
      id: "project",
      title: resolve(msg("Project", { $context: "filter menu heading" })),
      items: [
        {
          id: "project:all",
          title: resolve(msg("All projects")),
          subtitle: resolve(msg("Show threads from every project")),
          selected: (props.selectedProjectKey ?? null) === null,
          onPress: () => onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          id: `project:${project.key}`,
          title: project.label,
          selected: props.selectedProjectKey === project.key,
          onPress: () => onProjectChange(project.key),
        })),
      ],
    });
  }

  return items;
}
