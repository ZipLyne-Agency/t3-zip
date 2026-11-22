import { useGT } from "gt-react-native";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";

const MARKER_SIZE = 13;

/**
 * A thread row's unsent-draft pen, in the amber of the list's Draft rows. Its slot stays reserved
 * when there is no draft, so typing in a thread never moves the row's time or status.
 */
export function UnsentDraftMarker(props: { readonly visible: boolean }) {
  const gt = useGT();
  return (
    <View
      accessible={props.visible}
      accessibilityRole="image"
      accessibilityLabel={props.visible ? gt("Unsent draft") : undefined}
      importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
      className="items-center justify-center"
      style={{ width: MARKER_SIZE, height: MARKER_SIZE }}
    >
      {props.visible ? (
        <SymbolView
          name="square.and.pencil"
          size={MARKER_SIZE}
          tintColorClassName="accent-adaptive-amber-700-300"
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </View>
  );
}
