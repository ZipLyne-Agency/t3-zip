# T3 Zip

**T3 Zip is a modified version of [T3 Code](https://github.com/pingdotgg/t3code)**, the app for running coding agents like Claude Code and Codex. It keeps everything T3 Code does and adds a different way to organize threads across many projects.

It installs as its own app next to T3 Code, so you can keep both. It updates itself from T3 Code's newest nightly build every day.

> Mac only (Apple silicon: M1 or newer). Not an official T3 product.

## How it differs from T3 Code

|                      | T3 Code                                  | T3 Zip                                                                                                                                      |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finding threads**  | One sidebar list of projects and threads | A rail of projects on the left (with folders), and next to it the threads of the project you picked                                         |
| **Open threads**     | One at a time                            | Tabs across the top, so threads from different projects are one click apart                                                                 |
| **Filters**          | A status shown on each thread            | Waiting, Working and Done tabs in every project. "All Projects" shows what needs you across everything                                      |
| **Notifications**    | Settings for the whole app               | Also mute a single thread: for one of your snooze times, until a time you pick, or until you unmute it                                      |
| **Snooze**           | For a set time                           | Also "until I wake it"                                                                                                                      |
| **Finished threads** | Settle out of view on their own          | Stay under Done until you clear them                                                                                                        |
| **Keyboard**         |                                          | <kbd>⌘</kbd><kbd>⌥</kbd><kbd>J</kbd> jumps to the next thread waiting on you, <kbd>⌘</kbd><kbd>⌥</kbd><kbd>K</kbd> to the next finished one |
| **Updates**          | Downloads releases                       | Builds the newest nightly on your Mac each day. An **Update** button installs it when no agent is running, after backing up your data       |
| **Layout choice**    |                                          | Settings, then Sidebar layout, switches between the new rail and T3 Code's classic sidebar                                                  |

Everything else is T3 Code: the same agents, the phone app and T3 Connect, git tools, and settings.

## Install

There is no download button. Your Mac builds the app from this code, which takes one command and some waiting.

**Before you start:** install at least one coding agent and sign in to it, for example [Claude Code](https://claude.com/product/claude-code) or [Codex](https://developers.openai.com/codex/cli). T3 Zip runs the agents you already have.

### Easiest: ask your AI agent

Paste this into Claude Code, Codex, or another coding agent on your Mac:

```text
Install T3 Zip on this Mac by following the "Install by hand" steps in
https://github.com/ZipLyne-Agency/t3-zip/blob/main/README.md
Run each command yourself, wait for each to finish, and tell me when
"T3 Zip" is in my Applications folder.
```

### Install by hand

Open **Terminal** (press <kbd>⌘</kbd> + <kbd>Space</kbd>, type `Terminal`, press Return), then paste each block and press Return. Wait for each one to finish before the next.

1. Install the build tools (Apple's developer tools, Vite+ and Rust). Click **Install** if a window asks about developer tools.

   ```sh
   xcode-select --install; curl -fsSL https://vite.plus | bash; curl -fsSL https://sh.rustup.rs | sh -s -- -y
   ```

   Close Terminal and open it again so the new tools are found.

2. Download the code. It goes into a folder named `t3-zip` in your home folder.

   ```sh
   git clone https://github.com/pingdotgg/t3code.git ~/t3-zip && cd ~/t3-zip && git remote add zip https://github.com/ZipLyne-Agency/t3-zip.git && git fetch zip && git checkout -b t3-zip zip/main
   ```

3. Build the app and put it in Applications. This can take a while the first time.

   ```sh
   ~/t3-zip/scripts/t3zip-update.sh rebuild && ~/t3-zip/scripts/t3zip-update.sh install
   ```

4. Turn on daily updates.

   ```sh
   ~/t3-zip/scripts/t3zip-update.sh schedule
   ```

Open **T3 Zip** from Applications. If macOS says it can't check the app, open **System Settings**, then **Privacy & Security**, and click **Open Anyway**.

### Already use T3 Code?

To start T3 Zip with a copy of your T3 Code threads, close T3 Code, then run:

```sh
~/t3-zip/scripts/t3zip-update.sh adopt
```

T3 Code itself is not changed.

## Updating

Nothing to do. Every day your Mac merges T3 Code's newest nightly, checks it, and builds it. When a build is ready, T3 Zip shows an **Update** button. If an update ever goes wrong, `~/t3-zip/scripts/t3zip-update.sh rollback` puts the previous app back.

`~/t3-zip/scripts/t3zip-update.sh help` lists every command.

## For developers

Optional settings, such as your own bundle id or a Developer ID to sign with, go in `scripts/t3zip.local.env`. See `scripts/t3zip.local.env.example`. This repository is published from a private working copy after each build that passes its checks.

## License

MIT, like T3 Code, which is © T3 Tools Inc. T3 Code's own README follows below.
