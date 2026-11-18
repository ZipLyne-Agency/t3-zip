import { Atom } from "effect/reactivity";

import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { environmentPresentations } from "../../state/presentation";
import type { SidebarProviderEntry } from "../sidebar/SidebarThreadRow";

/**
 * Providers per environment, for the rows the rail's thread search shows. The classic sidebar
 * keeps its own copy inside `Sidebar.tsx`; the rail has this one so it never imports that file,
 * which stays identical to upstream.
 */
export const railProviderEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  return deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
}).pipe(Atom.withLabel("rail-provider-entries"));

export const EMPTY_RAIL_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
