#!/usr/bin/env bash
# Nightly updater for the T3 Zip fork (branch t3-zip of pingdotgg/t3code).
#
#   sync      merge the newest upstream nightly tag, verify, build, stage, then push
#             the branch to the private copy (remote "zip")
#   install   put a staged build in /Applications; unattended, only when no thread is running
#   can-install  exit 0 when a staged build can be installed now, else print why and exit 4
#   tick      what launchd runs every 30 minutes: sync once a day; it installs
#             only while the app is closed, since an open app shows an Update button
#   run       sync then install, by hand
#   rebuild   build the checkout as it stands, uncommitted changes included, and stage it
#   status    read-only summary
#   rollback  put the previous app back (the database is not rolled back)
#   schedule  install the launchd job that runs tick (from t3zip-update.launchd.plist)
#   adopt     switching over from T3 Code: replace T3 Zip's data with a fresh copy of
#             T3 Code's, taken while T3 Code is idle (scripts/t3zip-adopt.py)
#   takeover  once T3 Code is closed for good: its scheduled tasks move to T3 Zip
#
# T3ZIP_UPDATE_DRY_RUN=1 makes sync, install, tick and rollback report what they
# would do without changing the repo, the app or the database.

set -euo pipefail

export HOME="${HOME:-$(cd ~ && pwd)}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# The checkout this script lives in.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPO
export PATH="$REPO/node_modules/.bin:/opt/homebrew/bin:$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Machine settings that stay out of the repo: the app's bundle id, the signing identity,
# notification hooks. See scripts/t3zip.local.env.example. Unset values use the defaults below.
readonly LOCAL_CONFIG="$REPO/scripts/t3zip.local.env"
if [[ -f "$LOCAL_CONFIG" ]]; then
  # shellcheck source=/dev/null
  source "$LOCAL_CONFIG"
fi
readonly BRANCH="t3-zip"
readonly FAILED_BRANCH="t3zip/failed-update"
# The private copy of the fork; the branch is pushed there after each verified build.
readonly BACKUP_REMOTE="zip"
readonly NODE="${T3ZIP_NODE:-$(command -v node)}"
readonly BUNDLE_ID="${T3ZIP_BUNDLE_ID:-local.t3zip}"
# The build reads the same id, so the app and this script always agree.
export T3ZIP_BUNDLE_ID="$BUNDLE_ID"
readonly APP="/Applications/T3 Zip.app"
readonly APP_NEW="/Applications/T3 Zip.app.new"
readonly APP_PROCESS_PATTERN="/Applications/T3 Zip.app/Contents/"
readonly CACHE="$HOME/Library/Caches/t3zip"
readonly BUILD_DIR="$CACHE/build"
readonly PREVIOUS_DIR="$CACHE/previous"
readonly PREVIOUS_APP="$PREVIOUS_DIR/T3 Zip.app.previous"
readonly SWAP_APP="$PREVIOUS_DIR/T3 Zip.app.swap"
readonly STAGED="$CACHE/staged.json"
readonly INSTALLED="$CACHE/installed.json"
# The last problem that needs someone; the app shows it on its update button.
readonly ATTENTION="$CACHE/attention.json"
readonly LAST_SYNC_DATE="$CACHE/last-sync-date"
readonly LOCK="$CACHE/lock"
readonly LOG="$HOME/Library/Logs/t3zip-update.log"
# Optional: a file that collects one JSON line per notice, and a script that shows banners
# in place of the built-in macOS notification. Both are off unless the local config sets them.
readonly ALERTS="${T3ZIP_ALERTS_FILE:-}"
readonly NOTIFY_HELPER="${T3ZIP_NOTIFY_HELPER:-}"
readonly DATA_HOME="$HOME/.t3-zip"
readonly DB="$DATA_HOME/userdata/statev2.sqlite"
readonly BACKUPS="$DATA_HOME/backups"
# T3 Code's own data, read by adopt and takeover when switching over to T3 Zip.
# T3ZIP_CODE_HOME points adopt at another copy, for rehearsing against a throwaway one.
readonly CODE_HOME="${T3ZIP_CODE_HOME:-$HOME/.t3}"
readonly CODE_DB="$CODE_HOME/userdata/statev2.sqlite"
readonly ADOPT_TOOL="$REPO/scripts/t3zip-adopt.py"
readonly ADOPTED="$CACHE/adopted.json"
readonly INCOMING_DB="$DATA_HOME/userdata/statev2.incoming.sqlite"
readonly NOTICE_TITLE="T3 Zip update"
readonly TERMINAL_STATUSES="'completed','failed','cancelled','interrupted','rolled_back'"
readonly LOCK_STALE_SECONDS=10800
readonly QUIT_TIMEOUT_SECONDS=60

DRY_RUN="${T3ZIP_UPDATE_DRY_RUN:-0}"
[[ "$DRY_RUN" == "1" ]] || DRY_RUN=0

# ---------------------------------------------------------------------------
# Logging, notices, JSON
# ---------------------------------------------------------------------------

# Appends one timestamped line to the log, and echoes it when run from a terminal.
log() {
  local line
  line="$(date '+%Y-%m-%dT%H:%M:%S%z') $*"
  mkdir -p "$(dirname "$LOG")"
  printf '%s\n' "$line" >>"$LOG"
  if [[ -t 2 ]]; then printf '%s\n' "$line" >&2; fi
}

# Tells the owner something needs action: a banner plus one line in the alerts file.
# In dry-run mode it only prints the notice.
notify() {
  local subject="$1" message="$2"
  log "NOTICE [$subject] $message"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would notify [%s] %s\n' "$subject" "$message"
    return 0
  fi
  if [[ -n "$NOTIFY_HELPER" && -f "$NOTIFY_HELPER" ]]; then
    bash "$NOTIFY_HELPER" "$NOTICE_TITLE" "$message" Glass >/dev/null 2>&1 || true
  else
    /usr/bin/osascript -e 'on run argv' \
      -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
      -e 'end run' "$NOTICE_TITLE" "$message" >/dev/null 2>&1 || true
  fi
  write_attention "$subject" "$message"
  [[ -n "$ALERTS" ]] || return 0
  mkdir -p "$(dirname "$ALERTS")"
  python3 -c '
import json, sys, time
print(json.dumps({"at": int(time.time()), "subject": sys.argv[1], "title": sys.argv[2], "message": sys.argv[3]}))
' "$subject" "$NOTICE_TITLE" "$message" >>"$ALERTS" 2>/dev/null || true
}

# Records the problem the app's update button shows until a later run clears it.
write_attention() {
  mkdir -p "$CACHE"
  python3 -c '
import json, os, sys, time
path, subject, message = sys.argv[1:4]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump({"subject": subject, "message": message,
               "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
' "$ATTENTION" "$1" "$2" || log "could not write $ATTENTION"
}

# Shows a banner for something that needs no action. Not written to the alerts file.
announce() {
  local message="$1"
  log "INFO $message"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would announce %s\n' "$message"
    return 0
  fi
  if [[ -n "$NOTIFY_HELPER" && -f "$NOTIFY_HELPER" ]]; then
    bash "$NOTIFY_HELPER" "$NOTICE_TITLE" "$message" >/dev/null 2>&1 || true
  else
    /usr/bin/osascript -e 'on run argv' \
      -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
      -e 'end run' "$NOTICE_TITLE" "$message" >/dev/null 2>&1 || true
  fi
}

# Prints one top-level string field of a JSON file, or nothing when absent.
json_get() {
  python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        v = json.load(f).get(sys.argv[2], "")
except Exception:
    v = ""
print("true" if v is True else "false" if v is False else "" if v is None else v)
' "$1" "$2"
}

# ---------------------------------------------------------------------------
# Lock
# ---------------------------------------------------------------------------

# Removes the lock this process holds.
release_lock() {
  rmdir "$LOCK" 2>/dev/null || true
}

# Set while /Applications may be mid-swap or the app was quit by this run.
APP_TOUCHED=0
WAS_RUNNING=0
# Set by tick: an install started by launchd leaves an open app alone.
LEAVE_OPEN_APP=0
# Set by adopt and takeover while they hold the app closed, so a failure reopens it.
REOPEN_ON_EXIT=0
# Set for commands run by hand, which say so when another run holds the lock.
LOCK_NOTICE=0
# Set by the app when its Update button starts the install: reopen in front.
FROM_APP="${T3ZIP_UPDATE_FROM_APP:-0}"

# Runs on every exit. If a run died while the app was down or mid-swap, it puts an
# app back in /Applications, reopens it if it was running, and sends a notice.
on_exit() {
  local rc=$?
  if [[ "$APP_TOUCHED" == "1" ]]; then
    APP_TOUCHED=0
    log "run stopped (exit $rc) while the app was being replaced; restoring"
    rm -rf "/Applications/T3 Zip.app.new"
    if [[ ! -d "$APP" && -d "$SWAP_APP" ]]; then
      mv "$SWAP_APP" "$APP" || true
    elif [[ ! -d "$APP" && -d "$PREVIOUS_APP" ]]; then
      mv "$PREVIOUS_APP" "$APP" || true
    fi
    if [[ "$WAS_RUNNING" == "1" && -d "$APP" ]]; then reopen_app; fi
    notify "t3zip-update-install" "The T3 Zip update stopped partway (exit $rc). An app was put back in /Applications. Log: $LOG"
  fi
  # A copy of T3 Code's data that was never installed is only good for the run that made it.
  if [[ -f "$INCOMING_DB" ]]; then rm -f "${INCOMING_DB:?}"; fi
  if [[ "$REOPEN_ON_EXIT" == "1" && -d "$APP" ]] && ! app_running; then
    REOPEN_ON_EXIT=0
    reopen_app
  fi
  release_lock
  exit "$rc"
}

# Guarantees only one mutating run at a time; a second run exits 0 quietly.
# A lock older than three hours is treated as abandoned and taken over.
acquire_lock() {
  mkdir -p "$CACHE"
  if ! mkdir "$LOCK" 2>/dev/null; then
    local mtime now
    mtime="$(stat -f %m "$LOCK" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if ((now - mtime > LOCK_STALE_SECONDS)); then
      log "taking over stale lock (age $((now - mtime))s)"
      rmdir "$LOCK" 2>/dev/null || true
      mkdir "$LOCK" 2>/dev/null || exit 0
    else
      if [[ "$LOCK_NOTICE" == "1" ]]; then
        printf 'Another T3 Zip update is running. Try again when it finishes.\n'
      fi
      exit 0
    fi
  fi
  trap on_exit EXIT
}

# ---------------------------------------------------------------------------
# App and database state
# ---------------------------------------------------------------------------

# True when any T3 Zip process is running.
app_running() {
  pgrep -f "$APP_PROCESS_PATTERN" >/dev/null 2>&1
}

# Prints "<active runs>|<active subagents>"; fails if the database cannot be read.
live_run_counts() {
  [[ -f "$DB" ]] || return 1
  /usr/bin/sqlite3 -readonly -cmd '.timeout 5000' "$DB" \
    "SELECT
       (SELECT count(*) FROM orchestration_v2_projection_runs
          WHERE coalesce(status, '') NOT IN ($TERMINAL_STATUSES)),
       (SELECT count(*) FROM orchestration_v2_projection_subagents
          WHERE coalesce(status, '') NOT IN ($TERMINAL_STATUSES));" 2>/dev/null
}

# True only when the database was read and shows no running thread or subagent.
app_idle() {
  local counts
  counts="$(live_run_counts)" || return 1
  [[ "$counts" == "0|0" ]]
}

# Asks the app to quit and waits for every process to exit; fails if it does not.
quit_app() {
  log "quitting T3 Zip"
  /usr/bin/osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  local waited=0
  while app_running; do
    if ((waited >= QUIT_TIMEOUT_SECONDS)); then
      log "T3 Zip did not exit within ${QUIT_TIMEOUT_SECONDS}s"
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  log "T3 Zip exited"
}

# Reopens the app in the background.
reopen_app() {
  log "reopening T3 Zip"
  # `open` hands this script's environment to the app, and every task it starts would inherit
  # the Update button's flag, letting a later install skip the running-task check.
  if [[ "$FROM_APP" == "1" ]]; then
    env -u T3ZIP_UPDATE_FROM_APP open "$APP" || log "could not reopen $APP"
  else
    # Started in the background, so it comes back without taking focus.
    env -u T3ZIP_UPDATE_FROM_APP open -g "$APP" || log "could not reopen $APP"
  fi
}

# True when the app is running and a thread or subagent is live, or the database
# cannot be read.
app_busy() {
  app_running && ! app_idle
}

# Quits the app if it is running and marks the app as touched, so on_exit restores
# it on any later failure. Sets WAS_RUNNING. Exits 1 with nothing changed if it will
# not quit.
quit_app_for_swap() {
  WAS_RUNNING=0
  if app_running; then
    WAS_RUNNING=1
    if ! quit_app; then
      WAS_RUNNING=0
      notify "t3zip-update-quit" "T3 Zip did not quit within ${QUIT_TIMEOUT_SECONDS}s, so nothing was changed. Log: $LOG"
      exit 1
    fi
  fi
  APP_TOUCHED=1
}

# ---------------------------------------------------------------------------
# sync
# ---------------------------------------------------------------------------

# Exits 1 with a notice unless the repo is on t3-zip, clean, and not mid-operation.
check_repo_preconditions() {
  local branch git_dir
  branch="$(git symbolic-ref --short -q HEAD || true)"
  if [[ "$branch" != "$BRANCH" ]]; then
    notify "t3zip-update-branch" "Skipped: $REPO is on '${branch:-detached HEAD}', not $BRANCH."
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    notify "t3zip-update-dirty" "Skipped: $REPO has uncommitted or untracked changes."
    exit 1
  fi
  git_dir="$(git rev-parse --git-dir)"
  if [[ -e "$git_dir/MERGE_HEAD" || -e "$git_dir/CHERRY_PICK_HEAD" || -e "$git_dir/REVERT_HEAD" \
     || -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]]; then
    notify "t3zip-update-inprogress" "Skipped: a merge, rebase or cherry-pick is in progress in $REPO."
    exit 1
  fi
}

# Prints the newest upstream nightly tag known locally.
newest_nightly_tag() {
  git tag -l 'v*-nightly.*' --sort=-v:refname | awk 'NR == 1'
}

# Runs one verification step with its output in the log; returns its status.
run_step() {
  local name="$1"
  shift
  log "step start: $name"
  if "$@" >>"$LOG" 2>&1; then
    log "step ok: $name"
    return 0
  else
    local rc=$?
    log "step failed: $name (exit $rc)"
    return "$rc"
  fi
}

# Steps, each run from a fixed directory.
step_install() { (cd "$REPO" && vp install --frozen-lockfile); }
step_typecheck() { (cd "$REPO" && vp run typecheck); }
step_unit_tests() { (cd "$REPO/apps/web" && vp test run --project unit); }
# The public T3 Connect settings upstream publishes in .env.example for source builds
# (docs/operations/connect-setup.md). Without them a build has no sign-in, no T3 Connect
# and no phone notifications.
readonly PUBLIC_CONFIG_NAMES=(
  T3CODE_CLERK_PUBLISHABLE_KEY
  T3CODE_CLERK_JWT_TEMPLATE
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID
  T3CODE_RELAY_URL
)

# Prints one public setting from .env.example, or nothing.
public_config_value() {
  sed -n "s|^$1=||p" "$REPO/.env.example" 2>/dev/null | awk 'NR == 1'
}

step_build() {
  rm -rf "${CACHE:?}/build"
  mkdir -p "$BUILD_DIR"
  (
    cd "$REPO"
    local name value
    for name in "${PUBLIC_CONFIG_NAMES[@]}"; do
      value="$(public_config_value "$name")"
      if [[ -n "$value" ]]; then export "$name=$value"; fi
    done
    T3ZIP_BUILD=1 "$NODE" scripts/build-desktop-artifact.ts \
      --platform mac --target dir --arch arm64 --output-dir "$BUILD_DIR"
  )
}

# Prints the path of the built app under the build directory.
built_app_path() {
  find "$BUILD_DIR" -maxdepth 3 -name 'T3 Zip.app' -type d | awk 'NR == 1'
}

# A stable Developer ID keeps T3 Zip one app to macOS across rebuilds, so privacy grants and
# any device profile that pre-approves them keep matching (scripts/t3zip-sign.ts). Without one
# the app is signed ad hoc ("-"), which works but macOS asks for privacy grants again after
# each update.
readonly SIGN_IDENTITY="${T3ZIP_SIGN_IDENTITY:--}"
readonly SIGN_TEAM="${T3ZIP_SIGN_TEAM:-}"

step_sign() {
  local app
  app="$(built_app_path)"
  [[ -n "$app" ]] || { echo "no T3 Zip.app under $BUILD_DIR"; return 1; }
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --deep --sign - "$app" || return 1
  else
    (cd "$REPO" && "$NODE" scripts/t3zip-sign.ts "$app" "$SIGN_IDENTITY") || return 1
  fi
  echo "signed $app as $SIGN_IDENTITY"
}

# Succeeds only when the built app is really T3 Zip, not a cached upstream build.
step_identity() {
  local app id
  app="$(built_app_path)"
  [[ -n "$app" ]] || { echo "no T3 Zip.app under $BUILD_DIR"; return 1; }
  id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
  [[ "$id" == "$BUNDLE_ID" ]] || { echo "bundle id is '$id', expected $BUNDLE_ID"; return 1; }
  codesign --verify --deep --strict "$app" || { echo "the signature does not verify"; return 1; }
  local signature
  signature="$(codesign -dv "$app" 2>&1)" || { echo "cannot read the signature"; return 1; }
  if [[ -n "$SIGN_TEAM" ]]; then
    [[ $'\n'"$signature"$'\n' == *$'\n'"TeamIdentifier=$SIGN_TEAM"$'\n'* ]] \
      || { echo "not signed by team $SIGN_TEAM, so the privacy profile would not match"; return 1; }
  fi
  LC_ALL=C grep -q -a -F '.t3-zip' "$app/Contents/Resources/app.asar" \
    || { echo "app.asar does not reference .t3-zip"; return 1; }
  # A build that lost T3 Connect would cut the phone off, so it must not be installed.
  local name value
  for name in "${PUBLIC_CONFIG_NAMES[@]}"; do
    value="$(public_config_value "$name")"
    [[ -n "$value" ]] || { echo ".env.example no longer sets $name, so T3 Connect would be off"; return 1; }
    LC_ALL=C grep -q -a -F "$value" "$app/Contents/Resources/app.asar" \
      || { echo "the build does not carry $name, so T3 Connect would be off"; return 1; }
  done
  echo "identity ok: $app"
}

# Runs every check and the build in order. On failure FAILED_STEP names the step.
FAILED_STEP=""
verify_and_build() {
  FAILED_STEP="install dependencies"
  run_step "$FAILED_STEP" step_install || return 1
  FAILED_STEP="typecheck"
  run_step "$FAILED_STEP" step_typecheck || return 1
  FAILED_STEP="web unit tests"
  run_step "$FAILED_STEP" step_unit_tests || return 1
  FAILED_STEP="build"
  run_step "$FAILED_STEP" step_build || return 1
  FAILED_STEP="sign"
  run_step "$FAILED_STEP" step_sign || return 1
  FAILED_STEP="identity check"
  run_step "$FAILED_STEP" step_identity || return 1
  FAILED_STEP=""
}

# Prints the commit of the newest build: the staged one, else the last one installed.
last_built_sha() {
  if [[ -f "$STAGED" ]]; then
    json_get "$STAGED" sha
    return 0
  fi
  last_installed_sha
}

# Prints the commit of the app in /Applications, or nothing when this script never installed one.
last_installed_sha() {
  python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        entries = json.load(f)
    print(entries[-1].get("sha", "") if entries else "")
except Exception:
    print("")
' "$INSTALLED"
}

# Prints true when the server's database migrations differ between two commits, or
# when the older commit is unknown.
migrations_changed() {
  local from="$1" to="$2"
  if [[ -z "$from" ]] || ! git cat-file -e "${from}^{commit}" 2>/dev/null; then
    echo true
    return 0
  fi
  if [[ -n "$(git diff --name-only "$from" "$to" -- apps/server/src/persistence/Migrations apps/server/src/persistence/Migrations.ts)" ]]; then
    echo true
  else
    echo false
  fi
}

# Builds and stages the branch as it stands, for commits made to t3-zip since the last
# build when upstream has nothing new. A failure changes nothing in the repo; exits 3.
build_current_head() {
  local tag="$1" head="$2" last="$3"
  log "building $BRANCH at ${head:0:7}: it has commits the last build (${last:0:7}) does not"
  rm -f "$STAGED"
  if ! verify_and_build; then
    notify "t3zip-update-failed" "Building $BRANCH at ${head:0:7} failed at '$FAILED_STEP'. The installed app is unchanged. Log: $LOG"
    exit 3
  fi
  # Compared with the installed app, so a staged build that never got installed is not skipped.
  write_staged "$tag" "$head" "$last" "$(built_app_path)" "$(migrations_changed "$(last_installed_sha)" "$head")"
  rm -f "$ATTENTION"
  log "staged $BRANCH at ${head:0:7}"
  push_backup
}

# Builds the checkout as it stands, uncommitted changes included, and stages it. For a
# change to the fork that should reach the app before it is committed; nothing is pushed,
# and sync builds again once the change is committed.
cmd_rebuild() {
  cd "$REPO"
  local head tag last
  if [[ "$(git symbolic-ref --short -q HEAD || true)" != "$BRANCH" ]]; then
    printf 'The checkout is not on %s, so nothing was built.\n' "$BRANCH"
    exit 4
  fi
  head="$(git rev-parse HEAD)"
  tag="$(git describe --tags --match 'v*-nightly.*' --abbrev=0 HEAD 2>/dev/null || newest_nightly_tag)"
  last="$(last_installed_sha)"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would check and build %s at %s with its uncommitted changes, and stage it as %s\n' \
      "$BRANCH" "${head:0:7}" "$tag"
    return 0
  fi
  log "building $BRANCH at ${head:0:7} as it stands"
  rm -f "$STAGED"
  if ! verify_and_build; then
    notify "t3zip-update-failed" "Building $BRANCH at ${head:0:7} failed at '$FAILED_STEP'. The installed app is unchanged. Log: $LOG"
    exit 3
  fi
  write_staged "$tag" "$head" "$last" "$(built_app_path)" "$(migrations_changed "$last" "$head")"
  rm -f "$ATTENTION"
  log "staged $BRANCH at ${head:0:7}"
}

# Pushes the branch to the private copy when that remote exists. A failed push is
# retried by the next run, so it only leaves a banner and a log line.
push_backup() {
  git remote get-url "$BACKUP_REMOTE" >/dev/null 2>&1 || return 0
  if GIT_TERMINAL_PROMPT=0 git push "$BACKUP_REMOTE" "$BRANCH" >>"$LOG" 2>&1; then
    log "pushed $BRANCH to $BACKUP_REMOTE"
  else
    announce "Could not push $BRANCH to the private copy ($BACKUP_REMOTE). The next run tries again. Log: $LOG"
  fi
  push_public
}

# ---------------------------------------------------------------------------
# public snapshot
# ---------------------------------------------------------------------------

# Paths that stay private: design mockups and the artifact ledger name real projects.
readonly PUBLIC_EXCLUDE=(claude_artifacts CLAUDE-ARTIFACTS.md scripts/t3zip.local.env)
# The last snapshot made, so each new one builds on it and the push is a fast-forward.
readonly PUBLIC_REF="refs/t3zip/public"

# Commits the branch's tree, minus PUBLIC_EXCLUDE and with the fork intro at the top of the
# README, onto the last snapshot. Prints the snapshot commit. History before the first
# snapshot never reaches it.
make_public_snapshot() {
  local index tree parent parent_tree readme_blob commit msg
  index="$(mktemp "${TMPDIR:-/tmp}/t3zip-public-index.XXXXXX")"
  GIT_INDEX_FILE="$index" git read-tree "$BRANCH"
  GIT_INDEX_FILE="$index" git rm --cached -r -q --ignore-unmatch -- "${PUBLIC_EXCLUDE[@]}"
  readme_blob="$(cat "$REPO/scripts/t3zip-public-readme.md" <(printf '\n---\n\n') \
    <(git show "$BRANCH:README.md") | git hash-object -w --stdin)"
  GIT_INDEX_FILE="$index" git update-index --cacheinfo "100644,$readme_blob,README.md"
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  rm -f "$index"
  parent="$(git rev-parse -q --verify "$PUBLIC_REF^{commit}" || true)"
  if [[ -n "$parent" ]]; then
    parent_tree="$(git rev-parse "$parent^{tree}")"
    if [[ "$parent_tree" == "$tree" ]]; then
      echo "$parent"
      return 0
    fi
  fi
  # The upstream nightly is a second parent, so the public branch shares T3 Code's history
  # and the next nightly merges into it cleanly. Fork commits stay out.
  local tag upstream parents=()
  tag="$(git describe --tags --abbrev=0 --match 'v*-nightly.*' "$BRANCH")"
  upstream="$(git rev-parse "$tag^{commit}")"
  [[ -n "$parent" ]] && parents+=(-p "$parent")
  if [[ -z "$parent" ]] || ! git merge-base --is-ancestor "$upstream" "$parent"; then
    parents+=(-p "$upstream")
  fi
  msg="T3 Zip on $tag ($(git rev-parse --short "$BRANCH"))"
  commit="$(git commit-tree "$tree" "${parents[@]}" -m "$msg")"
  git update-ref "$PUBLIC_REF" "$commit"
  echo "$commit"
}

# Pushes a fresh snapshot to T3ZIP_PUBLIC_REMOTE when the local config sets one. Never forces:
# if the public main moved on its own, the push fails and leaves a banner.
push_public() {
  local remote="${T3ZIP_PUBLIC_REMOTE:-}" commit
  [[ -n "$remote" ]] || return 0
  if ! commit="$(make_public_snapshot)"; then
    announce "Could not make the public snapshot. The next run tries again. Log: $LOG"
    return 0
  fi
  if GIT_TERMINAL_PROMPT=0 git push "$remote" "$commit:refs/heads/main" >>"$LOG" 2>&1; then
    log "public snapshot ${commit:0:7} is on $remote"
  else
    announce "Could not push the public snapshot to $remote. The next run tries again. Log: $LOG"
  fi
}

# Makes and pushes the public snapshot by hand. With T3ZIP_UPDATE_DRY_RUN=1 it only makes
# the snapshot commit locally and lists what it holds.
cmd_publish() {
  cd "$REPO"
  if [[ "$DRY_RUN" == "1" ]]; then
    local commit
    commit="$(make_public_snapshot)"
    echo "snapshot ${commit:0:7} (not pushed): $(git ls-tree -r --name-only "$commit" | wc -l | tr -d ' ') files"
    return 0
  fi
  [[ -n "${T3ZIP_PUBLIC_REMOTE:-}" ]] || { echo "set T3ZIP_PUBLIC_REMOTE in $LOCAL_CONFIG first"; exit 64; }
  push_public
}

# Puts t3-zip back where it was, keeps the failed merge on a branch, and exits 3.
fail_update() {
  local step="$1" tag="$2" prev="$3" merged="$4"
  log "update to $tag failed at: $step; keeping merge $merged on $FAILED_BRANCH"
  git branch -f "$FAILED_BRANCH" "$merged" >>"$LOG" 2>&1 || log "could not point $FAILED_BRANCH at $merged"
  # The tree was clean before the merge. If something edited the checkout during the
  # checks, a hard reset would delete that work, so leave everything where it is.
  if [[ -n "$(git status --porcelain)" ]]; then
    notify "t3zip-update-failed" "Update to $tag failed at '$step', and $REPO was edited meanwhile, so $BRANCH still has the merge. Undo it by hand with: git reset --keep ${prev:0:12}. Log: $LOG"
    exit 3
  fi
  if ! git reset --hard "${prev:?}" >>"$LOG" 2>&1; then
    notify "t3zip-update-failed" "Update to $tag failed at '$step' and resetting $BRANCH to ${prev:0:7} also failed. Fix $REPO by hand. Log: $LOG"
    exit 3
  fi
  run_step "reinstall dependencies after reset" step_install || true
  notify "t3zip-update-failed" "Update to $tag failed at '$step'. $BRANCH is back at ${prev:0:7}; the merge is on $FAILED_BRANCH. Log: $LOG"
  exit 3
}

# Writes staged.json describing the verified build, atomically.
write_staged() {
  local tag="$1" sha="$2" prev="$3" app="$4" migrations="$5"
  python3 -c '
import json, os, sys
path, tag, sha, prev, built_at, app, migrations = sys.argv[1:8]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump({"tag": tag, "sha": sha, "prevSha": prev, "builtAt": built_at,
               "appPath": app, "migrations": migrations == "true"}, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
' "$STAGED" "$tag" "$sha" "$prev" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$app" "$migrations"
}

# Reports, without changing anything, what a sync would merge.
sync_dry_run() {
  local tag="$1" behind conflicts
  behind="$(git rev-list --count "HEAD..$tag")"
  printf 'dry run: would merge %s (%s commits behind)\n' "$tag" "$behind"
  if conflicts="$(git merge-tree --write-tree --name-only HEAD "$tag" 2>&1)"; then
    printf 'dry run: merge-tree reports no conflicts\n'
  else
    printf 'dry run: merge-tree reports conflicts in:\n%s\n' "$(printf '%s\n' "$conflicts" | sed -n '2,/^$/p' | sed '/^$/d' | awk 'NR <= 8')"
  fi
  log "dry run: $tag is $behind commits ahead of HEAD"
}

# Brings t3-zip up to the newest nightly tag and stages a verified build.
# Exit 1: precondition failed; 2: merge conflict; 3: verification or build failed.
# Fetches in full what the checkout holds only by name between HEAD and the tag. The fetch
# in sync skips commits an earlier blobless fetch brought in, and the push needs their files.
fill_missing_objects() {
  local tag="$1" missing
  missing="$(git rev-list --objects --missing=print "HEAD..$tag" | grep -c '^?' || true)"
  if [[ "$missing" == "0" ]]; then return 0; fi
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would refetch %s in full (%s objects missing)\n' "$tag" "$missing"
    return 0
  fi
  log "refetching $tag in full: $missing objects are missing"
  GIT_TERMINAL_PROMPT=0 git fetch --no-filter --refetch --no-tags origin \
    "refs/tags/$tag:refs/tags/$tag" >>"$LOG" 2>&1 ||
    log "the full refetch of $tag failed; the push to $BACKUP_REMOTE may fail"
}

cmd_sync() {
  cd "$REPO"
  check_repo_preconditions
  log "fetching origin"
  # Release tags and main only, with every file included: this checkout is a partial
  # clone, and the push to the private copy needs complete history.
  if ! GIT_TERMINAL_PROMPT=0 git fetch --no-filter origin \
    'refs/tags/*:refs/tags/*' 'refs/heads/main:refs/remotes/origin/main' >>"$LOG" 2>&1; then
    # Usually no network yet after wake. Clear today's marker so the next tick retries.
    log "fetch failed; will retry on the next tick"
    if [[ "$DRY_RUN" != "1" ]]; then rm -f "$LAST_SYNC_DATE"; fi
    return 0
  fi

  local tag prev merged migrations app conflicted head last
  tag="$(newest_nightly_tag)"
  if [[ -z "$tag" ]]; then
    log "no nightly tag found"
    return 0
  fi
  fill_missing_objects "$tag"
  if git merge-base --is-ancestor "$tag" HEAD; then
    head="$(git rev-parse HEAD)"
    last="$(last_built_sha)"
    if [[ "$head" == "$last" ]]; then
      log "up to date: $tag is already in $BRANCH and ${head:0:7} is built"
      if [[ "$DRY_RUN" != "1" ]]; then push_backup; fi
      if [[ "$DRY_RUN" != "1" ]]; then rm -f "$ATTENTION"; fi
      if [[ "$DRY_RUN" == "1" ]]; then printf 'dry run: nothing to merge or build\n'; fi
      return 0
    fi
    if [[ "$DRY_RUN" == "1" ]]; then
      printf 'dry run: nothing to merge; would build %s at %s (last build: %s)\n' "$BRANCH" "${head:0:7}" "${last:-none}"
      return 0
    fi
    build_current_head "$tag" "$head" "$last"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    sync_dry_run "$tag"
    return 0
  fi

  prev="$(git rev-parse HEAD)"
  log "merging $tag into $BRANCH at ${prev:0:7}"
  if ! git merge --no-edit "$tag" >>"$LOG" 2>&1; then
    conflicted="$(git diff --name-only --diff-filter=U | awk 'NR <= 8' | paste -sd ',' - | sed 's/,/, /g')"
    git merge --abort >>"$LOG" 2>&1 || true
    notify "t3zip-update-conflict" "Merging $tag conflicts in: ${conflicted:-unknown}. Nothing changed. Log: $LOG"
    exit 2
  fi
  merged="$(git rev-parse HEAD)"

  rm -f "$STAGED"
  verify_and_build || fail_update "$FAILED_STEP" "$tag" "$prev" "$merged"

  app="$(built_app_path)"
  # Compared with the installed app, so migrations in commits made here count too.
  last="$(last_installed_sha)"
  migrations="$(migrations_changed "${last:-$prev}" "$merged")"
  write_staged "$tag" "$merged" "$prev" "$app" "$migrations"
  rm -f "$ATTENTION"
  log "staged $tag (${merged:0:7}) at $app, migrations=$migrations"
  push_backup
}

# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------

# Clones the database files into a new backup directory and prints its path.
backup_database() {
  local short="$1" dir name
  dir="$BACKUPS/$(date -u +%Y%m%dT%H%M%SZ)-$short"
  mkdir -p "$dir"
  for name in statev2.sqlite statev2.sqlite-wal statev2.sqlite-shm; do
    if [[ -f "$DATA_HOME/userdata/$name" ]]; then
      cp -c "$DATA_HOME/userdata/$name" "$dir/$name" || return 1
    fi
  done
  printf '%s\n' "$dir"
}

# Prints backup directory names, newest first; only timestamp-shaped names are listed.
backup_names() {
  local path name
  [[ -d "$BACKUPS" ]] || return 0
  for path in "$BACKUPS"/*; do
    [[ -d "$path" ]] || continue
    name="${path##*/}"
    if [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]*$ ]]; then printf '%s\n' "$name"; fi
  done | sort -r
}

# Keeps the two newest backup directories and deletes the rest.
prune_backups() {
  local name
  # Names sort by their UTC timestamp prefix; only names of that shape are touched.
  backup_names | tail -n +3 \
    | while IFS= read -r name; do
        log "removing old backup $name"
        rm -rf "${BACKUPS:?}/${name:?}"
      done
}

# Appends an entry to installed.json.
record_installed() {
  python3 -c '
import json, os, sys, time
path, tag, sha = sys.argv[1:4]
try:
    with open(path) as f:
        entries = json.load(f)
    if not isinstance(entries, list):
        entries = [entries]
except Exception:
    entries = []
entries.append({"tag": tag, "sha": sha,
                "installedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(entries, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
' "$INSTALLED" "$1" "$2"
}

# Puts the outgoing app back after a failed copy, reopens it if it was running, exits 1.
restore_after_failed_copy() {
  local reason="$1"
  APP_TOUCHED=0
  rm -rf "/Applications/T3 Zip.app.new"
  if [[ -d "$PREVIOUS_APP" && ! -e "$APP" ]]; then
    mv "$PREVIOUS_APP" "$APP" || log "could not move $PREVIOUS_APP back"
  fi
  if [[ "$WAS_RUNNING" == "1" ]]; then reopen_app; fi
  notify "t3zip-update-install" "Installing the staged T3 Zip failed ($reason). The old app is back in place. Log: $LOG"
  exit 1
}

# Installs the staged build; unattended runs wait for no running thread. Quiet no-op when nothing is staged.
cmd_install() {
  [[ -f "$STAGED" ]] || return 0
  local tag sha prev app migrations backup=""
  tag="$(json_get "$STAGED" tag)"
  sha="$(json_get "$STAGED" sha)"
  prev="$(json_get "$STAGED" prevSha)"
  app="$(json_get "$STAGED" appPath)"
  migrations="$(json_get "$STAGED" migrations)"
  [[ -n "$app" && -d "$app" ]] || return 0

  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would install %s (%s) from %s\n' "$tag" "${sha:0:7}" "$app"
    if app_running; then
      printf 'dry run: app is running; live runs %s; would %s\n' "$(live_run_counts || echo unreadable)" \
        "$( (app_idle || [[ "$FROM_APP" == "1" ]]) && echo 'quit it, install, and reopen it' || echo 'wait and retry')"
    else
      printf 'dry run: app is not running; would install without reopening\n'
    fi
    printf 'dry run: would clone the database into %s/<timestamp>-%s and keep the 2 newest backups\n' "$BACKUPS" "${prev:0:7}"
    printf 'dry run: would move %s to %s\n' "$APP" "$PREVIOUS_APP"
    return 0
  fi

  # From the Update button the person chose to restart now, after a confirmation that says what
  # happens to running threads: they continue when the reopened app has continueThreadsAfterServerUpdate
  # on for their project, and stay stopped otherwise. Unattended runs still wait for an idle app.
  if [[ "$FROM_APP" != "1" ]] && app_busy; then
    log "busy, will retry (live runs: $(live_run_counts || echo unreadable))"
    return 0
  fi
  if [[ "$FROM_APP" == "1" ]]; then
    log "installing from the Update button (live runs: $(live_run_counts || echo unreadable))"
  fi
  # The scheduled job never closes an open app: it shows an Update button instead.
  if [[ "$LEAVE_OPEN_APP" == "1" ]] && app_running; then
    log "T3 Zip is open; the staged build waits for its Update button"
    return 0
  fi
  quit_app_for_swap

  if ! backup="$(backup_database "${prev:0:7}")"; then
    APP_TOUCHED=0
    if [[ "$WAS_RUNNING" == "1" ]]; then reopen_app; fi
    notify "t3zip-update-backup" "Database backup failed, so T3 Zip was not updated. Log: $LOG"
    exit 1
  fi
  log "database backed up to $backup"
  prune_backups

  mkdir -p "$PREVIOUS_DIR"
  rm -rf "${PREVIOUS_DIR:?}/T3 Zip.app.previous" "${PREVIOUS_DIR:?}/T3 Zip.app.swap"
  if [[ -d "$APP" ]]; then
    mv "$APP" "$PREVIOUS_APP"
  fi
  rm -rf "/Applications/T3 Zip.app.new"
  log "copying $app to $APP_NEW"
  ditto "$app" "$APP_NEW" >>"$LOG" 2>&1 || restore_after_failed_copy "ditto failed"
  mv "$APP_NEW" "$APP" || restore_after_failed_copy "rename failed"
  log "installed $tag (${sha:0:7})"
  APP_TOUCHED=0

  if [[ "$WAS_RUNNING" == "1" ]]; then reopen_app; fi
  rm -f "$STAGED" "$ATTENTION"
  record_installed "$tag" "$sha" || log "could not update $INSTALLED"

  local message="T3 Zip updated to $tag"
  if [[ "$migrations" == "true" ]]; then
    message="$message. It includes database migrations; the database was backed up to $backup"
  fi
  announce "$message"
}

# ---------------------------------------------------------------------------
# adopt, takeover: switching over from T3 Code
# ---------------------------------------------------------------------------

# True while any process has T3 Code's database open, which is how its server shows.
code_running() {
  lsof -t -- "$CODE_DB" >/dev/null 2>&1
}

# Runs one command of the data tool; its report goes to the terminal and the log.
adopt_tool() {
  local rc=0
  python3 "$ADOPT_TOOL" "$@" --code-home "$CODE_HOME" --zip-home "$DATA_HOME" \
    --incoming "$INCOMING_DB" --record "$ADOPTED" 2>&1 | tee -a "$LOG" || rc=$?
  return "$rc"
}

# Closes T3 Zip for a data change, refusing while it runs a task. Leaves the app
# marked for reopening on any exit.
close_app_for_data() {
  if app_busy; then
    printf 'T3 Zip is running a task (%s). Nothing was changed; try again when it finishes.\n' \
      "$(live_run_counts || echo unreadable)"
    exit 4
  fi
  quit_app_for_swap
  APP_TOUCHED=0
  REOPEN_ON_EXIT=1
}

# Turns on in T3 Zip what T3 Code did by itself. Only ever called with T3 Code closed.
take_over_from_code() {
  adopt_tool takeover || {
    notify "t3zip-update-takeover" "T3 Zip could not take over T3 Code's scheduled tasks. Log: $LOG"
    exit 1
  }
}

# Copies T3 Code's data into T3 Zip. The copy is made while T3 Zip stays open; T3 Zip
# closes only to swap it in, and is left closed for the caller to reopen.
copy_code_data() {
  local replace=()
  if [[ "${1:-}" == "--replace" ]]; then replace=(--replace); fi

  adopt_tool check ${replace[@]+"${replace[@]}"} || return $?
  if app_busy; then
    printf 'T3 Zip is running a task (%s). Nothing was changed; try again when it finishes.\n' \
      "$(live_run_counts || echo unreadable)"
    return 4
  fi
  log "copying T3 Code's data; T3 Zip stays open until the copy is ready"
  adopt_tool snapshot || return $?
  close_app_for_data
  adopt_tool install || return $?
}

# Installs a build waiting on the Update button and opens T3 Zip in front.
finish_and_open() {
  # One restart for both jobs.
  cmd_install
  REOPEN_ON_EXIT=0
  log "opening T3 Zip"
  open "$APP" || log "could not open $APP"
}

# Replaces T3 Zip's data with a fresh copy of T3 Code's, checks it, and reopens T3 Zip.
cmd_adopt() {
  if [[ "$DRY_RUN" == "1" ]]; then
    adopt_tool check || exit $?
    printf 'dry run: would copy %s, close T3 Zip, move its data to %s/pre-switch-<time>, put the copy in, and reopen it\n' \
      "$CODE_DB" "$BACKUPS"
    if code_running; then
      printf 'dry run: T3 Code is open, so scheduled tasks would stay paused until takeover\n'
    else
      printf 'dry run: T3 Code is closed, so T3 Zip would also take over its scheduled tasks\n'
    fi
    if [[ -f "$STAGED" ]]; then printf 'dry run: would install the staged build in the same restart\n'; fi
    return 0
  fi

  copy_code_data "${1:-}" || exit $?
  if ! code_running; then take_over_from_code; fi
  finish_and_open
  if code_running; then
    printf '\nT3 Zip has your conversations. Check it, close T3 Code, then run: %s takeover\n' "$0"
  else
    printf '\nT3 Zip has your conversations and has taken over from T3 Code.\n'
  fi
}

# Run after T3 Code is closed for good. Brings over anything T3 Code did after the
# copy, then moves its scheduled tasks and the other things it did by itself to T3 Zip.
# --replace drops messages written in T3 Zip since the copy; --keep leaves T3 Zip's
# data as it is and skips what is new in T3 Code.
cmd_takeover() {
  if [[ ! -f "$ADOPTED" ]]; then
    printf "T3 Zip has not copied T3 Code's data yet. Run adopt first.\n"
    exit 4
  fi
  if [[ -n "$(json_get "$ADOPTED" takenOverAt)" ]]; then
    printf 'T3 Zip already took over from T3 Code on %s.\n' "$(json_get "$ADOPTED" takenOverAt)"
    return 0
  fi
  if code_running; then
    printf 'T3 Code is still open. Quit it, then run this again.\n'
    exit 4
  fi

  local changed=0
  adopt_tool changed || changed=$?
  if [[ "$changed" != "0" && "$changed" != "3" ]]; then exit "$changed"; fi
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would %sclose T3 Zip, switch on its scheduled tasks, pause them in T3 Code, and reopen T3 Zip\n' \
      "$([[ "$changed" == "3" && "${1:-}" != "--keep" ]] && echo 'copy T3 Code again, ' || true)"
    return 0
  fi

  if [[ "$changed" == "3" && "${1:-}" != "--keep" ]]; then
    local rc=0
    copy_code_data "${1:-}" || rc=$?
    if [[ "$rc" != "0" ]]; then
      if [[ "$rc" == "4" ]]; then
        printf "Or run 'takeover --keep' to leave T3 Zip's data as it is and move only the scheduled tasks.\n"
      fi
      exit "$rc"
    fi
  else
    close_app_for_data
  fi
  take_over_from_code
  finish_and_open
  printf '\nT3 Zip has taken over from T3 Code.\n'
}

# ---------------------------------------------------------------------------
# tick, run, rollback, status
# ---------------------------------------------------------------------------

# Installs anything staged, then syncs at most once per day from 04:00 local time.
cmd_tick() {
  LEAVE_OPEN_APP=1
  cmd_install
  local hour today
  hour="$(date +%H)"
  today="$(date +%F)"
  if ((10#$hour < 4)); then return 0; fi
  if [[ -f "$LAST_SYNC_DATE" && "$(cat "$LAST_SYNC_DATE")" == "$today" ]]; then return 0; fi
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would record %s as the sync date and run sync, then install\n' "$today"
  else
    printf '%s\n' "$today" >"$LAST_SYNC_DATE"
  fi
  cmd_sync
  cmd_install
}

# Says whether install would go ahead right now. Prints the reason and exits 4 when not.
# Read-only and lock-free: the app asks this before it starts an install.
cmd_can_install() {
  if [[ ! -f "$STAGED" ]]; then
    echo "No update is ready to install."
    exit 4
  fi
  if [[ -d "$LOCK" ]]; then
    local mtime now
    mtime="$(stat -f %m "$LOCK" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if ((now - mtime <= LOCK_STALE_SECONDS)); then
      echo "An update is being prepared. Try again in a few minutes."
      exit 4
    fi
  fi
}

# Syncs and installs in one go.
cmd_run() {
  cmd_sync
  cmd_install
}

# Prints the newest backup directory, or nothing.
newest_backup() {
  backup_names | awk -v dir="$BACKUPS" 'NR == 1 { print dir "/" $0 }'
}

# Swaps the previous app back into /Applications; the current app becomes the
# previous one, so running rollback again undoes it. Never touches git or the database.
cmd_rollback() {
  if [[ ! -d "$PREVIOUS_APP" ]]; then
    echo "No previous app at $PREVIOUS_APP; nothing to roll back to."
    exit 1
  fi
  local backup
  backup="$(newest_backup)"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'dry run: would swap %s and %s\n' "$APP" "$PREVIOUS_APP"
    printf 'dry run: app running: %s; live runs %s\n' "$(app_running && echo yes || echo no)" "$(live_run_counts || echo unreadable)"
    return 0
  fi

  if app_busy; then
    echo "T3 Zip has a running thread (live runs: $(live_run_counts || echo unreadable)); not rolling back."
    exit 1
  fi
  rm -rf "${PREVIOUS_DIR:?}/T3 Zip.app.swap"
  quit_app_for_swap

  if [[ -d "$APP" ]]; then mv "$APP" "$SWAP_APP"; fi
  mv "$PREVIOUS_APP" "$APP"
  if [[ -d "$SWAP_APP" ]]; then mv "$SWAP_APP" "$PREVIOUS_APP"; fi
  APP_TOUCHED=0
  log "rolled back: previous app restored to $APP"
  if [[ "$WAS_RUNNING" == "1" ]]; then reopen_app; fi

  echo "Rolled back $APP to the previous build."
  echo "WARNING: the database was not rolled back. If the newer build migrated it, the older app may not read it."
  echo "Newest database backup: ${backup:-none}"
}

# Prints a read-only summary of repo, staging, install and app state.
cmd_status() {
  cd "$REPO"
  local branch head tag behind="?" staged="none" installed="none" counts
  branch="$(git symbolic-ref --short -q HEAD || echo 'detached')"
  head="$(git log -1 --format='%h %s' HEAD 2>/dev/null || echo unknown)"
  tag="$(newest_nightly_tag || true)"
  if [[ -n "$tag" ]]; then
    behind="$(git rev-list --count "HEAD..$tag" 2>/dev/null || echo '?')"
  fi
  if [[ -f "$STAGED" ]]; then
    staged="$(json_get "$STAGED" tag) built $(json_get "$STAGED" builtAt) migrations=$(json_get "$STAGED" migrations)"
  fi
  if [[ -f "$INSTALLED" ]]; then
    installed="$(python3 -c '
import json, sys
try:
    e = json.load(open(sys.argv[1]))[-1]
    print(e.get("tag", "?"), e.get("sha", "")[:7], e.get("installedAt", ""))
except Exception:
    print("unreadable")
' "$INSTALLED")"
  fi
  counts="$(live_run_counts || echo unreadable)"

  echo "Branch:          $branch"
  echo "HEAD:            $head"
  echo "Newest nightly:  ${tag:-none} (HEAD is $behind commits behind; local tags, not fetched)"
  echo "Staged build:    $staged"
  echo "Last installed:  $installed"
  echo "App running:     $(app_running && echo yes || echo no)"
  if [[ "$counts" == *"|"* ]]; then
    echo "Live runs:       ${counts%%|*} runs, ${counts#*|} subagents"
  else
    echo "Live runs:       $counts"
  fi
  echo "Last sync date:  $(cat "$LAST_SYNC_DATE" 2>/dev/null || echo never)"
  if [[ -f "$ADOPTED" ]]; then
    local taken
    taken="$(json_get "$ADOPTED" takenOverAt)"
    echo "T3 Code data:    copied $(json_get "$ADOPTED" adoptedAt); takeover ${taken:-not yet}"
  else
    echo "T3 Code data:    not copied by adopt yet"
  fi
  echo "Log ($LOG), last 5 lines:"
  if [[ -f "$LOG" ]]; then tail -n 5 "$LOG" | sed 's/^/  /'; else echo "  (no log yet)"; fi
}

# Installs the launchd job that runs tick every 30 minutes, from the template beside this
# script. Rewrites and reloads it only when the rendered file differs from the installed one.
cmd_schedule() {
  local label="$BUNDLE_ID-update"
  local target="$HOME/Library/LaunchAgents/$label.plist"
  local rendered
  rendered="$(sed -e '/Template:/d' -e "s|@LABEL@|$label|g" -e "s|@REPO@|$REPO|g" \
    -e "s|@HOME@|$HOME|g" "$REPO/scripts/t3zip-update.launchd.plist")"
  if [[ -f "$target" ]] && [[ "$rendered" == "$(cat "$target")" ]]; then
    echo "$target is up to date"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "dry run: would write $target and load it:"
    diff <(cat "$target" 2>/dev/null) <(printf '%s\n' "$rendered") || true
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  printf '%s\n' "$rendered" >"$target"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$target"
  echo "installed and loaded $target"
}

# Prints usage.
usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

  sync      merge the newest upstream nightly tag into $BRANCH, verify, build, stage
  install   install a staged build when no thread is running
  can-install  exit 0 when install would go ahead now, else print why and exit 4
  tick      launchd entry: sync once a day after 04:00; installs only while the app is closed
  run       sync then install
  rebuild   check and build the checkout as it stands, uncommitted changes included, and stage it
  status    read-only summary
  rollback  put the previous app back (does not roll back the database)
  schedule  install the launchd job that runs tick every 30 minutes
  publish   push the public snapshot (T3ZIP_PUBLIC_REMOTE); sync does this after each build
  adopt     replace T3 Zip's data with a fresh copy of T3 Code's (T3 Code must be idle)
  takeover  after T3 Code is closed for good: bring over what is new, then move its
            scheduled tasks to T3 Zip (--replace or --keep when T3 Zip has newer messages)
  help      this text

T3ZIP_UPDATE_DRY_RUN=1 reports what sync, install, tick and rollback would do.
Log: $LOG
EOF
}

main() {
  local cmd="${1:-help}"
  case "$cmd" in
    sync | install | tick | run | rollback | rebuild)
      acquire_lock
      log "start: $cmd$([[ "$DRY_RUN" == "1" ]] && echo ' (dry run)')"
      "cmd_$cmd"
      log "done: $cmd"
      ;;
    adopt | takeover)
      LOCK_NOTICE=1
      acquire_lock
      log "start: $cmd$([[ "$DRY_RUN" == "1" ]] && echo ' (dry run)')"
      "cmd_$cmd" "${2:-}"
      log "done: $cmd"
      ;;
    publish)
      acquire_lock
      cmd_publish
      ;;
    status) cmd_status ;;
    schedule) cmd_schedule ;;
    can-install) cmd_can_install ;;
    help | -h | --help) usage ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
}

main "$@"
