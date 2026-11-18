#!/usr/bin/env python3
"""Move T3 Code's data into T3 Zip, for switching over to T3 Zip.

`scripts/t3zip-update.sh adopt` and `takeover` drive this. The copy is taken while
T3 Code is idle and never changes T3 Code's files. Everything that acts by itself
(scheduled tasks, resuming threads, worktree cleanup) stays off in T3 Zip until
`takeover`, which runs only once T3 Code is closed, so the two apps never both act.

  check      read-only: may the copy go ahead, and what would it replace
  snapshot   write a consistent copy of T3 Code's database to --incoming
  install    put that copy in place of T3 Zip's database and make it safe
  changed    exit 3 when T3 Code holds anything newer than the installed copy
  takeover   turn on in T3 Zip what T3 Code was doing by itself, and off in T3 Code

Exit 4 means "not now", with the reason on stdout. Exit 1 is a failure.
"""
import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

TERMINAL = "('completed','failed','cancelled','interrupted','rolled_back')"
DB_NAME = "statev2.sqlite"
DB_FILES = (DB_NAME, DB_NAME + "-wal", DB_NAME + "-shm")
THREADS = "orchestration_v2_projection_threads"
MESSAGES = "orchestration_v2_projection_messages"
# Set only in T3 Zip (muting is a fork feature), so a fresh copy would lose them.
MUTE_KEYS = ("mutedAt", "mutedUntil", "unmutedRunAt")
# What makes a server act by itself. Off while T3 Zip runs beside T3 Code.
SAFE_SETTINGS = {
    "storageCleanup": {},
    "continueThreadsAfterServerUpdate": False,
    "autoResumeLimitedThreads": False,
    "guestSharingEnabled": False,
    "linkedEnvironmentsEnabled": False,
}
SAFE_PROJECT_KEYS = ("continueThreadsAfterServerUpdate", "worktreeCleanup")
# Copied only when T3 Zip has none: its own copies carry the fork's additions.
PREFERENCE_FILES = (
    "client-settings.json",
    "keybindings.json",
    "keybindings-migrations",
    "model-manifest.json",
    "usage-model-rates.json",
)


class NotNow(Exception):
    """The copy cannot go ahead right now; nothing was changed."""


def db_path(home: Path) -> Path:
    return home / "userdata" / DB_NAME


def connect(path: Path, write: bool = False) -> sqlite3.Connection:
    mode = "rw" if write else "ro"
    con = sqlite3.connect(f"file:{path}?mode={mode}", uri=True, timeout=60)
    con.execute("PRAGMA busy_timeout = 60000")
    return con


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def in_flight(con: sqlite3.Connection, schema: str = "main") -> list[str]:
    """Titles of threads with a run, delegated child or queued effect that has not ended."""
    rows = con.execute(
        f"select distinct coalesce(t.title, x.thread_id) from ("
        f" select thread_id from {schema}.orchestration_v2_projection_runs"
        f"  where coalesce(status, '') not in {TERMINAL}"
        f" union select thread_id from {schema}.orchestration_v2_projection_subagents"
        f"  where coalesce(status, '') not in {TERMINAL}"
        f" union select thread_id from {schema}.orchestration_v2_effect_outbox"
        f"  where coalesce(status, '') not in ('succeeded','failed','cancelled')"
        f") x left join {schema}.{THREADS} t using(thread_id)"
    ).fetchall()
    return [row[0] for row in rows]


def read_record(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def write_json(path: Path, value) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n")
    tmp.replace(path)


def zip_only_messages(con: sqlite3.Connection, since: str | None) -> list[tuple[str, int]]:
    """Threads holding messages the person wrote in T3 Zip that T3 Code does not have."""
    after = "and m.created_at > ?" if since else ""
    return con.execute(
        f"select coalesce(t.title, m.thread_id), count(*) from main.{MESSAGES} m"
        f" left join main.{THREADS} t using(thread_id)"
        f" where m.role = 'user' {after}"
        f" and m.message_id not in (select message_id from code.{MESSAGES})"
        f" group by m.thread_id order by max(m.created_at) desc",
        (since,) if since else (),
    ).fetchall()


def cmd_check(args) -> None:
    code_db, zip_db = db_path(args.code_home), db_path(args.zip_home)
    if not code_db.exists():
        raise NotNow(f"T3 Code's database is missing: {code_db}")
    if not zip_db.exists():
        raise NotNow(f"T3 Zip's database is missing: {zip_db}. Open T3 Zip once first.")

    con = connect(zip_db)
    con.execute("attach database ? as code", (f"file:{code_db}?mode=ro",))

    running = in_flight(con, "code")
    if running:
        names = "\n  ".join(running)
        raise NotNow(
            f"{plural(len(running), 'task is', 'tasks are')} still running in T3 Code. "
            f"Run this again when {'it finishes' if len(running) == 1 else 'they finish'}:\n  {names}"
        )

    newer = con.execute(
        "select count(*) from code.effect_sql_migrations"
        " where migration_id not in (select migration_id from main.effect_sql_migrations)"
    ).fetchone()[0]
    if newer:
        raise NotNow(
            f"T3 Code's database is {plural(newer, 'version', 'versions')} newer than this T3 Zip can open. "
            "Update T3 Zip first, then run this again."
        )

    need = code_db.stat().st_size
    free = shutil.disk_usage(args.zip_home).free
    if free < need * 1.2:
        raise NotNow(f"Not enough free disk space: the copy needs {need >> 30} GB and {free >> 30} GB is free.")

    record = read_record(args.record)
    since = record.get("adoptedAt")
    written = zip_only_messages(con, since)
    if written and since and not args.replace:
        names = "\n  ".join(title for title, _ in written[:15])
        raise NotNow(
            f"{plural(len(written), 'conversation in T3 Zip has', 'conversations in T3 Zip have')} messages "
            f"written after the last copy ({since}) that T3 Code does not have. Copying again would replace them:\n"
            f"  {names}\nNothing was changed. To copy anyway, run: adopt --replace"
        )

    counts = con.execute(
        f"select (select count(*) from code.{THREADS}), (select count(*) from main.{THREADS}),"
        f" (select count(*) from code.{THREADS} where thread_id not in (select thread_id from main.{THREADS})),"
        f" (select count(*) from main.{THREADS} where thread_id not in (select thread_id from code.{THREADS}))"
    ).fetchone()
    print(f"T3 Code has {counts[0]} conversations and T3 Zip has {counts[1]}; {counts[2]} are missing from T3 Zip.")
    if counts[3] or written:
        print(
            f"Only in T3 Zip, kept in the backup and not in the new copy: "
            f"{plural(counts[3], 'conversation', 'conversations')} and messages in "
            f"{plural(len(written), 'conversation', 'conversations')}:"
        )
        for title, count in written[:15]:
            print(f"  {title} ({plural(count, 'message', 'messages')})")
    print(f"The copy needs {need >> 30} GB; {free >> 30} GB is free.")


def cmd_snapshot(args) -> None:
    code_db = db_path(args.code_home)
    args.incoming.unlink(missing_ok=True)
    con = sqlite3.connect(f"file:{code_db}?mode=ro", uri=True, timeout=120, isolation_level=None)
    con.execute("PRAGMA busy_timeout = 120000")
    con.execute("VACUUM INTO ?", (str(args.incoming),))
    con.close()
    check = connect(args.incoming)
    running = in_flight(check)
    result = check.execute("PRAGMA quick_check").fetchone()[0]
    check.close()
    if result != "ok":
        args.incoming.unlink(missing_ok=True)
        sys.exit(f"The copy of T3 Code's database did not pass its integrity check: {result}")
    if running:
        args.incoming.unlink(missing_ok=True)
        names = "\n  ".join(running)
        raise NotNow(
            "A task started in T3 Code while the copy was being made, so the copy was thrown away. "
            f"Run this again when it finishes:\n  {names}"
        )
    print(f"Copied T3 Code's database ({args.incoming.stat().st_size >> 30} GB).")


def pause_scheduled_tasks(con: sqlite3.Connection, previous: dict) -> list[dict]:
    """Pauses every task in the copy and returns the ones T3 Code had switched on."""
    tasks = {
        row[0]: row[1]
        for row in con.execute("select task_id, title from scheduled_tasks where enabled != 0")
    }
    # After a takeover T3 Code's own tasks are paused, so keep what it had on before.
    for task in previous.get("enabledTasks", []):
        exists = con.execute("select 1 from scheduled_tasks where task_id = ?", (task["id"],)).fetchone()
        if exists:
            tasks.setdefault(task["id"], task["title"])
    con.execute("update scheduled_tasks set enabled = 0 where enabled != 0")
    return [{"id": task_id, "title": title} for task_id, title in tasks.items()]


def carry_mutes(old_db: Path, con: sqlite3.Connection) -> int:
    """Re-applies mutes set in T3 Zip, which T3 Code's copy cannot hold."""
    old = connect(old_db)
    carried = 0
    for thread_id, payload in old.execute(
        f"select thread_id, payload_json from {THREADS} where payload_json like '%\"mutedAt\"%'"
    ):
        before = json.loads(payload)
        if not before.get("mutedAt"):
            continue
        row = con.execute(f"select payload_json from {THREADS} where thread_id = ?", (thread_id,)).fetchone()
        if row is None:
            continue
        current = json.loads(row[0])
        if current.get("mutedAt"):
            continue
        for key in MUTE_KEYS:
            if key in before:
                current[key] = before[key]
        con.execute(
            f"update {THREADS} set payload_json = ? where thread_id = ?",
            (json.dumps(current, separators=(",", ":"), ensure_ascii=False), thread_id),
        )
        carried += 1
    old.close()
    return carried


def write_safe_settings(code_home: Path, zip_home: Path) -> None:
    target = zip_home / "userdata" / "settings.json"
    source = target if target.exists() else code_home / "userdata" / "settings.json"
    settings = json.loads(source.read_text())
    settings.update(SAFE_SETTINGS)
    for overrides in settings.get("projectSettingsOverrides", {}).values():
        for key in SAFE_PROJECT_KEYS:
            overrides.pop(key, None)
    write_json(target, settings)


def copy_missing_files(code_home: Path, zip_home: Path) -> None:
    source, target = code_home / "userdata", zip_home / "userdata"
    for name in PREFERENCE_FILES:
        if (source / name).exists() and not (target / name).exists():
            shutil.copy2(source / name, target / name)
    if (source / "attachments").exists():
        (target / "attachments").mkdir(exist_ok=True)
        # APFS clones, and -n leaves every file T3 Zip already has alone.
        subprocess.run(
            ["/bin/cp", "-c", "-n", "-R", f"{source / 'attachments'}/.", str(target / "attachments")],
            check=False,
        )
    (target / "themes").mkdir(exist_ok=True)


def verify(code_db: Path, zip_db: Path) -> list[str]:
    """Compares the installed copy with T3 Code and returns the lines of the report."""
    con = connect(zip_db)
    con.execute("attach database ? as code", (f"file:{code_db}?mode=ro",))
    total, missing = con.execute(
        f"select count(*), sum(thread_id not in (select thread_id from main.{THREADS})) from code.{THREADS}"
    ).fetchone()
    behind = con.execute(
        f"select coalesce(t.title, c.thread_id) from"
        f" (select thread_id, count(*) n from code.{MESSAGES} group by thread_id) c"
        f" left join (select thread_id, count(*) n from main.{MESSAGES} group by thread_id) z using(thread_id)"
        f" left join code.{THREADS} t using(thread_id)"
        f" where coalesce(z.n, 0) < c.n"
    ).fetchall()
    messages = con.execute(f"select count(*) from main.{MESSAGES}").fetchone()[0]
    running = in_flight(con)
    con.close()
    lines = [
        f"All {total} conversations from T3 Code are in T3 Zip, with {messages} messages."
        if not missing and not behind
        else f"{total - (missing or 0)} of {total} conversations from T3 Code are in T3 Zip."
    ]
    if missing or behind:
        lines.append(
            f"T3 Code changed after the copy: {plural(missing or 0, 'new conversation', 'new conversations')} and "
            f"{plural(len(behind), 'conversation with new messages', 'conversations with new messages')}:"
        )
        lines.extend(f"  {row[0]}" for row in behind[:15])
    if running:
        lines.append(f"Unexpected: {plural(len(running), 'task shows', 'tasks show')} as running in the copy.")
    return lines


def cmd_install(args) -> None:
    userdata = args.zip_home / "userdata"
    live = userdata / DB_NAME
    if not args.incoming.exists():
        sys.exit(f"There is no copy to install at {args.incoming}")
    check = connect(args.incoming)
    running = in_flight(check)
    check.close()
    if running:
        raise NotNow("The copy holds a running task, so it was not installed:\n  " + "\n  ".join(running))

    previous = read_record(args.record)
    only_a_copy = False
    if previous.get("adoptedAt") and live.exists():
        old = connect(live)
        old.execute("attach database ? as code", (f"file:{db_path(args.code_home)}?mode=ro",))
        only_a_copy = not zip_only_messages(old, previous["adoptedAt"])
        old.close()
    backup = args.zip_home / "backups" / f"pre-switch-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    backup.mkdir(parents=True)
    moved = []
    try:
        for name in DB_FILES:
            if (userdata / name).exists():
                (userdata / name).rename(backup / name)
                moved.append(name)
        args.incoming.rename(live)

        con = connect(live, write=True)
        newest = con.execute(f"select max(updated_at) from {THREADS}").fetchone()[0]
        tasks = pause_scheduled_tasks(con, previous)
        mutes = carry_mutes(backup / DB_NAME, con) if (backup / DB_NAME).exists() else 0
        con.commit()
        con.close()
        write_safe_settings(args.code_home, args.zip_home)
        copy_missing_files(args.code_home, args.zip_home)
        write_json(
            args.record,
            {
                "adoptedAt": now_iso(),
                "sourceNewestUpdate": newest,
                "takenOverAt": None,
                "enabledTasks": tasks,
                "backup": str(backup),
            },
        )
    except BaseException as error:
        # Put T3 Zip's own database back exactly as it was.
        for name in DB_FILES:
            (userdata / name).unlink(missing_ok=True)
        for name in moved:
            (backup / name).rename(userdata / name)
        if not any(backup.iterdir()):
            backup.rmdir()
        sys.exit(f"The copy could not be installed, so T3 Zip's own data was put back. Cause: {error!r}")

    report = verify(db_path(args.code_home), live)
    for line in report:
        print(line)
    if len(report) > 1:
        print("Run adopt again to bring those over.")
    print(f"{plural(mutes, 'mute', 'mutes')} set in T3 Zip carried over.")
    if tasks:
        print(
            f"{plural(len(tasks), 'scheduled task is', 'scheduled tasks are')} paused in T3 Zip until T3 Code is closed: "
            + ", ".join(task["title"] for task in tasks)
        )
    if only_a_copy:
        # Nothing was written in T3 Zip since the last copy, so the old database held nothing of its own.
        shutil.rmtree(backup)
        record = read_record(args.record)
        record["backup"] = previous.get("backup")
        write_json(args.record, record)
    else:
        print(f"T3 Zip's previous data is in {backup}")


def cmd_changed(args) -> None:
    """Exit 3 when T3 Code changed after the copy now in T3 Zip was taken."""
    record = read_record(args.record)
    code_db = db_path(args.code_home)
    con = connect(code_db)
    newest = con.execute(f"select max(updated_at) from {THREADS}").fetchone()[0]
    con.close()
    lines = verify(code_db, db_path(args.zip_home))
    moved_on = len(lines) > 1 or (newest or "") > (record.get("sourceNewestUpdate") or "")
    if moved_on:
        print("T3 Code has changed since the copy in T3 Zip was taken.")
        for line in lines[1:]:
            print(line)
        sys.exit(3)
    print("T3 Code has not changed since the copy in T3 Zip was taken.")


# When each task last ran and runs next. Synced at takeover so T3 Zip does not repeat a
# run T3 Code made after the copy.
SCHEDULE_COLUMNS = (
    "next_run_at",
    "last_run_at",
    "last_run_status",
    "last_run_error",
    "run_count",
    "last_run_webhook_delivery_id",
    "updated_at",
)


def cmd_takeover(args) -> None:
    record = read_record(args.record)
    if not record.get("adoptedAt"):
        raise NotNow("T3 Zip has not copied T3 Code's data yet. Run adopt first.")
    ids = [task["id"] for task in record.get("enabledTasks", [])]
    marks = ",".join("?" for _ in ids)

    if ids:
        zip_con = connect(db_path(args.zip_home), write=True)
        zip_con.execute("attach database ? as code", (f"file:{db_path(args.code_home)}?mode=ro",))
        assignments = ", ".join(
            f"{column} = (select c.{column} from code.scheduled_tasks c where c.task_id = scheduled_tasks.task_id)"
            for column in SCHEDULE_COLUMNS
        )
        zip_con.execute(
            f"update scheduled_tasks set {assignments}"
            " where task_id in (select task_id from code.scheduled_tasks)"
        )
        zip_con.execute(f"update scheduled_tasks set enabled = 1 where task_id in ({marks})", ids)
        zip_con.commit()
        zip_con.close()
        # T3 Code is closed. Pausing its copies means opening it again cannot run them twice.
        code_con = connect(db_path(args.code_home), write=True)
        code_con.execute(f"update scheduled_tasks set enabled = 0 where task_id in ({marks})", ids)
        code_con.commit()
        code_con.close()

    code_settings = json.loads((args.code_home / "userdata" / "settings.json").read_text())
    target = args.zip_home / "userdata" / "settings.json"
    settings = json.loads(target.read_text())
    for key in SAFE_SETTINGS:
        if key in code_settings:
            settings[key] = code_settings[key]
        else:
            settings.pop(key, None)
    for project, overrides in code_settings.get("projectSettingsOverrides", {}).items():
        for key in SAFE_PROJECT_KEYS:
            if key in overrides:
                settings.setdefault("projectSettingsOverrides", {}).setdefault(project, {})[key] = overrides[key]
    write_json(target, settings)

    record["takenOverAt"] = now_iso()
    write_json(args.record, record)
    if ids:
        print(
            f"{plural(len(ids), 'scheduled task now runs', 'scheduled tasks now run')} in T3 Zip and "
            f"{'is' if len(ids) == 1 else 'are'} paused in T3 Code: "
            + ", ".join(task["title"] for task in record["enabledTasks"])
        )
    print("T3 Zip now resumes threads and cleans up worktrees the way T3 Code did.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("check", "snapshot", "install", "changed", "takeover"))
    parser.add_argument("--code-home", type=Path, default=Path.home() / ".t3")
    parser.add_argument("--zip-home", type=Path, default=Path.home() / ".t3-zip")
    parser.add_argument("--incoming", type=Path)
    parser.add_argument("--record", type=Path, default=Path.home() / "Library/Caches/t3zip/adopted.json")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    if args.incoming is None:
        args.incoming = args.zip_home / "userdata" / "statev2.incoming.sqlite"
    try:
        {
            "check": cmd_check,
            "snapshot": cmd_snapshot,
            "install": cmd_install,
            "changed": cmd_changed,
            "takeover": cmd_takeover,
        }[args.command](args)
    except NotNow as reason:
        print(reason)
        sys.exit(4)


if __name__ == "__main__":
    main()
