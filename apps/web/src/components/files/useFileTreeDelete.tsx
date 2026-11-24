/**
 * T3 Zip: Delete for the Files panel, after a confirmation.
 *
 * When the server runs on this Mac, the entry goes to the macOS Trash; otherwise it is deleted
 * permanently, and the confirmation says so. The mode is chosen here, before asking, so the
 * dialog names what will happen; the server never turns a failed Trash move into a deletion.
 */
import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { FileTree } from "@pierre/trees";
import { useGT } from "gt-react";
import { type RefObject, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { clientHostEnvironmentAtom } from "~/state/clientHostEnvironment";
import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { discardFileSaveSessions, flushFileSaveSessions } from "./fileSaveSessions";
import { type FileTreeEntryChange, newEntryFolder } from "./fileTreeCreate";

interface DeleteTarget {
  /** Pierre's path of the row; folders end with `/`. */
  readonly treePath: string;
  readonly relativePath: string;
  readonly name: string;
  readonly folder: boolean;
  readonly mode: "trash" | "permanent";
}

function isTrashUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "trashUnavailable" in error &&
    error.trashUnavailable === true
  );
}

export function useFileTreeDelete(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** Host folders are not known workspaces, so the server would refuse to delete there. */
  readonly disabled: boolean;
  readonly modelRef: RefObject<FileTree | null>;
  readonly loadFolder: (folder: string, refresh?: boolean) => Promise<void>;
  readonly onEntryChanged: (change: FileTreeEntryChange) => void;
}) {
  const gt = useGT();
  const canWrite = useEnvironmentScope(input.environmentId, AuthFilesystemWriteScope);
  const enabled = canWrite && !input.disabled;
  const isClientHost = useAtomValue(clientHostEnvironmentAtom(input.environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(input.environmentId));
  // The server moves to the Trash only on macOS; a remote server's Trash is not this Mac's.
  const mode =
    isClientHost && serverConfig?.environment.platform.os === "darwin" ? "trash" : "permanent";
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });
  // The last target stays for rendering while the dialog animates closed.
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = (itemPath: string) => {
    if (!enabled) return;
    const relativePath = itemPath.replace(/\/$/, "");
    setTarget({
      treePath: itemPath,
      relativePath,
      name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
      folder: itemPath.endsWith("/"),
      mode,
    });
    setOpen(true);
  };

  const confirm = async (current: DeleteTarget) => {
    setBusy(true);
    const saveTarget = {
      environmentId: input.environmentId,
      cwd: input.cwd,
      relativePath: current.relativePath,
    };
    // Unsaved edits are written first, so a failed delete loses nothing and the Trash keeps them.
    await flushFileSaveSessions(saveTarget);
    const result = await deleteEntry({
      environmentId: input.environmentId,
      input: { cwd: input.cwd, relativePath: current.relativePath, mode: current.mode },
    });
    setBusy(false);
    setOpen(false);
    if (result._tag !== "Success") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title:
          current.mode === "trash"
            ? gt("Could not move {name} to the Trash", { name: current.name })
            : gt("Could not delete {name}", { name: current.name }),
        description: isTrashUnavailable(error)
          ? gt("The Trash isn't available on this Mac.")
          : (thrownErrorMessage(error, m) ?? gt("An error occurred.")),
      });
      return;
    }
    // Nothing may write the file back: drop its drafts and any edit made since.
    await discardFileSaveSessions(saveTarget);
    const model = input.modelRef.current;
    if (model?.getItem(current.treePath)) model.remove(current.treePath, { recursive: true });
    input.onEntryChanged({ type: "deleted", path: current.relativePath });
    await input.loadFolder(newEntryFolder(current.relativePath), true);
  };

  const trash = target?.mode === "trash";
  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) setOpen(false);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.folder
              ? gt("Delete the folder {name}?", { name: target.name })
              : gt("Delete {name}?", { name: target?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.folder
              ? trash
                ? gt("Everything inside it goes too. You can restore it from the Trash.")
                : gt("Everything inside it is deleted permanently. This can't be undone.")
              : trash
                ? gt("You can restore it from the Trash.")
                : gt("It is deleted permanently. This can't be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
            {gt("Cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (target && open && !busy) void confirm(target);
            }}
          >
            {trash ? gt("Move to Trash") : gt("Delete Permanently")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );

  return {
    menuItem: enabled ? { id: "delete-entry", label: gt("Delete") } : null,
    request,
    dialog,
  };
}
