import { DEFAULT_SIDEBAR_LAYOUT, SidebarLayout } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { msg, useGT, useMessages } from "gt-react";

import { SettingResetButton, SettingsRow } from "../settings/settingsLayout";
import { useSearchableSetting } from "../settings/settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "../settings/useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const SIDEBAR_LAYOUT_LABELS: Record<SidebarLayout, string> = {
  "project-rail": msg("Project Rail"),
  classic: msg("Classic", { $context: "sidebar layout" }),
};
const isSidebarLayout = Schema.is(SidebarLayout);

/** Settings > General > Sidebar: picks the project rail or the classic thread list. */
export function SidebarLayoutSettingsRow() {
  const sidebarLayout = useScopedSettings((settings) => settings.sidebarLayout);
  const updateSettings = useUpdateScopedSettings();
  const setting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  return (
    <SettingsRow
      {...setting("sidebar-layout")}
      description={gt(
        "Project Rail lists your projects with what needs you, in your own order and folders. Classic lists every thread. Narrow windows always use Classic.",
      )}
      resetAction={
        sidebarLayout !== DEFAULT_SIDEBAR_LAYOUT ? (
          <SettingResetButton
            ariaLabel={gt("Reset sidebar layout to default")}
            onClick={() => updateSettings({ sidebarLayout: DEFAULT_SIDEBAR_LAYOUT })}
          />
        ) : null
      }
      control={
        <Select
          value={sidebarLayout}
          onValueChange={(value) => {
            if (isSidebarLayout(value)) updateSettings({ sidebarLayout: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={gt("Sidebar layout")}>
            <SelectValue>{m(SIDEBAR_LAYOUT_LABELS[sidebarLayout])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {SidebarLayout.literals.map((layout) => (
              <SelectItem hideIndicator key={layout} value={layout}>
                {m(SIDEBAR_LAYOUT_LABELS[layout])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
