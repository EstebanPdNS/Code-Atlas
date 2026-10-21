# Code Atlas web module

Everything Code Atlas adds to the T3 Code web client lives here, grouped by feature. Code Atlas keeps receiving upstream T3 Code updates, so upstream files only import these modules where they need them and carry a `Code Atlas:` comment at each change. Small, marked edits upstream and new code here keep each upstream update to a handful of easy conflicts.

| Folder       | What it owns                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand/`     | The Code Atlas mark and wordmark, the working dots (`ActivityDots`), each agent's bar color (`providerColors`) and the Claude Code / Codex providers. |
| `intro/`     | The launch intro and the Code Atlas terminal on new threads, with its startup sound and the summary it shows (`terminalSummary`).                     |
| `sidebar/`   | Pinned, Needs attention and Working sections, project groups (`projectFolders`) and group settings.                                                   |
| `progress/`  | The Claude Code progress style: the plan card, the status line and the paused task's Stop and Resume (`pausedTask`).                                  |
| `agents/`    | Subagent personas: names, faces (vector art generated with Codex) and headlines.                                                                      |
| `rail/`      | The Context, Usage and Background tasks cards beside the conversation; the context breakdown logic is `contextBreakdown`.                             |
| `settings/`  | The Code Atlas section in Settings → General.                                                                                                         |
| `desktop/`   | Bridges to the Electron shell: the orange glow around a window an agent drives, and the running-agent count the quit check reads.                     |
| `dictation/` | Microphone selection for voice dictation.                                                                                                             |
| `atlas.css`  | The visual language: tokens, default-theme overrides, then layout, intro, sidebar, progress, agents and rail rules, and motion last.                  |

The dictation engine itself lives in `src/dictation/`, not here. It is an upstream T3 Code feature that Code Atlas cherry-picked before upstream released it, so it stays at upstream's path and the upstream version lands in place. The Code Atlas parts inside it (the scrolling waveform, the chosen microphone) are marked with `Code Atlas:` comments.

Rules of thumb:

- Logic lives in plain `.ts` modules with tests beside them; components stay thin.
- Animations are one-shot CSS transitions on the compositor (opacity, transform, grid rows) that use the motion tokens in `atlas.css` and stop under `prefers-reduced-motion`. Nothing repaints continuously.
- Server-side Code Atlas changes stay at the provider adapter boundary (`apps/server/src/orchestration-v2/Adapters/`) and are marked with a `Code Atlas:` comment.
