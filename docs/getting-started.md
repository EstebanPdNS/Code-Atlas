# Getting started

## Requirements

- A Mac with Apple Silicon and macOS 13 or later.
- At least one coding agent installed and signed in on the Mac, for example:
  - [Claude Code](https://claude.com/product/claude-code): run `claude auth login`.
  - [Codex CLI](https://developers.openai.com/codex/cli): run `codex login`.

## Install

1. Download `Code-Atlas-v1.0.zip` from the [v1.0 release](https://github.com/EstebanPdNS/Code-Atlas/releases/tag/v1.0).
2. Open the zip and move **Code Atlas** to Applications.
3. Open Code Atlas. The app is ad-hoc signed and not notarized, so macOS may block the first launch. Open **System Settings → Privacy & Security** and choose **Open Anyway**.

Code Atlas keeps its settings, projects and threads in `~/.code-atlas`. It does not read or change an installed T3 Code. It does not update itself: download new versions from the [releases page](https://github.com/EstebanPdNS/Code-Atlas/releases).

## Voice dictation

1. Open **Settings → Dictation** and turn dictation on. The default model, **Whisper turbo · Metal**, downloads once (about 875 MB).
2. Optionally add project names and technical terms to the vocabulary, so Whisper spells them correctly.
3. Click the microphone in the composer, or hold the dictation shortcut shown in its tooltip.
4. Right-click the microphone to choose another input device.
5. Press Escape to cancel. The text is inserted into the composer for you to edit before sending.

## Settings

**Settings → General → Code Atlas** turns the Background tasks card and the startup sound on or off and replays the launch intro.

## Build from source

Code Atlas builds like T3 Code. Install Node 24 and [Vite+](https://viteplus.dev), then run:

```sh
vp i
T3CODE_DESKTOP_VERSION=1.0.0 vp run dist:desktop:dmg:arm64
```

The build also compiles the local Whisper server with `native/whisper-server/build.sh` (requires the Xcode command line tools and CMake). See the [development runbook](operations/development.md) for the full T3 Code workflow.
