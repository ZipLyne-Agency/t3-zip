// @effect-diagnostics nodeBuiltinImport:off -- The install must outlive this app, which a scoped Effect process cannot.
import * as NodeChildProcess from "node:child_process";

import { T3_ZIP_UPDATE_SCRIPT } from "../app/T3Zip.ts";

export interface T3ZipScriptResult {
  readonly code: number;
  readonly output: string;
}

/** Runs one command of the update script and waits for it. Never rejects. */
export function runT3ZipUpdateScript(command: string): Promise<T3ZipScriptResult> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      "/bin/bash",
      [T3_ZIP_UPDATE_SCRIPT, command],
      { timeout: 30_000 },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, output: String(stdout).trim() });
      },
    );
  });
}

/**
 * Starts one command of the update script in its own session, so it keeps running when it
 * closes this app to swap it. Resolves with the exit code if this app is still running by then.
 */
export function startT3ZipUpdateScript(
  command: string,
  env: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn("/bin/bash", [T3_ZIP_UPDATE_SCRIPT, command], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
    child.unref();
  });
}
