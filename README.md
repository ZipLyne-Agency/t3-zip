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

---

<p align="center">
  <a href="https://t3.codes">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="T3 Code logo" />
  </a>
</p>

<h1 align="center">T3 Code</h1>

<p align="center">The open-source control plane for coding agents.</p>

<p align="center">
  <a href="https://t3.codes/download"><strong>Download</strong></a> ·
  <a href="https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824">iOS</a> ·
  <a href="https://play.google.com/store/apps/details?id=com.t3tools.t3code">Android</a> ·
  <a href="https://app.t3.codes">Web</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a>
</p>

<p align="center">
  <a href="https://t3.codes">
    <img src="./.github/readme/hero.webp" width="100%" alt="T3 Code on desktop with a finished Claude thread, next to the phone app asking to approve a command from Codex" />
  </a>
</p>

T3 Code runs the coding agents on your machine and gives them one fast interface. Start a thread at your desk, then approve the next step from your phone.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. If an agent is set up on your computer, T3 Code can control it.

## What you get

- **Your subscriptions.** T3 Code does not resell tokens. It drives the agents you are already signed in to.
- **Every agent in one place.** Change models in the middle of a thread. Let Claude hand a task to Codex.
- **Desktop, web, and phone.** One server, and every client shows the same threads. There are apps for iOS and Android.
- **Remote ready.** Run agents on any machine. Connect over your local network, Tailscale, or [T3 Connect](./docs/user/remote-access.md).
- **Git built in.** Each thread can work in its own worktree. Review the diff, then commit, push, and open a pull request with one button.
- **Fast.** Performance is a feature here. We measure it, and we treat a dropped frame as a bug.
- **Open.** MIT licensed. If you don't like something, fork it.

## Install

### Desktop app

[Download T3 Code](https://t3.codes/download) for macOS, Windows, or Linux. You can also use a package manager:

| Platform       | Command                                                              |
| -------------- | -------------------------------------------------------------------- |
| macOS          | `brew install --cask t3-code`                                        |
| Windows        | `winget install T3Tools.T3Code` or `scoop install extras/t3code`     |
| Arch Linux     | `yay -S t3code-bin`                                                  |
| Nix            | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`         |
| Debian, Ubuntu | `.deb` from [Releases](https://github.com/pingdotgg/t3code/releases) |

### Command line

This installs the `t3` command. Run `t3` to start the server and open the web app.

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

To try it once without an install, run `npx t3@latest`.

### Phone

Get the app from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code). Then follow [remote access](./docs/user/remote-access.md) to connect it to your computer.

### Sign in to an agent

T3 Code needs one agent that is installed and signed in. For example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.

[Provider setup](./docs/user/install.md#providers) has the steps for each agent. [Install T3 Code](./docs/user/install.md) covers nightly builds, AppImage, WSL, and NixOS.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the tool that you want.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

We have limited review capacity. Small, focused fixes are the most likely to be merged. Features need an approved discussion first.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you report a bug or open a pull request.
- Put feature requests in [Ideas](https://github.com/pingdotgg/t3code/discussions/categories/ideas).
- Build from source with the [development runbook](./docs/operations/00_development.md#first-checkout). The [architecture overview](./docs/internals/01_architecture.md) explains how it works.
- Get help in [Discord](https://discord.gg/jn4EGJjrvv).

## License

[MIT](./LICENSE)
