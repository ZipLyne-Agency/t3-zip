import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { View } from "react-native";

// RN Modals move native window focus and close the keyboard. Keep composer menus in-window.
type Entries = ReadonlyMap<number, ReactNode>;

let nextKey = 0;

function allocateKey() {
  return nextKey++;
}

interface OverlayStore {
  readonly set: (key: number, node: ReactNode) => void;
  readonly delete: (key: number) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Entries;
}

function createOverlayStore(): OverlayStore {
  const entries = new Map<number, ReactNode>();
  const listeners = new Set<() => void>();
  let snapshot: Entries = new Map();
  const emit = () => {
    snapshot = new Map(entries);
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    set: (key, node) => {
      entries.set(key, node);
      emit();
    },
    delete: (key) => {
      entries.delete(key);
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}

const rootStore = createOverlayStore();
const OverlayStoreContext = createContext<OverlayStore>(rootStore);

export function OverlayPortal(props: { readonly children: ReactNode }) {
  const [key] = useState(allocateKey);
  const store = use(OverlayStoreContext);

  // RN has no createPortal, so projecting into the out-of-tree host has to
  // happen after commit. No dependency array: re-project after every render so
  // the host always shows the current content (menus re-render while open —
  // drill-in, theme).
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- projects children into the out-of-tree overlay host store after every commit
  useEffect(() => {
    store.set(key, props.children);
  });

  // Removal is unmount-only: deleting on every re-projection would move the
  // entry to the end of the map and restack it above overlays opened later.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- removes this entry from the overlay host store on unmount
  useEffect(() => () => store.delete(key), [key, store]);

  return null;
}

function OverlayHost(props: { readonly store: OverlayStore }) {
  const current = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );

  if (current.size === 0) {
    return null;
  }
  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      {[...current.entries()].map(([key, node]) => (
        <View key={key} pointerEvents="box-none" className="absolute inset-0">
          {node}
        </View>
      ))}
    </View>
  );
}

export function OverlayPortalHost() {
  return <OverlayHost store={rootStore} />;
}

/**
 * Overlays opened inside an RN Modal, which is its own native window: the app's host sits in the
 * window below it, so menus and sheets opened in the Modal show in this scope's host instead.
 * Render it as the Modal's full-size content.
 */
export function OverlayPortalScope(props: { readonly children: ReactNode }) {
  const [store] = useState(createOverlayStore);
  return (
    <OverlayStoreContext value={store}>
      {props.children}
      <OverlayHost store={store} />
    </OverlayStoreContext>
  );
}
