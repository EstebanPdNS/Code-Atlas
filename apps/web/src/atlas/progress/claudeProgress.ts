/**
 * Code Atlas "Claude Code" progress style: the words in the live status line
 * under a running turn ("1m 8s · 37.0k tokens · Running a command").
 */
import type { TimelineEntry } from "~/session-logic";

import { desktopActivityLabel } from "~/atlas/desktop/desktopTarget";

/** What the agent is doing now, from the newest timeline entry of the turn. */
export function atlasActivityLabel(entries: readonly TimelineEntry[]): string {
  const latest = entries.at(-1);
  if (latest?.kind === "message") {
    return latest.message.role === "assistant" && latest.message.streaming ? "Writing" : "Thinking";
  }
  if (latest?.kind !== "work") return "Thinking";
  const entry = latest.entry;
  if (entry.toolLifecycleStatus !== undefined && entry.toolLifecycleStatus !== "inProgress") {
    return "Thinking";
  }
  if (entry.itemType === "reasoning" || entry.tone === "thinking") return "Thinking";
  const desktop = desktopActivityLabel(entries);
  if (desktop !== null) return desktop;
  if (entry.command?.trim()) return "Running a command";
  if ((entry.changedFiles?.length ?? 0) > 0) return "Editing files";
  return entry.toolTitle?.trim() || entry.label.trim() || "Working";
}

/** Plans longer than this start folded, so the card never covers the chat. */
export const ATLAS_PLAN_FOLD_THRESHOLD = 5;

/** How many steps a folded plan card shows; a plan this short never folds. */
export const ATLAS_PLAN_FOCUS_LIMIT = 3;

/**
 * Which steps a folded plan card shows: the ones in progress, topped up with
 * the next pending steps to at most `limit`; a finished plan shows its last step.
 */
export function atlasPlanFocus(
  steps: readonly { readonly status: "pending" | "inProgress" | "completed" }[],
  limit = ATLAS_PLAN_FOCUS_LIMIT,
): number[] {
  const focus = steps.flatMap((step, index) => (step.status === "inProgress" ? [index] : []));
  const after = focus.at(-1) ?? -1;
  for (let index = 0; index < steps.length && focus.length < limit; index += 1) {
    if (steps[index]!.status === "pending" && (index > after || focus.length === 0)) {
      focus.push(index);
    }
  }
  if (focus.length === 0 && steps.length > 0) focus.push(steps.length - 1);
  return focus.slice(0, limit).toSorted((a, b) => a - b);
}

/** "8s", "1m 8s", "1h 2m". */
export function formatAtlasElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** "950 tokens", "37.0k tokens", "1.2M tokens". */
export function formatAtlasTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${Math.round(tokens)} tokens`;
}

function formatAtlasLineCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.max(0, Math.round(value))}`;
}

/** "+40" and "−12" for the status line; nothing while no line changed. */
export function formatAtlasLines(lines: {
  readonly additions: number;
  readonly deletions: number;
}): { readonly added: string; readonly removed: string } | null {
  if (lines.additions <= 0 && lines.deletions <= 0) return null;
  return {
    added: `+${formatAtlasLineCount(lines.additions)}`,
    removed: `−${formatAtlasLineCount(lines.deletions)}`,
  };
}

/** "3 files changed", "1 file changed". */
export function formatAtlasChangedFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} changed`;
}
