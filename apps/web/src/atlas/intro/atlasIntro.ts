/**
 * Shared state for the Code Atlas launch intro. The fullscreen intro plays
 * once per app launch (and on Replay); the in-page terminal hides while it
 * runs so the intro's camera can land exactly where the terminal sits.
 */
import { useSyncExternalStore } from "react";

export type AtlasIntroStatus = "pending" | "playing" | "done";

export interface AtlasUsageEntry {
  readonly label: string;
  /** 0–100 for the busiest usage window, or null when unknown. */
  readonly percent: number | null;
}

export interface AtlasWeekActivity {
  readonly commits: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

export interface AtlasGitHubAccount {
  readonly account: string;
  readonly connected: boolean;
}

export interface AtlasTerminalMeta {
  readonly projectName: string | null;
  readonly agents: readonly string[];
  readonly usage: readonly AtlasUsageEntry[];
  /** Lines committed in the project this week; null outside a repository or while loading. */
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
