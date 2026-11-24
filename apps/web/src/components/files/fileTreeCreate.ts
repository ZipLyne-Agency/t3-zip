/**
 * T3 Zip: helpers for creating, renaming and deleting entries in the Files panel.
 * Tree paths follow Pierre's convention: folders end with `/`, the project root is "".
 */

export type NewEntryKind = "file" | "folder";

type NewEntryNameProblem = "empty" | "separator" | "dots" | "absolute";

export const UNTITLED_FILE_NAME = "Untitled.md";
export const UNTITLED_FOLDER_NAME = "Untitled";

const SLUG_MAX_WORDS = 6;

/** The folder a new entry goes into: a folder row itself, a file row's folder, or the root. */
export function newEntryFolder(treePath: string | null): string {
  if (!treePath) return "";
  if (treePath.endsWith("/")) return treePath.slice(0, -1);
  const slash = treePath.lastIndexOf("/");
  return slash === -1 ? "" : treePath.slice(0, slash);
}

export function newEntryPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** Checks a single name typed into the box; the caller trims it first. */
export function newEntryNameProblem(name: string): NewEntryNameProblem | null {
  if (name.length === 0) return "empty";
  if (/^[a-zA-Z]:/.test(name)) return "absolute";
  if (name.includes("/") || name.includes("\\")) return "separator";
  if (name === "." || name.includes("..")) return "dots";
  return null;
}

/** The part selected when the box opens: a file's name before its extension, a whole folder name. */
export function newEntryStemLength(name: string, kind: NewEntryKind): number {
  if (kind === "folder") return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

function localDateStamp(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function slugFromText(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const words = firstLine
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, SLUG_MAX_WORDS);
  return words.length > 0 ? words.join("-") : "notes";
}

/** `YYYY-MM-DD-<slug>.md`, dated from the local calendar day. */
export function suggestPastedFileName(text: string, now: Date): string {
  return `${localDateStamp(now)}-${slugFromText(text)}.md`;
}

/** A rename or delete the Files panel made, in project-relative paths without a trailing `/`. */
export type FileTreeEntryChange =
  | { readonly type: "renamed"; readonly from: string; readonly to: string }
  | { readonly type: "deleted"; readonly path: string };

/**
 * Where an open file is after a change: its new path, null when it was deleted, or undefined
 * when the change did not touch it. A folder change reaches every file inside it.
 */
export function followEntryChange(
  openPath: string | null,
  change: FileTreeEntryChange,
): string | null | undefined {
  if (openPath === null) return undefined;
  const changed = change.type === "renamed" ? change.from : change.path;
  const inside = openPath === changed || openPath.startsWith(`${changed}/`);
  if (!inside) return undefined;
  return change.type === "renamed" ? change.to + openPath.slice(changed.length) : null;
}

// Files just made by New File or Paste as New File. The preview opens each once in the source
// editor, whatever the rendered markdown preference, so the new file can be typed into.
const createdFiles = new Set<string>();
const createdFileKey = (environmentId: string, cwd: string, relativePath: string) =>
  `${environmentId}\u0000${cwd}\u0000${relativePath}`;

export function markCreatedFile(environmentId: string, cwd: string, relativePath: string): void {
  createdFiles.add(createdFileKey(environmentId, cwd, relativePath));
}

export function isCreatedFile(environmentId: string, cwd: string, relativePath: string): boolean {
  return createdFiles.has(createdFileKey(environmentId, cwd, relativePath));
}

/** Called once the preview has opened the new file, so later opens follow the preference. */
export function forgetCreatedFile(environmentId: string, cwd: string, relativePath: string): void {
  createdFiles.delete(createdFileKey(environmentId, cwd, relativePath));
}
