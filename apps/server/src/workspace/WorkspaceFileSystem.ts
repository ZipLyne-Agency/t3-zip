// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";

import type {
  FilesystemEntryMetadata,
  ProjectCreateEntryInput,
  ProjectCreateEntryResult,
  ProjectDeleteEntryInput,
  ProjectEntryResult,
  ProjectRenameEntryInput,
  FilesystemGetMetadataInput,
  FilesystemGetMetadataResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isNetworkPath } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

import { makeIsServerInternalPath } from "../auth/serverInternalPaths.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import { fileHeaderMimeType } from "./fileHeaderMimeType.ts";
import { toHostDrivePath } from "./hostDrivePath.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

// NTFS reaches .git through trailing dots/spaces, stream suffixes and GIT~1; compare uppercased names.
const isGitMetadataName = (segment: string) => {
  const name = (segment.split(":")[0] ?? "").replace(/[. ]+$/, "").toUpperCase();
  return name === ".GIT" || name === "GIT~1";
};

export class WorkspaceFileSystemOperationError extends Schema.TaggedError<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedError<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedError<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedError<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

// T3 Zip: create-only files and folders. Kept out of WorkspaceFileSystemError, which feeds the
// shared failure mapping, so only createEntry can report it.
export class WorkspaceEntryExistsError extends Schema.TaggedError<WorkspaceEntryExistsError>()(
  "WorkspaceEntryExistsError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace entry '${this.relativePath}' already exists in '${this.workspaceRoot}'.`;
  }
}

// T3 Zip: rename and delete failures with no matching upstream operation literal.
export class WorkspaceEntryChangeError extends Schema.TaggedError<WorkspaceEntryChangeError>()(
  "WorkspaceEntryChangeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals(["lstat", "rename", "remove", "trash"]),
    trashUnavailable: Schema.optional(Schema.Boolean),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.trashUnavailable
      ? `The Trash is not available for '${this.relativePath}' in '${this.workspaceRoot}'.`
      : `Workspace entry operation '${this.operation}' failed at '${this.operationPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    readonly getMetadata: (
      input: FilesystemGetMetadataInput,
    ) => Effect.Effect<FilesystemGetMetadataResult>;

    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Writes inside a known workspace only. */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      | WorkspaceFileSystemError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
    /** T3 Zip: creates a file or folder inside a known workspace, never replacing an entry. */
    readonly createEntry: (
      input: ProjectCreateEntryInput,
    ) => Effect.Effect<
      ProjectCreateEntryResult,
      | WorkspaceFileSystemError
      | WorkspaceEntryExistsError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
    /** T3 Zip: renames an entry inside a known workspace, never replacing another entry. */
    readonly renameEntry: (
      input: ProjectRenameEntryInput,
    ) => Effect.Effect<
      ProjectEntryResult,
      | WorkspaceFileSystemError
      | WorkspaceEntryExistsError
      | WorkspaceEntryChangeError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
    /** T3 Zip: moves an entry to the Trash, or deletes it permanently. */
    readonly deleteEntry: (
      input: ProjectDeleteEntryInput,
    ) => Effect.Effect<
      ProjectEntryResult,
      | WorkspaceFileSystemError
      | WorkspaceEntryChangeError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

const UTF8_BOM = "\uFEFF";

async function startsWithUtf8Bom(filePath: string): Promise<boolean> {
  const handle = await NodeFSP.open(
    filePath,
    // O_NONBLOCK keeps a FIFO with no writer from hanging the save.
    NodeFS.constants.O_RDONLY |
      (NodeFS.constants.O_NOFOLLOW ?? 0) |
      (NodeFS.constants.O_NONBLOCK ?? 0),
  ).catch(() => null);
  if (!handle) return false;
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(3), 0, 3, 0);
    return bytesRead === 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const isServerInternalPath = yield* makeIsServerInternalPath;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const toHostPath = (requestedPath: string) =>
    toHostDrivePath(requestedPath).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  const metadataForPath = Effect.fnUntraced(function* (requestedPath: string) {
    const expandedPath = expandHomePath(
      yield* toHostPath(requestedPath),
      yield* HostProcess.HomeDirectory,
    );
    // Chips ask as soon as an agent's message renders, and touching a network
    // path makes Windows sign in to its host with the user's NTLM credentials.
    if (!path.isAbsolute(expandedPath) || isNetworkPath(expandedPath)) return null;
    const stat = yield* fileSystem.stat(expandedPath).pipe(Effect.option);
    // Server state files answer like missing paths, as readFile refuses them.
    if (stat._tag === "None" || (yield* isServerInternalPath(expandedPath))) return null;
    if (stat.value.type === "Directory") return { kind: "directory" } as const;
    if (stat.value.type !== "File") return { kind: "other" } as const;
    let mimeType: string | undefined;
    if (path.extname(expandedPath) === "" && stat.value.size > 0) {
      mimeType = yield* Effect.tryPromise({
        try: async () => {
          const handle = await NodeFSP.open(
            expandedPath,
            NodeFS.constants.O_RDONLY | NodeFS.constants.O_NONBLOCK,
          );
          try {
            if (!(await handle.stat()).isFile()) return undefined;
            const buffer = Buffer.alloc(512);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return fileHeaderMimeType(buffer.subarray(0, bytesRead));
          } finally {
            await handle.close();
          }
        },
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined));
    }
    return {
      kind: "file",
      byteLength: Number(stat.value.size),
      ...(mimeType === undefined ? {} : { mimeType }),
    } satisfies FilesystemEntryMetadata;
  });

  const getMetadata: WorkspaceFileSystem["Service"]["getMetadata"] = Effect.fn(
    "WorkspaceFileSystem.getMetadata",
  )(function* (input) {
    const paths = [...new Set(input.paths)];
    const entries = yield* Effect.forEach(paths, metadataForPath, { concurrency: 8 });
    const byPath = new Map(paths.map((value, index) => [value, entries[index] ?? null]));
    return { entries: input.paths.map((value) => byPath.get(value) ?? null) };
  });

  /** Both paths must already be real paths. */
  const isInsideRealRoot = (realWorkspaceRoot: string, realPath: string) => {
    const relative = path.relative(realWorkspaceRoot, realPath);
    return !(
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    );
  };

  // Reject Git folders, including renamed bare repos whose config/hooks can execute; paths must be normalized.
  // Stop at linked worktrees' .git files since worktrees can sit inside bare repos.
  const isInGitFolder = async (absolutePath: string) => {
    if (absolutePath.split(path.sep).some(isGitMetadataName)) return true;
    for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
      const [head, commondir, objects, refs, dotGit] = await Promise.all(
        ["HEAD", "commondir", "objects", "refs", ".git"].map((name) =>
          NodeFSP.lstat(path.join(folder, name)).catch((error: NodeJS.ErrnoException) => {
            // Any other failure leaves the folder unknown, so the write is refused.
            if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
            throw error;
          }),
        ),
      );
      // Git recognizes HEAD with commondir or objects/refs as a repository.
      if (head && (commondir || (objects && refs))) return true;
      if (dotGit?.isFile() || path.dirname(folder) === folder) return false;
    }
  };

  /**
   * `filesystem:read` covers the whole OS account, so a workspace-relative path
   * may follow a link out of the root, and an absolute or `~/` path reads a host
   * file in place. A network path must stay inside the root, since Windows signs
   * in to its host with the user's NTLM credentials.
   */
  const resolveReadTarget = Effect.fn("WorkspaceFileSystem.resolveReadTarget")(function* (
    input: ProjectReadFileInput,
  ) {
    const requestedPath = input.relativePath;
    const hostPath =
      requestedPath.startsWith("~/") || requestedPath.startsWith("~\\")
        ? expandHomePath(requestedPath, yield* HostProcess.HomeDirectory)
        : yield* toHostPath(requestedPath);
    if (
      isNetworkPath(hostPath) &&
      !KnownWorkspaces.isWithinRoot(path, path.resolve(hostPath), path.resolve(input.cwd))
    ) {
      return yield* new WorkspacePaths.WorkspacePathOutsideRootError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
    }
    if (path.isAbsolute(hostPath)) {
      // Native realpath hands Windows a `\\?\` path as written, `..` included,
      // so a network path must be the resolved one the check above approved.
      // Others keep POSIX `link/..` semantics, which resolving first would change.
      const absolutePath = isNetworkPath(hostPath) ? path.resolve(hostPath) : hostPath;
      const realTargetPath = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(absolutePath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: absolutePath,
            operationPath: absolutePath,
            operation: "realpath-target",
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) =>
            input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
          () => Effect.succeed(null),
        ),
      );
      return { relativePath: requestedPath, realTargetPath, outsideRoot: false };
    }

    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(path.resolve(input.cwd)),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    }).pipe(
      // Storage cleanup removes idle worktrees but keeps their path, so nothing below them exists.
      Effect.catchIf(
        (error) =>
          input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
        () => Effect.succeed(null),
      ),
    );
    if (realWorkspaceRoot === null) {
      return { relativePath: target.relativePath, realTargetPath: null, outsideRoot: false };
    }
    const resolved = yield* Effect.tryPromise({
      try: async () => {
        let candidate = target.absolutePath;
        for (;;) {
          try {
            return {
              realTargetPath: path.join(
                await NodeFSP.realpath(candidate),
                path.relative(candidate, target.absolutePath),
              ),
              exists: candidate === target.absolutePath,
            };
          } catch (error) {
            if (!input.allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
            // Like writes, missing reads must check the nearest existing ancestor.
            // An existing entry that cannot resolve is a dangling link, not absence.
            const exists = await NodeFSP.lstat(candidate).then(
              () => true,
              (cause: NodeJS.ErrnoException) => {
                if (cause.code !== "ENOENT") throw cause;
                return false;
              },
            );
            if (exists || path.dirname(candidate) === candidate) throw error;
            candidate = path.dirname(candidate);
          }
        }
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    // A link out of the workspace reads like an absolute path would; writes still refuse it.
    const outsideRoot = !isInsideRealRoot(realWorkspaceRoot, resolved.realTargetPath);
    if (outsideRoot && isNetworkPath(resolved.realTargetPath)) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: resolved.realTargetPath,
      });
    }
    return {
      relativePath: target.relativePath,
      realTargetPath: resolved.exists ? resolved.realTargetPath : null,
      outsideRoot,
    };
  });

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* resolveReadTarget(input);
    const absentResult = {
      relativePath: target.relativePath,
      contents: "",
      byteLength: 0,
      truncated: false,
      exists: false,
    };
    const realTargetPath = target.realTargetPath;
    if (realTargetPath === null) return absentResult;
    if (yield* isServerInternalPath(realTargetPath)) {
      return yield* new WorkspacePaths.WorkspacePathOutsideRootError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        // Non-blocking opens prevent FIFO hangs before stat rejects them; Windows lacks the flag.
        try: () =>
          NodeFSP.open(
            realTargetPath,
            NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0),
          ),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) =>
            input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
          () => Effect.succeed(null),
        ),
      ),
      (handle) =>
        Effect.gen(function* () {
          if (handle === null) return absentResult;
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          let offset = 0;
          while (offset < bytesToRead) {
            const { bytesRead } = yield* Effect.tryPromise({
              try: () => handle.read(buffer, offset, bytesToRead - offset, offset),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "read",
                  cause,
                }),
            });
            if (bytesRead <= 0) break;
            offset += bytesRead;
          }
          const fileBytes = buffer.subarray(0, offset);
          const truncated = stat.size > PROJECT_READ_FILE_MAX_BYTES;
          const binaryFileError = () =>
            new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          if (fileBytes.includes(0)) return yield* binaryFileError();
          // Fatal decoding rejects invalid UTF-8, since U+FFFD contents would corrupt the file on save.
          // Streaming decode drops a character the byte limit split, instead of rejecting it.
          const contents = yield* Effect.try({
            try: () =>
              new TextDecoder("utf-8", { fatal: true }).decode(fileBytes, { stream: truncated }),
            catch: binaryFileError,
          });
          return {
            relativePath: target.relativePath,
            contents,
            byteLength: stat.size,
            truncated,
            ...(target.outsideRoot ? { readOnly: true } : {}),
          };
        }),
      (handle) =>
        handle === null
          ? Effect.void
          : Effect.tryPromise({
              try: () => handle.close(),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "close",
                  cause,
                }),
            }),
    );
  });

  // Resolve existing ancestors and reject dangling links so creation cannot follow symlinks outside root.
  const resolveWriteTarget = Effect.fn("WorkspaceFileSystem.resolveWriteTarget")(function* (
    input: Pick<ProjectWriteFileInput, "cwd" | "relativePath">,
  ) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const realWorkspaceRoot = yield* Effect.tryPromise({
      // Resolve `..` in cwd the way the relative path was resolved, before following links.
      try: () => NodeFSP.realpath(path.resolve(input.cwd)),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    });

    // Split the host path, not the display relativePath: on POSIX `\` is a file name character.
    const segments = path.relative(input.cwd, target.absolutePath).split(path.sep);
    const realTargetPath = yield* Effect.tryPromise({
      try: async () => {
        for (let depth = segments.length; depth > 0; depth--) {
          const candidate = path.join(realWorkspaceRoot, ...segments.slice(0, depth));
          try {
            return path.join(await NodeFSP.realpath(candidate), ...segments.slice(depth));
          } catch (error) {
            // Only a missing entry is skipped; one that exists but cannot resolve is a dangling link.
            const exists = await NodeFSP.lstat(candidate).then(
              () => true,
              () => false,
            );
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || exists) throw error;
          }
        }
        return path.join(realWorkspaceRoot, ...segments);
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    // The path as named is checked too: a `.git/config` symlink resolves away the `.git`.
    const namedTargetPath = path.join(realWorkspaceRoot, ...segments);
    const inGitFolder = Effect.fn("WorkspaceFileSystem.inGitFolder")((checkedPath: string) =>
      Effect.tryPromise({
        try: () => isInGitFolder(checkedPath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: checkedPath,
            operation: "stat",
            cause,
          }),
      }),
    );
    if (
      !isInsideRealRoot(realWorkspaceRoot, realTargetPath) ||
      (yield* inGitFolder(realTargetPath)) ||
      (yield* inGitFolder(namedTargetPath))
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }
    return {
      relativePath: target.relativePath,
      realTargetPath,
      realWorkspaceRoot,
      namedTargetPath,
    };
  });

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const target = yield* resolveWriteTarget(input);
    const realTargetPath = target.realTargetPath;
    const replacesFile = yield* fileSystem
      .exists(realTargetPath)
      .pipe(Effect.orElseSucceed(() => false));
    // readFile decodes the BOM away, so an editor save would otherwise drop it from the file.
    const keepsBom =
      replacesFile &&
      !input.contents.startsWith(UTF8_BOM) &&
      (yield* Effect.promise(() => startsWithUtf8Bom(realTargetPath)));
    const contents = keepsBom ? UTF8_BOM + input.contents : input.contents;

    yield* fileSystem.makeDirectory(path.dirname(realTargetPath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: path.dirname(realTargetPath),
            operation: "make-directory",
            cause,
          }),
      ),
    );
    yield* Effect.tryPromise({
      // A symlink swapped in after the check is not followed. Windows lacks O_NOFOLLOW.
      try: () =>
        NodeFSP.writeFile(realTargetPath, contents, {
          flag:
            NodeFS.constants.O_WRONLY |
            NodeFS.constants.O_CREAT |
            NodeFS.constants.O_TRUNC |
            (NodeFS.constants.O_NOFOLLOW ?? 0),
        }),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: realTargetPath,
          operationPath: realTargetPath,
          operation: "write-file",
          cause,
        }),
    });
    // Editor autosave overwrites existing files, which leaves the indexed paths unchanged, and
    // fff's watcher applies the new contents on its own. A forced rescan re-walks the whole
    // workspace, and the save would wait for it.
    if (!replacesFile) {
      yield* workspaceEntries.refresh(input.cwd);
    }
    return { relativePath: target.relativePath };
  });

  // T3 Zip: create-only files and folders. Same workspace and path checks as writeFile; the
  // final open or mkdir is exclusive, so an entry that appears after the checks is not replaced.
  const createEntry: WorkspaceFileSystem["Service"]["createEntry"] = Effect.fn(
    "WorkspaceFileSystem.createEntry",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const target = yield* resolveWriteTarget(input);
    const realTargetPath = target.realTargetPath;
    const operationError = (
      operation: "make-directory" | "write-file",
      operationPath: string,
      cause: unknown,
    ) =>
      (cause as NodeJS.ErrnoException).code === "EEXIST"
        ? new WorkspaceEntryExistsError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
          })
        : new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath,
            operation,
            cause,
          });
    const parentPath = path.dirname(realTargetPath);
    yield* Effect.tryPromise({
      try: () => NodeFSP.mkdir(parentPath, { recursive: true }),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: realTargetPath,
          operationPath: parentPath,
          operation: "make-directory",
          cause,
        }),
    });
    if (input.kind === "directory") {
      yield* Effect.tryPromise({
        try: () => NodeFSP.mkdir(realTargetPath),
        catch: (cause) => operationError("make-directory", realTargetPath, cause),
      });
    } else {
      yield* Effect.tryPromise({
        // O_EXCL fails on any existing entry, a symlink included. Windows lacks O_NOFOLLOW.
        try: () =>
          NodeFSP.writeFile(realTargetPath, input.contents ?? "", {
            flag:
              NodeFS.constants.O_WRONLY |
              NodeFS.constants.O_CREAT |
              NodeFS.constants.O_EXCL |
              (NodeFS.constants.O_NOFOLLOW ?? 0),
          }),
        catch: (cause) => operationError("write-file", realTargetPath, cause),
      });
    }
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  // T3 Zip: the entry itself, not what a final symlink points to. The parent is resolved, the
  // last name is kept, so renaming or deleting a link changes the link only.
  const resolveEntryTarget = Effect.fn("WorkspaceFileSystem.resolveEntryTarget")(function* (
    input: Pick<ProjectWriteFileInput, "cwd" | "relativePath">,
  ) {
    const target = yield* resolveWriteTarget(input);
    const entryPath = yield* Effect.tryPromise({
      try: async () =>
        path.join(
          await NodeFSP.realpath(path.dirname(target.namedTargetPath)),
          path.basename(target.namedTargetPath),
        ),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.realTargetPath,
          operationPath: path.dirname(target.namedTargetPath),
          operation: "realpath-target",
          cause,
        }),
    });
    if (
      entryPath === target.realWorkspaceRoot ||
      !isInsideRealRoot(target.realWorkspaceRoot, entryPath) ||
      (yield* Effect.promise(() => isInGitFolder(entryPath).catch(() => true)))
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: target.realWorkspaceRoot,
        resolvedPath: entryPath,
      });
    }
    return { relativePath: target.relativePath, entryPath };
  });

  const entryChangeError =
    (
      input: Pick<ProjectWriteFileInput, "cwd" | "relativePath">,
      operation: WorkspaceEntryChangeError["operation"],
      operationPath: string,
    ) =>
    (cause: unknown) =>
      new WorkspaceEntryChangeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        operationPath,
        operation,
        cause,
      });

  const lstatOrNull = (entryPath: string) =>
    NodeFSP.lstat(entryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });

  // T3 Zip: renames never replace an entry. A regular file is hard-linked to the new name, which
  // fails with EEXIST atomically, then the old name is unlinked. Folders and symlinks cannot be
  // hard-linked, so they are checked and then renamed; in that window rename(2) can replace only
  // an empty folder, since it refuses a non-empty folder or a file in place of a folder.
  const renameEntry: WorkspaceFileSystem["Service"]["renameEntry"] = Effect.fn(
    "WorkspaceFileSystem.renameEntry",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const source = yield* resolveEntryTarget(input);
    const destinationInput = { cwd: input.cwd, relativePath: input.newRelativePath };
    const destination = yield* resolveEntryTarget(destinationInput);
    const from = source.entryPath;
    const to = destination.entryPath;
    const exists = () =>
      new WorkspaceEntryExistsError({
        workspaceRoot: input.cwd,
        relativePath: input.newRelativePath,
        resolvedPath: to,
      });
    const sourceStat = yield* Effect.tryPromise({
      try: () => NodeFSP.lstat(from),
      catch: entryChangeError(input, "lstat", from),
    });
    const destinationStat = yield* Effect.tryPromise({
      try: () => lstatOrNull(to),
      catch: entryChangeError(destinationInput, "lstat", to),
    });
    // A case-only rename on a case-insensitive volume finds the source itself at the new name.
    const sameEntry =
      destinationStat !== null &&
      destinationStat.ino === sourceStat.ino &&
      destinationStat.dev === sourceStat.dev;
    if (destinationStat !== null && !sameEntry) return yield* exists();

    const rename = Effect.tryPromise({
      try: () => NodeFSP.rename(from, to),
      catch: entryChangeError(input, "rename", from),
    });
    if (sameEntry || !sourceStat.isFile()) {
      yield* rename;
    } else {
      const linked = yield* Effect.tryPromise({
        try: () =>
          NodeFSP.link(from, to).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              // Volumes without hard links fall back to the checked rename above.
              if (error.code === "EPERM" || error.code === "ENOTSUP" || error.code === "EXDEV") {
                return false;
              }
              throw error;
            },
          ),
        catch: (cause) =>
          (cause as NodeJS.ErrnoException).code === "EEXIST"
            ? exists()
            : entryChangeError(input, "rename", from)(cause),
      });
      if (linked) {
        yield* Effect.tryPromise({
          try: () => NodeFSP.unlink(from),
          catch: entryChangeError(input, "remove", from),
        });
      } else {
        yield* rename;
      }
    }
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: destination.relativePath };
  });

  const deleteEntry: WorkspaceFileSystem["Service"]["deleteEntry"] = Effect.fn(
    "WorkspaceFileSystem.deleteEntry",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const target = yield* resolveEntryTarget(input);
    const entryPath = target.entryPath;
    yield* Effect.tryPromise({
      try: () => NodeFSP.lstat(entryPath),
      catch: entryChangeError(input, "lstat", entryPath),
    });
    if (input.mode === "trash") {
      // macOS 15 and later ship /usr/bin/trash. Without it the delete fails rather than
      // silently becoming permanent.
      if ((yield* HostProcess.Platform) !== "darwin") {
        return yield* new WorkspaceEntryChangeError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          operationPath: entryPath,
          operation: "trash",
          trashUnavailable: true,
        });
      }
      yield* Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            NodeChildProcess.execFile(
              "/usr/bin/trash",
              ["-s", entryPath],
              { timeout: 30_000 },
              (error) => (error ? reject(error) : resolve()),
            );
          }),
        catch: (cause) =>
          new WorkspaceEntryChangeError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            operationPath: entryPath,
            operation: "trash",
            ...((cause as NodeJS.ErrnoException).code === "ENOENT"
              ? { trashUnavailable: true }
              : {}),
            cause,
          }),
      });
    } else {
      yield* Effect.tryPromise({
        // rm removes a symlink itself, never what it points to.
        try: () => NodeFSP.rm(entryPath, { recursive: true }),
        catch: entryChangeError(input, "remove", entryPath),
      });
    }
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  return WorkspaceFileSystem.of({
    getMetadata,
    readFile,
    writeFile,
    createEntry,
    renameEntry,
    deleteEntry,
  });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
