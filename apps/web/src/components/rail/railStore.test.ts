import { describe, expect, it } from "vite-plus/test";

import { useProjectRailStore } from "./railStore";

describe("useProjectRailStore", () => {
  it("shows No Project at the bottom until the user moves it", () => {
    expect(useProjectRailStore.getState().noProjectPosition).toBe("bottom");
    useProjectRailStore.getState().setNoProjectPosition("top");
    expect(useProjectRailStore.getState().noProjectPosition).toBe("top");
  });

  it("places projects it has never seen at the end, then keeps the user's order", () => {
    const { updateLayout } = useProjectRailStore.getState();
    updateLayout(["a", "b"], (layout) => layout);
    expect(useProjectRailStore.getState().layout.top).toEqual(["p:a", "p:b"]);
    updateLayout(["a", "b", "c"], (layout) => ({ ...layout, top: [...layout.top].reverse() }));
    expect(useProjectRailStore.getState().layout.top).toEqual(["p:c", "p:b", "p:a"]);
  });

  it("opens the folder holding a project before a jump into it", () => {
    useProjectRailStore.getState().replaceLayout({
      top: ["f:work"],
      folders: { work: { name: "Work", collapsed: true, projects: ["a"] } },
    });
    useProjectRailStore.getState().revealProject("a");
    expect(useProjectRailStore.getState().layout.folders.work?.collapsed).toBe(false);
  });

  it("hides a project without moving it, and shows it again in the same folder", () => {
    const store = useProjectRailStore.getState();
    store.replaceLayout({
      top: ["f:work", "p:b"],
      folders: { work: { name: "Work", collapsed: false, projects: ["a", "c"] } },
    });
    const layout = useProjectRailStore.getState().layout;
    store.hideProject("a");
    expect(useProjectRailStore.getState().hiddenProjects).toEqual(["a"]);
    expect(useProjectRailStore.getState().layout).toBe(layout);
    store.showProject("a");
    expect(useProjectRailStore.getState().hiddenProjects).toEqual([]);
    expect(useProjectRailStore.getState().layout.folders.work?.projects).toEqual(["a", "c"]);
  });

  it("keeps favorites apart from the layout and from hidden projects", () => {
    const store = useProjectRailStore.getState();
    const layout = useProjectRailStore.getState().layout;
    store.setProjectFavorite("b", true);
    store.setProjectFavorite("b", true);
    expect(useProjectRailStore.getState().favoriteProjects).toEqual(["b"]);
    expect(useProjectRailStore.getState().layout).toBe(layout);
    expect(useProjectRailStore.getState().hiddenProjects).not.toContain("b");
    store.setProjectFavorite("b", false);
    expect(useProjectRailStore.getState().favoriteProjects).toEqual([]);
  });

  it("starts on All and remembers the chosen filter", () => {
    expect(useProjectRailStore.getState().filter).toBe("all");
    useProjectRailStore.getState().setFilter("working");
    expect(useProjectRailStore.getState().filter).toBe("working");
  });

  it("loads the old Favorites filter as All with Favorites Only on", () => {
    const merge = useProjectRailStore.persist.getOptions().merge!;
    const merged = merge(
      {
        layout: { top: [], folders: {} },
        noProjectPosition: "top",
        lastThreadByProject: {},
        filter: "favorites",
      },
      useProjectRailStore.getState(),
    );
    expect(merged.filter).toBe("all");
    expect(merged.favoritesOnly).toBe(true);
  });

  it("keeps folders, hidden projects and favorites when one saved value is unreadable", () => {
    const merge = useProjectRailStore.persist.getOptions().merge!;
    const layout = {
      top: ["f:folder-1"],
      folders: { "folder-1": { name: "Work", collapsed: false, projects: ["env:a"] } },
    };
    const merged = merge(
      {
        layout,
        noProjectPosition: "top",
        lastThreadByProject: {},
        hiddenProjects: ["env:b"],
        favoriteProjects: ["env:a"],
        // From a newer build; this build has no such filter.
        filter: "starred",
        threadColumnScope: { scope: 42 },
      },
      // What the store holds before loading: the unreadable values keep these.
      { ...useProjectRailStore.getState(), filter: "all", threadColumnScope: null },
    );
    expect(merged.layout).toEqual(layout);
    expect(merged.noProjectPosition).toBe("top");
    expect(merged.hiddenProjects).toEqual(["env:b"]);
    expect(merged.favoriteProjects).toEqual(["env:a"]);
    expect(merged.filter).toBe("all");
    expect(merged.threadColumnScope).toBeNull();
  });

  it("falls back to the defaults when the saved state is not an object", () => {
    const merge = useProjectRailStore.persist.getOptions().merge!;
    const current = useProjectRailStore.getState();
    expect(merge("corrupt", current).layout).toEqual(current.layout);
  });
});
