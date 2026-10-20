/**
 * Code Atlas "Claude Code" progress style: the words in the live status line
 * under a running turn ("1m 8s · 37.0k tokens · Running a command").
 */
import type { TimelineEntry } from "~/session-logic";

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
  if (entry.command?.trim()) return "Running a command";
  if ((entry.changedFiles?.length ?? 0) > 0) return "Editing files";
  return entry.toolTitle?.trim() || entry.label.trim() || "Working";
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
