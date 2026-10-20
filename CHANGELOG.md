# Changelog

## v1.2

- Plan first, on by default: Claude Code and Codex start every request with a task list and work through it step by step (Settings → General → Plan first).
- Pause a running task, then resume it where it left off or stop it.
- While dictating, the return button stops and sends; the microphone stops and inserts the text.
- The Context card lists Claude Code's own breakdown (messages, system tools, system prompt, skills, memory files, free space) or input, cache and output, with the tokens left until auto-compact.
- Usage lists Codex first and opens the usage statistics; the Tokens view shows the current session and weekly limits before the breakdown.
- While an agent uses another app through Codex computer use, its window glows orange (macOS).
- The status line sits further in and the conversation fades out above it; microphone dots only shrink at the edge.
- Sidebar rows read "N threads" and their counts slide aside for the row buttons on hover.

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
