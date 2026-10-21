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
    };
  }
  if (git === undefined) return null;
  return {
    linesAdded: git.linesAdded,
    linesRemoved: git.linesRemoved,
    turns: null,
    commits: git.commits,
  };
}

const countFormat = new Intl.NumberFormat("en-US");
export function formatAtlasCount(value: number): string {
  return countFormat.format(value);
}

/** "3 turns · 2 commits", naming only the counts that are known. */
export function formatAtlasWeekCounts(week: AtlasWeekActivity): string {
  const counts: string[] = [];
  if (week.turns !== null) {
    counts.push(`${formatAtlasCount(week.turns)} ${week.turns === 1 ? "turn" : "turns"}`);
  }
  if (week.commits !== null) {
    counts.push(`${formatAtlasCount(week.commits)} ${week.commits === 1 ? "commit" : "commits"}`);
  }
  return counts.join(" · ");
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
