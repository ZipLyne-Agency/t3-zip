/**
 * T3 Zip: the project rail, shared by the desktop rail and the phone. The layout and snooze
 * logic, the shape the server keeps in its settings (`projectRail`), and the conversions and
 * sync decision both apps use. Folder folding stays on each device and is not shared.
 */
import type { ProjectRailSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { RailFolder, RailLayoutState } from "./projectRailLayout.ts";
import type { SnoozedProjects } from "./projectRailSnooze.ts";

export * from "./projectRailLayout.ts";
export * from "./projectRailSnooze.ts";

/** The rail as the server keeps it, in `ServerSettings.projectRail`. */
export type SharedProjectRail = ProjectRailSettings;
export type SharedProjectRailLayout = SharedProjectRail["layout"];

/** The shared fields without the time they were written. */
export type SharedProjectRailContent = Omit<SharedProjectRail, "updatedAt">;

/** The shared fields as a device holds them: its layout carries its own folder folding. */
export interface LocalProjectRail {
  readonly layout: RailLayoutState;
  readonly favoriteProjects: readonly string[];
  readonly hiddenProjects: readonly string[];
  readonly snoozedProjects: SnoozedProjects;
}

/** A device layout without folder folding. */
function sharedRailLayoutFromLocal(layout: RailLayoutState): SharedProjectRailLayout {
  const folders: Record<string, { name: string; projects: string[] }> = {};
  for (const [folderId, folder] of Object.entries(layout.folders)) {
    folders[folderId] = { name: folder.name, projects: [...folder.projects] };
  }
  return { top: [...layout.top], folders };
}

/**
 * A shared layout on this device. Each folder keeps the folding it has in `previous`; a folder
 * this device has not seen starts open.
 */
export function railLayoutFromShared(
  shared: SharedProjectRailLayout,
  previous?: RailLayoutState,
): RailLayoutState {
  const folders: Record<string, RailFolder> = {};
  for (const [folderId, folder] of Object.entries(shared.folders)) {
    folders[folderId] = {
      name: folder.name,
      collapsed: previous?.folders[folderId]?.collapsed ?? false,
      projects: [...folder.projects],
    };
  }
  return { top: [...shared.top], folders };
}

export function sharedProjectRailContentFromLocal(
  local: LocalProjectRail,
): SharedProjectRailContent {
  return {
    layout: sharedRailLayoutFromLocal(local.layout),
    favoriteProjects: [...local.favoriteProjects],
    hiddenProjects: [...local.hiddenProjects],
    snoozedProjects: { ...local.snoozedProjects },
  };
}

/** The value a writer sends: the device's shared fields, stamped with `updatedAt`. */
export function sharedProjectRailFromLocal(
  local: LocalProjectRail,
  updatedAt: string,
): SharedProjectRail {
  return { ...sharedProjectRailContentFromLocal(local), updatedAt };
}

/** The shared value on this device, keeping its own folder folding from `previousLayout`. */
export function localProjectRailFromShared(
  shared: SharedProjectRailContent,
  previousLayout?: RailLayoutState,
): LocalProjectRail {
  return {
    layout: railLayoutFromShared(shared.layout, previousLayout),
    favoriteProjects: [...shared.favoriteProjects],
    hiddenProjects: [...shared.hiddenProjects],
    snoozedProjects: { ...shared.snoozedProjects },
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const sameRecord = <V>(
  a: Readonly<Record<string, V>>,
  b: Readonly<Record<string, V>>,
  same: (x: V, y: V) => boolean,
) => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && same(a[key]!, b[key]!));
};

/** Whether two values hold the same rail, ignoring when they were written. */
export function sameSharedProjectRail(
  a: SharedProjectRailContent,
  b: SharedProjectRailContent,
): boolean {
  return (
    sameList(a.layout.top, b.layout.top) &&
    sameRecord(
      a.layout.folders,
      b.layout.folders,
      (x, y) => x.name === y.name && sameList(x.projects, y.projects),
    ) &&
    sameList(a.favoriteProjects, b.favoriteProjects) &&
    sameList(a.hiddenProjects, b.hiddenProjects) &&
    sameRecord(a.snoozedProjects, b.snoozedProjects, (x, y) => x === y)
  );
}

/** Nothing arranged: no order, folders, favorites, hidden or snoozed projects. */
export function isEmptySharedProjectRail(rail: SharedProjectRailContent): boolean {
  return (
    rail.layout.top.length === 0 &&
    Object.keys(rail.layout.folders).length === 0 &&
    rail.favoriteProjects.length === 0 &&
    rail.hiddenProjects.length === 0 &&
    Object.keys(rail.snoozedProjects).length === 0
  );
}

/**
 * `push` sends the device's rail: the server has none, an empty one, or a value older than an
 * unconfirmed edit here. `adopt` takes the server's rail; `none` means they agree.
 */
export type ProjectRailSyncStep =
  | { readonly kind: "none" }
  | { readonly kind: "push" }
  | { readonly kind: "adopt"; readonly rail: SharedProjectRail };

/**
 * `pendingSince` is when this device last changed its rail without the server confirming it
 * (null when the server has its latest edit). A missing or empty server value never replaces a
 * device rail that has something in it; the device seeds the server instead. Without a pending
 * edit the server's value always wins, so a phone with a slow clock is never ignored.
 */
export function resolveProjectRailSync(input: {
  readonly server: SharedProjectRail | undefined;
  readonly local: SharedProjectRailContent;
  readonly pendingSince: string | null;
}): ProjectRailSyncStep {
  const { server, local, pendingSince } = input;
  if (server === undefined || isEmptySharedProjectRail(server)) {
    return isEmptySharedProjectRail(local) ? { kind: "none" } : { kind: "push" };
  }
  if (sameSharedProjectRail(server, local)) return { kind: "none" };
  if (pendingSince !== null && isLaterTime(pendingSince, server.updatedAt)) {
    return { kind: "push" };
  }
  return { kind: "adopt", rail: server };
}

/**
 * The time to stamp a local edit with: now, or just after the server value the rail is based on
 * when that is stamped ahead of this clock, so a fast clock elsewhere never makes an edit here
 * look older than the value it changes.
 */
export function nextProjectRailEditTime(nowMs: number, basedOn: string | null): string {
  const baseMs = basedOn === null ? Number.NaN : Date.parse(basedOn);
  return DateTime.formatIso(
    DateTime.makeUnsafe(Number.isNaN(baseMs) ? nowMs : Math.max(nowMs, baseMs + 1)),
  );
}

/** Whether ISO time `a` is after `b`; an unreadable `b` counts as long ago. */
function isLaterTime(a: string, b: string): boolean {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs)) return false;
  return Number.isNaN(bMs) || aMs > bMs;
}
