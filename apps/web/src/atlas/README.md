# Code Atlas web module

Everything Code Atlas adds to the T3 Code web client lives here, grouped by feature. Upstream components import these modules where they need them; keeping the additions in one folder keeps upstream rebases small.

| Folder       | What it owns                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand/`     | The Code Atlas mark and wordmark, and each agent's bar color (`providerColors`).                                                                    |
| `intro/`     | The launch intro and the Code Atlas terminal on new threads, with its startup sound.                                                                |
| `sidebar/`   | Pinned, Needs attention and Working sections, project groups (`projectFolders`), group settings and the running-agent count used by the quit check. |
| `progress/`  | The Claude Code progress style: the plan card, the status line and the paused-task controls.                                                        |
| `agents/`    | Subagent personas: names, faces (vector art generated with Codex) and headlines.                                                                    |
| `rail/`      | The Context, Usage and Background tasks cards beside the conversation.                                                                              |
| `settings/`  | The Code Atlas section in Settings → General.                                                                                                       |
| `desktop/`   | The orange glow around an app window an agent drives (computer use).                                                                                |
| `dictation/` | Microphone selection for voice dictation.                                                                                                           |
| `atlas.css`  | The visual language: color and motion tokens, then layout, progress, sidebar and animation rules.                                                   |

Rules of thumb:

- Logic lives in plain `.ts` modules with tests beside them; components stay thin.
- Animations are one-shot CSS transitions on the compositor (opacity, transform, grid rows) that use the motion tokens in `atlas.css` and stop under `prefers-reduced-motion`. Nothing repaints continuously.
- Server-side Code Atlas changes stay at the provider adapter boundary (`apps/server/src/orchestration-v2/Adapters/`) and are marked with a `Code Atlas:` comment.
