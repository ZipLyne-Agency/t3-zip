/**
 * T3 Zip is a personal fork of T3 Code that runs beside it. A build made with
 * T3ZIP_BUILD=1 gets its own name, data folder, Electron profile, app id and
 * port, and never takes T3 Code's update feed. Without the flag (tests, upstream
 * builds) every value below matches T3 Code, so upstream behavior is unchanged.
 */
declare const __T3ZIP_BUILD__: boolean | undefined;
declare const __T3ZIP_APP_ID__: string | undefined;
declare const __T3ZIP_UPDATE_SCRIPT__: string | undefined;

export const T3_ZIP = typeof __T3ZIP_BUILD__ !== "undefined" && __T3ZIP_BUILD__ === true;

export const T3_ZIP_NAME = "T3 Zip";
/** Data folder under the home directory, beside T3 Code's `.t3`. */
export const T3_ZIP_HOME_DIRECTORY = ".t3-zip";
/** Electron profile folder; a separate one keeps Chromium's lock and databases apart. */
export const T3_ZIP_USER_DATA_DIRECTORY = "t3zip";
/** The bundle id the build was made with (scripts/t3zip.local.env), "local.t3zip" by default. */
export const T3_ZIP_APP_USER_MODEL_ID =
  typeof __T3ZIP_APP_ID__ === "string" ? __T3ZIP_APP_ID__ : "local.t3zip";
/** First backend port to try, above T3 Code's 3773 so T3 Code keeps its usual port. */
export const T3_ZIP_BACKEND_PORT = 3873;
/** Keeps T3 Code's download updater off in T3 Zip even if it is ever constructed. */
export const T3_ZIP_UPDATES_DISABLED_REASON =
  "T3 Zip updates come from rebuilding the t3-zip branch.";
/**
 * Merges the newest upstream nightly into the fork, builds it and installs it. T3 Zip's update
 * button reads what this leaves behind and starts its install (updates/T3ZipUpdates.ts).
 */
export const T3_ZIP_UPDATE_SCRIPT =
  typeof __T3ZIP_UPDATE_SCRIPT__ === "string" ? __T3ZIP_UPDATE_SCRIPT__ : "";
