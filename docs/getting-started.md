# Getting started

## Requirements

- A Mac with Apple Silicon and macOS 13 or later.
- At least one coding agent installed and signed in on the Mac, for example:
  - [Claude Code](https://claude.com/product/claude-code): run `claude auth login`.
  - [Codex CLI](https://developers.openai.com/codex/cli): run `codex login`.

## Install

1. Download `Code-Atlas-v1.4.zip` from the [latest release](https://github.com/EstebanPdNS/Code-Atlas/releases/latest).
2. Open the zip and move **Code Atlas** to Applications.
3. Open Code Atlas. The app is ad-hoc signed and not notarized, so macOS may block the first launch. Open **System Settings → Privacy & Security** and choose **Open Anyway**.

Code Atlas keeps its settings, projects and threads in `~/.code-atlas`. It does not read or change an installed T3 Code. It does not update itself: download new versions from the [releases page](https://github.com/EstebanPdNS/Code-Atlas/releases). When T3 Code publishes a new stable release, Code Atlas shows a notification; click it to read the release on GitHub. Nothing is installed.

## Voice dictation

1. Open **Settings → Dictation** and turn dictation on. The default model, **Whisper turbo · Metal**, downloads once (about 875 MB).
2. Optionally add project names and technical terms to the vocabulary, so Whisper spells them correctly.
3. Click the microphone in the composer, or hold the dictation shortcut shown in its tooltip.
4. Right-click the microphone to choose another input device.
5. Press Escape to cancel. The text is inserted into the composer for you to edit before sending.

## Settings

**Settings → General → Code Atlas** turns the Background tasks card and the startup sound on or off and replays the launch intro. **Settings → Appearance → Progress style** switches between the Claude Code and Codex ways of showing a running agent, and **Settings → General → Plan first** decides whether agents start every request that takes action with a task list.

## Running tasks

While an agent works, the composer shows **Pause**. A paused task shows **Stop** (end it) and **Resume** (continue where it left off), next to the send and microphone buttons. A long task list folds to the steps in progress; click its header to see every step.

Subagents get a name and a face of their own, so you can tell them apart in the conversation and in the details card.

Agents open web pages in the in-app browser. Links you click open there too; Cmd-click opens your default browser, and **Settings → Integrations → Open links in** changes the default.

## Groups

Drag pinned threads to reorder them. Create a group from the sidebar and drag projects into it. Right-click a project or a group for **Rename** and **Settings**; a group's settings choose its icon, from the built-in icons or an image of your own.

## Build from source

Code Atlas builds like T3 Code. Install Node 24 and [Vite+](https://viteplus.dev), then run:

```sh
vp i
T3CODE_DESKTOP_VERSION=1.4.0 vp run dist:desktop:dmg:arm64
```

The build also compiles the local Whisper server with `native/whisper-server/build.sh` (requires the Xcode command line tools and CMake). See the [development runbook](operations/development.md) for the full T3 Code workflow. The reference sources that coding agents read (`.repos/`) are not in the repository; fetch them with `vp run sync:repos`.
