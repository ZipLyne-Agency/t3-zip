/**
 * T3 Zip: New File, New Folder, Paste as New File and Rename in the Files panel, using Pierre's
 * inline rename box. Pierre's commit closes the box before anything can fail, so Return is handled
 * here: the box stays open until the server, which never overwrites, has made the change.
 */
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemWriteScope,
  type ContextMenuItem,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  FILE_TREE_TAG_NAME,
  type FileTree,
  type FileTreeRenameEvent,
  type FileTreeRenamingConfig,
  type FileTreeRenamingItem,
  type FileTreeRowDecoration,
} from "@pierre/trees";
import { useGT } from "gt-react";
import {
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useRef,
  useState,
} from "react";

import { toastManager } from "~/components/ui/toast";
import { readTextFromClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";
import { m } from "~/i18n/messages";
import { useEnvironmentScope } from "~/state/session";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { discardFileSaveSessions, flushFileSaveSessions } from "./fileSaveSessions";
import {
  type FileTreeEntryChange,
  type NewEntryKind,
  UNTITLED_FILE_NAME,
  markCreatedFile,
  UNTITLED_FOLDER_NAME,
  newEntryFolder,
  newEntryNameProblem,
  newEntryPath,
  newEntryStemLength,
  suggestPastedFileName,
} from "./fileTreeCreate";

type CreateAction = "new-file" | "new-folder" | "paste-as-new-file";

const CREATE_ACTIONS: readonly string[] = ["new-file", "new-folder", "paste-as-new-file"];

// A zero-width suffix keeps the placeholder apart from any real entry and makes Pierre report a
// commit on blur even when the suggested name is kept as is.
const PLACEHOLDER_MARK = "​";

interface PendingEntry {
  readonly kind: NewEntryKind;
  readonly folder: string;
  readonly contents: string | undefined;
  /** The entry being renamed, or null for a new one. */
  readonly sourcePath: string | null;
  /** Pierre's canonical path of the row with the box; folders end with `/`. */
  placeholderPath: string;
  busy: boolean;
}

type SubmitOutcome =
  | { readonly type: "created" }
  /** Shown in the box; nothing else told the user. */
  | { readonly type: "invalid"; readonly message: string }
  /** Already reported as a toast, or interrupted. */
  | { readonly type: "failed" };

const cleanName = (name: string) => name.replaceAll(PLACEHOLDER_MARK, "").trim();
const withoutTrailingSlash = (path: string) => path.replace(/\/$/, "");
const treePathFor = (relativePath: string, kind: NewEntryKind) =>
  kind === "folder" ? `${relativePath}/` : relativePath;

function renameInputFromEvent(event: { nativeEvent: Event }): HTMLInputElement | null {
  const origin = event.nativeEvent.composedPath()[0];
  return origin instanceof HTMLInputElement && origin.hasAttribute("data-item-rename-input")
    ? origin
    : null;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "alreadyExists" in error &&
    error.alreadyExists === true
  );
}

export function useFileTreeCreate(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** Host folders are not known workspaces, so the server would refuse to write there. */
  readonly disabled: boolean;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly modelRef: RefObject<FileTree | null>;
  readonly loadFolder: (folder: string, refresh?: boolean) => Promise<void>;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onEntryChanged: (change: FileTreeEntryChange) => void;
}) {
  const gt = useGT();
  const canWrite = useEnvironmentScope(input.environmentId, AuthFilesystemWriteScope);
  const enabled = canWrite && !input.disabled;
  const createEntry = useAtomCommand(projectEnvironment.createEntry, { reportFailure: false });
  const renameEntry = useAtomCommand(projectEnvironment.renameEntry, { reportFailure: false });
  const pendingRef = useRef<PendingEntry | null>(null);
  const typedRef = useRef("");
  const errorRef = useRef<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const nameError = (name: string): string | null => {
    switch (newEntryNameProblem(name)) {
      case null:
        return null;
      case "empty":
        return gt("Enter a name");
      case "separator":
        return gt("Names can't contain / or \\");
      case "dots":
        return gt("Names can't contain ..");
      case "absolute":
        return gt("Enter a name, not a path");
    }
  };

  const findRenameInput = () =>
    input.containerRef.current
      ?.querySelector(FILE_TREE_TAG_NAME)
      ?.shadowRoot?.querySelector<HTMLInputElement>("[data-item-rename-input]") ?? null;

  const setError = (message: string | null) => {
    if (errorRef.current === message) return;
    errorRef.current = message;
    setErrorText(message);
    // Pierre reads row decorations only when its composition changes.
    const model = input.modelRef.current;
    model?.setComposition(model.getComposition());
  };

  const clearPending = () => {
    pendingRef.current = null;
    setError(null);
  };

  /** Drops a new entry's placeholder, or puts a renamed row back under its old name. */
  const removePlaceholder = (pending: PendingEntry) => {
    const model = input.modelRef.current;
    if (pending.sourcePath === null) {
      if (model?.getItem(pending.placeholderPath)) model.remove(pending.placeholderPath);
    } else {
      const original = treePathFor(pending.sourcePath, pending.kind);
      if (
        pending.placeholderPath !== original &&
        model?.getItem(pending.placeholderPath) &&
        !model.getItem(original)
      ) {
        model.move(pending.placeholderPath, original);
      }
    }
    if (pendingRef.current === pending) clearPending();
  };

  const reportFailure = (pending: PendingEntry, description: string) => {
    const renaming = pending.sourcePath !== null;
    const folder = pending.kind === "folder";
    toastManager.add({
      type: "error",
      title: renaming
        ? folder
          ? gt("Could not rename folder")
          : gt("Could not rename file")
        : folder
          ? gt("Could not create folder")
          : gt("Could not create file"),
      description,
    });
  };

  /** Shows the new name on the row and closes the box, which then commits an unchanged name. */
  const settleRow = (pending: PendingEntry, relativePath: string, name: string) => {
    if (pendingRef.current === pending) clearPending();
    const treePath = treePathFor(relativePath, pending.kind);
    const model = input.modelRef.current;
    // Give the row its real name now, so the refreshed listing finds it already present.
    if (model?.getItem(pending.placeholderPath) && pending.placeholderPath !== treePath) {
      if (model.getItem(treePath)) model.remove(pending.placeholderPath);
      else model.move(pending.placeholderPath, treePath);
    }
    // After Return the box is still open on the renamed row. Blurring commits its unchanged name,
    // which closes it without another move.
    const box = findRenameInput();
    if (box) {
      box.value = name;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.blur();
    }
  };

  const failureOutcome = (
    pending: PendingEntry,
    result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  ): SubmitOutcome => {
    if (isAtomCommandInterrupted(result)) return { type: "failed" };
    const error = squashAtomCommandFailure(result);
    if (isAlreadyExists(error)) return { type: "invalid", message: gt("That name is taken") };
    reportFailure(pending, thrownErrorMessage(error, m) ?? gt("An error occurred."));
    return { type: "failed" };
  };

  const submitRename = async (
    pending: PendingEntry,
    sourcePath: string,
    name: string,
  ): Promise<SubmitOutcome> => {
    const newRelativePath = newEntryPath(pending.folder, name);
    if (newRelativePath === sourcePath) {
      settleRow(pending, sourcePath, name);
      return { type: "created" };
    }
    pending.busy = true;
    // Unsaved edits go to the old name first, so the rename carries them and no late save
    // recreates the old file.
    const saveTarget = {
      environmentId: input.environmentId,
      cwd: input.cwd,
      relativePath: sourcePath,
    };
    const saved = await flushFileSaveSessions(saveTarget);
    if (!saved) {
      pending.busy = false;
      reportFailure(pending, gt("Unsaved changes could not be saved. Try again."));
      return { type: "failed" };
    }
    const result = await renameEntry({
      environmentId: input.environmentId,
      input: { cwd: input.cwd, relativePath: sourcePath, newRelativePath },
    });
    pending.busy = false;
    if (result._tag !== "Success") return failureOutcome(pending, result);
    const relativePath = result.value.relativePath;
    settleRow(pending, relativePath, name);
    // The old name's sessions and cached contents are saved already; a later file reusing the
    // name must not inherit them.
    await discardFileSaveSessions(saveTarget);
    input.onEntryChanged({ type: "renamed", from: sourcePath, to: relativePath });
    await input.loadFolder(pending.folder, true);
    return { type: "created" };
  };

  const submit = async (pending: PendingEntry, rawName: string): Promise<SubmitOutcome> => {
    const name = cleanName(rawName);
    const invalid = nameError(name);
    if (invalid !== null) return { type: "invalid", message: invalid };
    if (pending.sourcePath !== null) return submitRename(pending, pending.sourcePath, name);
    pending.busy = true;
    const result = await createEntry({
      environmentId: input.environmentId,
      input: {
        cwd: input.cwd,
        relativePath: newEntryPath(pending.folder, name),
        kind: pending.kind === "folder" ? "directory" : "file",
        ...(pending.contents === undefined ? {} : { contents: pending.contents }),
      },
    });
    pending.busy = false;
    if (result._tag !== "Success") return failureOutcome(pending, result);
    const relativePath = result.value.relativePath;
    settleRow(pending, relativePath, name);
    await input.loadFolder(pending.folder, true);
    if (pending.kind === "file") {
      markCreatedFile(input.environmentId, input.cwd, relativePath);
      input.onOpenFile(relativePath);
    }
    return { type: "created" };
  };

  const dropPrevious = () => {
    const previous = pendingRef.current;
    if (previous && !previous.busy) removePlaceholder(previous);
    clearPending();
  };

  /**
   * Pierre focuses the box and selects all of it once rendered. Then show the clean name with the
   * given selection.
   */
  const showName = (pending: PendingEntry, name: string, start: number, end: number) => {
    const selectName = (frame: number) => {
      if (pendingRef.current !== pending) return;
      const box = findRenameInput();
      if (!box) {
        if (frame < 30) requestAnimationFrame(() => selectName(frame + 1));
        return;
      }
      box.value = name;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.setSelectionRange(start, end);
    };
    requestAnimationFrame(() => selectName(1));
  };

  const start = async (kind: NewEntryKind, folder: string, name: string, contents?: string) => {
    const model = input.modelRef.current;
    if (!model) return;
    dropPrevious();
    if (folder !== "") await input.loadFolder(folder);
    const canonical = (leaf: string) => treePathFor(newEntryPath(folder, leaf), kind);
    let leaf = `${name}${PLACEHOLDER_MARK}`;
    while (model.getItem(canonical(leaf))) leaf += PLACEHOLDER_MARK;
    const pending: PendingEntry = {
      kind,
      folder,
      contents,
      sourcePath: null,
      placeholderPath: canonical(leaf),
      busy: false,
    };
    pendingRef.current = pending;
    typedRef.current = name;
    model.add(pending.placeholderPath);
    if (!model.startRenaming(pending.placeholderPath, { removeIfCanceled: true })) {
      removePlaceholder(pending);
      return;
    }
    // The caret goes before the extension: a suggested name from the clipboard is kept, while
    // "Untitled" is selected so typing replaces it.
    const stemEnd = newEntryStemLength(name, kind);
    showName(pending, name, contents === undefined ? 0 : stemEnd, stemEnd);
  };

  /** Opens the box on an existing row, its file name selected up to the extension. */
  const startRename = useStableCallback((itemPath: string) => {
    const model = input.modelRef.current;
    if (!enabled || !model) return;
    dropPrevious();
    const kind: NewEntryKind = itemPath.endsWith("/") ? "folder" : "file";
    const sourcePath = withoutTrailingSlash(itemPath);
    const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
    const pending: PendingEntry = {
      kind,
      folder: newEntryFolder(sourcePath),
      contents: undefined,
      sourcePath,
      placeholderPath: treePathFor(sourcePath, kind),
      busy: false,
    };
    pendingRef.current = pending;
    typedRef.current = name;
    if (!model.startRenaming(pending.placeholderPath)) {
      clearPending();
      return;
    }
    showName(pending, name, 0, newEntryStemLength(name, kind));
  });

  const startAction = useStableCallback(async (action: CreateAction, folder: string) => {
    if (!enabled) return;
    if (action === "new-file") return start("file", folder, UNTITLED_FILE_NAME);
    if (action === "new-folder") return start("folder", folder, UNTITLED_FOLDER_NAME);
    let text: string;
    try {
      text = await readTextFromClipboard();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Could not read the clipboard"),
        description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
      });
      return;
    }
    if (text.trim().length === 0) {
      toastManager.add({ type: "info", title: gt("Clipboard has no text") });
      return;
    }
    return start("file", folder, suggestPastedFileName(text, new Date()), text);
  });

  // Pierre keeps the renaming config from its first render, so these must be stable.
  const canRename = useStableCallback((item: FileTreeRenamingItem) => {
    const pending = pendingRef.current;
    // Only the row this hook opened; F2 on another row would rename it in the tree alone.
    return (
      pending !== null &&
      withoutTrailingSlash(item.path) === withoutTrailingSlash(pending.placeholderPath)
    );
  });

  // Reached when the box loses focus with text in it; Return never gets to Pierre.
  const onRename = useStableCallback((event: FileTreeRenameEvent) => {
    const pending = pendingRef.current;
    if (!pending) return;
    // Pierre moves the row to the committed name right after this returns.
    pending.placeholderPath = event.destinationPath + (event.isFolder ? "/" : "");
    if (pending.busy) return;
    const name = event.destinationPath.slice(event.destinationPath.lastIndexOf("/") + 1);
    void submit(pending, name).then((outcome) => {
      if (outcome.type === "created") return;
      if (outcome.type === "invalid") reportFailure(pending, outcome.message);
      removePlaceholder(pending);
    });
  });

  // Pierre refused a commit on blur: a name already in the tree, or one with "/".
  const onRenameError = useStableCallback(() => {
    const pending = pendingRef.current;
    if (!pending || pending.busy) return;
    reportFailure(pending, nameError(cleanName(typedRef.current)) ?? gt("That name is taken"));
    removePlaceholder(pending);
  });

  const [renaming] = useState<FileTreeRenamingConfig>(() => ({
    canRename,
    onRename,
    onError: onRenameError,
  }));

  /** Drops the placeholder when Pierre closed the box without a commit (Escape, empty blur). */
  const settleIfClosed = () => {
    setTimeout(() => {
      const pending = pendingRef.current;
      if (!pending || pending.busy || findRenameInput()) return;
      removePlaceholder(pending);
    }, 0);
  };

  const onKeyDownCapture = useStableCallback((event: KeyboardEvent<HTMLElement>) => {
    const box = renameInputFromEvent(event);
    const pending = pendingRef.current;
    if (!box || !pending) return;
    if (event.key === "Escape") {
      settleIfClosed();
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // Pierre's commit would close the box before the server answers, and the panel opens the
    // focused row on Return.
    event.preventDefault();
    event.stopPropagation();
    if (pending.busy) return;
    void submit(pending, box.value).then((outcome) => {
      if (outcome.type !== "invalid" || pendingRef.current !== pending) return;
      setError(outcome.message);
      findRenameInput()?.focus();
    });
  });

  const onInputCapture = useStableCallback((event: FormEvent<HTMLElement>) => {
    const box = renameInputFromEvent(event);
    if (!box) return;
    typedRef.current = box.value;
    setError(null);
  });

  const onBlurCapture = useStableCallback((event: FocusEvent<HTMLElement>) => {
    if (renameInputFromEvent(event)) settleIfClosed();
  });

  const decorationFor = useStableCallback((treePath: string): FileTreeRowDecoration | null => {
    const pending = pendingRef.current;
    const error = errorRef.current;
    if (!pending || error === null || treePath !== pending.placeholderPath) return null;
    return { text: error, title: error, parts: [{ text: error, color: "var(--destructive)" }] };
  });

  const menuItems = (): ContextMenuItem<CreateAction>[] =>
    enabled
      ? [
          { id: "new-file", label: gt("New File") },
          { id: "new-folder", label: gt("New Folder") },
          { id: "paste-as-new-file", label: gt("Paste as New File") },
        ]
      : [];

  return {
    menuItems,
    isCreateAction: (id: string): id is CreateAction => CREATE_ACTIONS.includes(id),
    startAction,
    canRenameEntries: enabled,
    startRename,
    renaming,
    decorationFor,
    errorText,
    handlers: { onKeyDownCapture, onInputCapture, onBlurCapture },
  };
}
