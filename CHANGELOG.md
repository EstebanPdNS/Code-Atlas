# Changelog

## v1.3

- Full access never stops for an approval.
- A conversation that gets too full is compacted automatically and the message is sent again, instead of failing; very long messages become an attachment.
- When the connection to this Mac drops, Code Atlas shows Reconnecting… and recovers by itself, also after sleep.
- Codex follows the reasoning effort set in its config; Claude's Ultrathink uses maximum effort, and Opus, Fable and Sonnet 5.x start at High.
- Goals work like Codex: open a goal to edit it full screen, pause and resume it, or clear it.
- The Context card shows Claude Code's full breakdown, with skills and memory files, and an estimated one for Codex; Compact session is one click away.
- A redesigned Code Atlas terminal: a framed map, a grid with the project, usage, this week and GitHub, the version and a blinking prompt. This week counts the lines your agents changed in the project, without needing git.
- Subagents have names and faces: "Ronny is working on: …", with the model below.
- The task list is written in one step, folds to the current steps and scrolls when long.
- ⏎ sends and the microphone sits beside it; while an agent works, the stop button pauses it. A paused task shows Resume beside it; Stop really cancels it, and typing starts a new action.
- Settings → Appearance → Typeface: Code Atlas monospace or a Claude-style system font; the terminal stays monospace.
- Pinned threads show when they are working; only stopped threads turn gray. Drag to reorder them.
- Agents use the in-app browser; links open there too. A new preview opens beside the details card.
- Code Atlas tells you when T3 Code publishes a new release; nothing is installed.
- The macOS icon has Apple's exact size, the logo is centred, and Code Atlas replaces T3 everywhere in the app.

## v1.2

- Plan first, on by default: Claude Code and Codex keep a task list for every request and check off each step (Settings → General → Plan first).
- Pause a running task, then stop or resume it.
- While dictating, the return button stops and sends.
- Detailed Context card, like Claude Code's.
- Usage lists Codex first, uses each agent's colors and opens the statistics; the Tokens view shows the limits.
- An app window an agent uses through computer use glows orange.
- Smoother microphone dots, wider conversation margins, and the launch intro no longer cuts off the project name.
- Sidebar rows read "N threads".

## v1.1

- Show a running agent in the Claude Code style: the plan as a card and one live line with elapsed time, tokens and the current activity. Choose Claude Code or Codex in Settings → Appearance → Progress style.
- Right-click a project or a group for Rename and Settings.
- Give groups a built-in icon, an emoji, a monogram or your own image; the folder stays the default.
- Rename the sidebar sections to Groups and Ungrouped.
- Microphone dots scroll left continuously and fade at the edge while you dictate.
- With quit confirmation disabled, Cmd+Q asks before quitting while agents are working.
- Larger sidebar wordmark with a tighter space between the words, and a smaller new-thread headline.
- Repository: Code Atlas logo in the README, and T3 Code's vendored references, review-bot and editor configs removed from the published files.

## v1.0

Based on T3 Code 0.1.1 (nightly 20261020.3411, upstream commit `7e289ae`).

- Initial release.
- Code Atlas identity: icon, handbook monospace interface, launch intro with the Aurora sound, and data in `~/.code-atlas`, separate from T3 Code.
- Local voice dictation with Whisper large-v3-turbo on the Mac GPU, a project vocabulary prompt and microphone selection. Includes the dictation work from T3 Code pull request #19273.
- Project groups with drag and drop, plus Pinned and Needs attention sections.
- Code Atlas terminal on new threads with project, agents, weekly usage, this week's commits and GitHub accounts.
- Environment, Context and Usage cards beside the conversation; the Background tasks card is optional in Settings.
