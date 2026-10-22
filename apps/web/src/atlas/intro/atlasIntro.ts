/**
 * Shared state for the Code Atlas launch intro. The fullscreen intro plays
 * once per app launch (and on Replay); the in-page terminal hides while it
 * runs so the intro's camera can land exactly where the terminal sits.
 */
import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export type AtlasIntroStatus = "pending" | "playing" | "done";

export interface AtlasUsageEntry {
  readonly label: string;
  /** 0–100 for the busiest usage window, or null when unknown. */
  readonly percent: number | null;
}

export interface AtlasWeekActivity {
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** Code Atlas turns that changed files; null when only git history is known. */
  readonly turns: number | null;
  /** The repository author's commits; null outside a repository. */
  readonly commits: number | null;
  /** The agents' week in the project; null when the server does not report it. */
  readonly filesChanged: number | null;
  readonly filesRead: number | null;
  readonly commands: number | null;
  readonly threads: number | null;
  readonly agentSeconds: number | null;
}

/**
 * Lines come from Code Atlas's own turn checkpoints, so projects without git,
 * or with commits under another email, still count; git's lines are the
 * fallback when no turn changed files this week.
 */
export function toAtlasWeekActivity(
  discovery: SourceControlDiscoveryResult | null | undefined,
): AtlasWeekActivity | null {
  const turns = discovery?.turnActivity;
  const git = discovery?.weeklyActivity;
  if (turns !== undefined) {
    return {
      linesAdded: turns.linesAdded,
      linesRemoved: turns.linesRemoved,
      turns: turns.turns,
      commits: git?.commits ?? null,
      filesChanged: turns.filesChanged ?? null,
      filesRead: turns.filesRead ?? null,
      commands: turns.commands ?? null,
      threads: turns.threads ?? null,
      agentSeconds: turns.agentSeconds ?? null,
    };
  }
  if (git === undefined) return null;
  return {
    linesAdded: git.linesAdded,
    linesRemoved: git.linesRemoved,
    turns: null,
    commits: git.commits,
    filesChanged: null,
    filesRead: null,
    commands: null,
    threads: null,
    agentSeconds: null,
  };
}

const countFormat = new Intl.NumberFormat("en-US");
export function formatAtlasCount(value: number): string {
  return countFormat.format(value);
}

const counted = (value: number, one: string, many: string) =>
  `${formatAtlasCount(value)} ${value === 1 ? one : many}`;

/** "3 turns · 120 commands · 2 commits", naming only the counts that are known. */
export function formatAtlasWeekCounts(week: AtlasWeekActivity): string {
  const counts: string[] = [];
  if (week.turns !== null) counts.push(counted(week.turns, "turn", "turns"));
  if (week.commands !== null && week.commands > 0) {
    counts.push(counted(week.commands, "command", "commands"));
  }
  if (week.commits !== null) counts.push(counted(week.commits, "commit", "commits"));
  return counts.join(" · ");
}

/** "92 files changed · 10 read", or null when nothing is known. */
export function formatAtlasWeekFiles(week: AtlasWeekActivity): string | null {
  if (week.filesChanged === null) return null;
  const read =
    week.filesRead !== null && week.filesRead > 0
      ? ` · ${formatAtlasCount(week.filesRead)} read`
      : "";
  return `${counted(week.filesChanged, "file", "files")} changed${read}`;
}

/** "5 threads · 15h 24m of agent work", or null when nothing is known. */
export function formatAtlasWeekTime(week: AtlasWeekActivity): string | null {
  const parts: string[] = [];
  if (week.threads !== null && week.threads > 0)
    parts.push(counted(week.threads, "thread", "threads"));
  if (week.agentSeconds !== null && week.agentSeconds >= 60) {
    const minutes = Math.round(week.agentSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const time = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
    parts.push(`${time} of agent work`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface AtlasGitHubAccount {
  readonly account: string;
  readonly connected: boolean;
}

export interface AtlasTerminalMeta {
  readonly projectName: string | null;
  readonly agents: readonly string[];
  readonly usage: readonly AtlasUsageEntry[];
  /** Lines changed in the project this week; null when nothing is known or while loading. */
  readonly week: AtlasWeekActivity | null;
  readonly github: readonly AtlasGitHubAccount[];
}

const EMPTY_META: AtlasTerminalMeta = {
  projectName: null,
  agents: [],
  usage: [],
  week: null,
  github: [],
};

let status: AtlasIntroStatus = "pending";
let meta: AtlasTerminalMeta = EMPTY_META;
// ChatView publishes on every render with a fresh object; compare by content,
// serialising only the incoming value.
let metaKey = JSON.stringify(EMPTY_META);
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAtlasIntroStatus(next: AtlasIntroStatus) {
  if (status === next) return;
  status = next;
  emit();
}

export function replayAtlasIntro() {
  setAtlasIntroStatus("pending");
}

/** Returns whether the meta changed (and listeners were notified). */
export function publishAtlasTerminalMeta(next: AtlasTerminalMeta): boolean {
  const nextKey = JSON.stringify(next);
  if (nextKey === metaKey) return false;
  meta = next;
  metaKey = nextKey;
  emit();
  return true;
}

export function useAtlasIntroStatus(): AtlasIntroStatus {
  return useSyncExternalStore(subscribe, () => status);
}

export function useAtlasTerminalMeta(): AtlasTerminalMeta {
  return useSyncExternalStore(subscribe, () => meta);
}

export const ATLAS_SOUND_STORAGE_KEY = "codeatlas:startup-sound";

export function slugifyAtlasCommand(name: string | null): string {
  const slug = (name ?? "workspace")
    .toLowerCase()
    .normalize("NFKD")
    // Drop the accents NFKD split off, so "Ñandú" reads "nandu" rather than "n-andu".
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `atlas --open ${slug.length > 0 ? slug : "workspace"}`;
}
