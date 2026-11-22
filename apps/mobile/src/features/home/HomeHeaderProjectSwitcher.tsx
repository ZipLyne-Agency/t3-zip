import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import type { ProjectSwitcherRow } from "./project-switcher";
import {
  currentProjectSwitcherRow,
  ProjectSwitcherButton,
  ProjectSwitcherDrawer,
} from "./ProjectSwitcher";
import type { ProjectDrawerData } from "./useProjectDrawer";
import { WorkspaceConnectionTroubleIcon } from "./WorkspaceConnectionTitle";

// The workspace root draws phone Home's header outside Home's tree. Only the button's row
// crosses up and an open flag crosses back; the drawer stays in Home. Context, unlike a
// subscription, still reaches native header views and hidden Android tabs.

interface SlotState {
  readonly current: ProjectSwitcherRow | null;
  readonly open: boolean;
}

interface SlotActions {
  readonly publish: (row: ProjectSwitcherRow | null) => void;
  readonly setOpen: (open: boolean) => void;
}

const SlotStateContext = createContext<SlotState>({ current: null, open: false });
const SlotActionsContext = createContext<SlotActions | null>(null);

function sameButtonRow(a: ProjectSwitcherRow | null, b: ProjectSwitcherRow | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.key === b.key &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.waitingCount === b.waitingCount &&
    a.project === b.project
  );
}

export function HomeHeaderProjectSwitcherProvider(props: { readonly children: ReactNode }) {
  const [current, setCurrent] = useState<ProjectSwitcherRow | null>(null);
  const [open, setOpen] = useState(false);
  // State setters are stable, so Home never re-renders for the header's state.
  const [actions] = useState<SlotActions>(() => ({
    publish: (row) => setCurrent((previous) => (sameButtonRow(previous, row) ? previous : row)),
    setOpen,
  }));
  return (
    <SlotActionsContext value={actions}>
      <SlotStateContext value={{ current, open }}>{props.children}</SlotStateContext>
    </SlotActionsContext>
  );
}

/**
 * Home's side: names the current row in the header and hosts the drawer the header opens.
 * Render it in every branch Home returns while the header holds the switcher.
 */
export function HomeHeaderProjectSwitcherHost(props: { readonly drawer: ProjectDrawerData }) {
  const actions = use(SlotActionsContext);
  const { open } = use(SlotStateContext);
  const { rows } = props.drawer;
  // With nothing but All Projects to pick, the header shows no switcher. Hidden and snoozed
  // projects count: the drawer is where they come back from.
  const hasChoices = rows.fixed.length + rows.recent.length > 1;
  const current = hasChoices ? currentProjectSwitcherRow(rows, props.drawer.selectedKey) : null;
  // The header keeps the last row after Home unmounts, so returning to the tab shows no gap.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the row the header button names to the provider above the navigator, which owns the header outside this tree
  useEffect(() => {
    actions?.publish(current);
  }, [actions, current]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a drawer left open when Home unmounts must not reopen when the tab returns
  useEffect(() => () => actions?.setOpen(false), [actions]);
  if (!open || !actions || !current) return null;
  return <ProjectSwitcherDrawer drawer={props.drawer} onClosed={() => actions.setOpen(false)} />;
}

/**
 * The header's leading side on phone Home: the switcher button, and an icon only while the
 * connection is in trouble. Before Home names a row the slot keeps the button's height.
 */
export function HomeHeaderProjectSwitcher(props: { readonly onOpenEnvironments: () => void }) {
  const actions = use(SlotActionsContext);
  const { current, open } = use(SlotStateContext);
  return (
    <View className="h-11 min-w-0 flex-1 flex-row items-center gap-1">
      {current && actions ? (
        <ProjectSwitcherButton row={current} open={open} onPress={() => actions.setOpen(true)} />
      ) : null}
      <WorkspaceConnectionTroubleIcon onPress={props.onOpenEnvironments} />
    </View>
  );
}
