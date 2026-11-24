import { describe, expect, it } from "vite-plus/test";

import {
  railProjectAway,
  railProjectKeysForMembers,
  railProjectReturn,
  searchRailProjects,
} from "./projectRailSearch.ts";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const rail = {
  hiddenProjects: ["p:hidden", "p:both"],
  snoozedProjects: {
    "p:snoozed": "2026-11-19T13:00:00.000Z",
    "p:both": "2026-11-19T13:00:00.000Z",
    "p:ran-out": "2026-11-19T11:00:00.000Z",
  },
};

describe("searchRailProjects", () => {
  const projects = ["Mobile App", "t3code", "Website", "Web App", "Docs", "render"];
  const search = (query: string) => searchRailProjects(projects, query, (name) => name);

  it("lists nothing for an empty query", () => {
    expect(search("  ")).toEqual([]);
  });

  it("matches names, ignoring case, best match first", () => {
    // A whole word ranks above a prefix, as in the palette.
    expect(search("web")).toEqual(["Web App", "Website"]);
    expect(search("APP")).toEqual(expect.arrayContaining(["Mobile App", "Web App"]));
    expect(search("app")).not.toContain("Docs");
  });

  it("keeps the given order between equal matches", () => {
    expect(searchRailProjects(["b app", "a app"], "app", (name) => name)).toEqual([
      "b app",
      "a app",
    ]);
  });

  it("does not match a thread title query against unrelated project names", () => {
    expect(search("thread-b")).toEqual([]);
  });
});

describe("railProjectAway", () => {
  it("names hidden and snoozed projects, hidden first", () => {
    expect(railProjectAway(rail, "p:hidden", now)).toEqual({ kind: "hidden" });
    expect(railProjectAway(rail, "p:both", now)).toEqual({ kind: "hidden" });
    expect(railProjectAway(rail, "p:snoozed", now)).toEqual({
      kind: "snoozed",
      until: "2026-11-19T13:00:00.000Z",
    });
  });

  it("treats a project in the rail, or one whose snooze ran out, as there", () => {
    expect(railProjectAway(rail, "p:visible", now)).toBeNull();
    expect(railProjectAway(rail, "p:ran-out", now)).toBeNull();
  });
});

describe("railProjectReturn", () => {
  it("shows a hidden project and wakes a snoozed one", () => {
    expect(railProjectReturn(rail, "p:hidden")).toEqual({ show: true, wake: false });
    expect(railProjectReturn(rail, "p:snoozed")).toEqual({ show: false, wake: true });
    expect(railProjectReturn(rail, "p:both")).toEqual({ show: true, wake: true });
  });

  it("clears a snooze that ran out", () => {
    expect(railProjectReturn(rail, "p:ran-out")).toEqual({ show: false, wake: true });
  });

  it("changes nothing for a project already in the rail", () => {
    expect(railProjectReturn(rail, "p:visible")).toBeNull();
  });
});

describe("railProjectKeysForMembers", () => {
  const groups = [
    {
      projectKey: "g:web",
      memberProjectRefs: [
        { environmentId: "laptop", projectId: "web" },
        { environmentId: "server", projectId: "web" },
      ],
    },
    { projectKey: "g:docs", memberProjectRefs: [{ environmentId: "laptop", projectId: "docs" }] },
  ];

  it("finds the rail project holding each member project", () => {
    expect(railProjectKeysForMembers(groups, ["server:web"])).toEqual(["g:web"]);
    expect(railProjectKeysForMembers(groups, ["laptop:docs", "laptop:web"])).toEqual([
      "g:web",
      "g:docs",
    ]);
  });

  it("gives nothing for a member no project holds", () => {
    expect(railProjectKeysForMembers(groups, ["laptop:scratch"])).toEqual([]);
    expect(railProjectKeysForMembers(groups, [])).toEqual([]);
  });
});
