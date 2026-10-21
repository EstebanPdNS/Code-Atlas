/**
 * Splits sidebar threads into the Code Atlas sections. Every thread lands in
 * exactly one place, so nothing is duplicated and nothing is lost:
 *
 * - Pinned: anything pinned, whatever its status (the row shows the status).
 * - Needs attention: the agent is blocked on the user (approval, a question),
 *   failed or hit a usage limit, finished a turn the user has not read, or a
 *   snooze woke up.
 * - Working: agents running now (see `isAtlasThreadRunning`).
 * - Everything else stays under its project, where settled and snoozed threads
 *   sit behind a "show more" toggle.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "~/components/Sidebar.logic";

export type AtlasThreadPlacement = "pinned" | "attention" | "working" | "project";

export type AtlasAttentionReason = "approval" | "input" | "failed" | "limited" | "unread" | "woke";

export function resolveAtlasAttentionReason(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
}): AtlasAttentionReason | null {
  switch (input.status) {
    case "approval":
    case "input":
    case "failed":
    case "limited":
      return input.status;
    case "working":
    case "waiting":
      return null;
    case "ready":
      if (input.isWoke) return "woke";
      return input.isUnread ? "unread" : null;
  }
}

/**
 * Whether the thread's agent is running now, which is what the working dots
 * and the Working section show. "waiting" alone is not enough: a session
 * parked at idle reads "waiting" too, and so does every imported history
 * thread (a provider thread but no run), weeks after its last turn. Only a run
 * blocked on another thread, or background work that holds the turn open,
 * is live.
 */
export function isAtlasThreadRunning(
  thread: Parameters<typeof resolveSidebarThreadStatus>[0] &
    Pick<EnvironmentThreadShell, "pendingBackgroundTasks">,
): boolean {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "working") return true;
  if (status !== "waiting") return false;
  return (
    thread.runtime?.status === "running" ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)
  );
}

export function resolveAtlasThreadPlacement(input: {
  readonly pinned: boolean;
  readonly status: SidebarThreadStatus;
  /** From `isAtlasThreadRunning`. */
  readonly running: boolean;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  /** Snoozed threads stay out of the inbox until they wake. */
  readonly snoozed: boolean;
}): AtlasThreadPlacement {
  if (input.pinned) return "pinned";
  if (input.running) return "working";
  if (input.snoozed && !input.isWoke) return "project";
  return resolveAtlasAttentionReason(input) === null ? "project" : "attention";
}

const ATTENTION_PRIORITY: Readonly<Record<AtlasAttentionReason, number>> = {
  approval: 0,
  input: 1,
  failed: 2,
  limited: 3,
  woke: 4,
  unread: 5,
};

export function compareAttentionReasons(
  left: AtlasAttentionReason,
  right: AtlasAttentionReason,
): number {
  return ATTENTION_PRIORITY[left] - ATTENTION_PRIORITY[right];
}
