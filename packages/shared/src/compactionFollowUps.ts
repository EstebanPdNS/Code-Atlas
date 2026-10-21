import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2ProviderSession,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { copySorted } from "./Array.ts";

/**
 * Code Atlas: a message the user sends while the thread compacts reads as sent
 * right away. A compacting turn cannot take steering input, so the message
 * waits in the queue until compaction ends: after a `/compact` turn the queue
 * starts it, and the server steers it into the turn that runs next, whether
 * that is the turn whose provider compacted on its own or the turn the first
 * such message started. The server and the client derive the same follow-ups
 * from the projection, so the timeline shows exactly the messages the server
 * is about to deliver.
 */

type FollowUpRun = Pick<
  OrchestrationV2Run,
  | "id"
  | "ordinal"
  | "status"
  | "userMessageId"
  | "queueHeld"
  | "queuePosition"
  | "requestedAt"
  | "startedAt"
  | "completedAt"
>;
type FollowUpMessage = Pick<
  OrchestrationV2ConversationMessage,
  "id" | "text" | "attachments" | "createdAt" | "delegatedCompletion" | "notification"
>;
type CompactionItem = Pick<
  Extract<OrchestrationV2TurnItem, { readonly type: "compaction" }>,
  "runId" | "status" | "startedAt" | "completedAt"
>;

export interface CompactionFollowUpInput<R extends FollowUpRun> {
  readonly runs: ReadonlyArray<R>;
  readonly messages: ReadonlyArray<FollowUpMessage>;
  /** The thread's `compaction` turn items, from `/compact` turns and native compactions. */
  readonly compactionItems: ReadonlyArray<CompactionItem>;
}

const MAINTENANCE_COMMANDS: ReadonlySet<string> = new Set(["/compact", "/logout"]);

/** The `/compact` command, typed by the user or sent by Code Atlas. */
export function isCompactCommandMessage(message: {
  readonly text: string;
  readonly attachments?: ReadonlyArray<unknown> | undefined;
}): boolean {
  return (
    (message.attachments?.length ?? 0) === 0 && message.text.trim().toLowerCase() === "/compact"
  );
}

function isMaintenanceCommand(message: FollowUpMessage): boolean {
  return (
    message.attachments.length === 0 && MAINTENANCE_COMMANDS.has(message.text.trim().toLowerCase())
  );
}

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

interface CompactionWindow {
  readonly startMs: number;
  readonly endMs: number;
}

function compactionWindows<R extends FollowUpRun>(
  input: CompactionFollowUpInput<R>,
  messageById: ReadonlyMap<string, FollowUpMessage>,
): ReadonlyArray<CompactionWindow> {
  const windows: Array<CompactionWindow> = [];
  for (const run of input.runs) {
    const message = messageById.get(run.userMessageId);
    if (message === undefined || !isCompactCommandMessage(message)) continue;
    const active = ACTIVE_RUN_STATUSES.has(run.status);
    // A compaction sent to an idle thread starts at once; one that waited in the
    // queue starts when it leaves it.
    const start = run.startedAt ?? (active ? run.requestedAt : null);
    if (start === null) continue;
    windows.push({
      startMs: DateTime.toEpochMillis(start),
      endMs: run.completedAt === null ? Infinity : DateTime.toEpochMillis(run.completedAt),
    });
  }
  for (const item of input.compactionItems) {
    if (item.startedAt === null) continue;
    const startMs = DateTime.toEpochMillis(item.startedAt);
    windows.push({
      startMs,
      endMs:
        item.completedAt !== null
          ? DateTime.toEpochMillis(item.completedAt)
          : item.status === "running" || item.status === "pending"
            ? Infinity
            : startMs,
    });
  }
  return windows;
}

/**
 * Queued messages sent while the thread compacted, or queued behind a
 * `/compact` turn that has started, in delivery order. Held queues (after Stop
 * or a failure) are left to the queue, which shows how to resume them.
 */
export function compactionFollowUpRuns<R extends FollowUpRun>(
  input: CompactionFollowUpInput<R>,
): ReadonlyArray<R> {
  if (!input.runs.some((run) => run.status === "queued")) return [];
  const messageById = new Map(input.messages.map((message) => [message.id, message]));
  const windows = compactionWindows(input, messageById);
  const byOrdinal = copySorted(input.runs, (left, right) => left.ordinal - right.ordinal);
  const followUps: Array<R> = [];
  let previous: R | undefined;
  for (const run of byOrdinal) {
    const message = messageById.get(run.userMessageId);
    if (
      run.status === "queued" &&
      run.queueHeld !== true &&
      message !== undefined &&
      message.delegatedCompletion === undefined &&
      message.notification === undefined &&
      !isMaintenanceCommand(message)
    ) {
      const createdMs = DateTime.toEpochMillis(message.createdAt);
      const previousMessage = previous && messageById.get(previous.userMessageId);
      if (
        windows.some((window) => window.startMs <= createdMs && createdMs <= window.endMs) ||
        (previousMessage !== undefined && isCompactCommandMessage(previousMessage))
      )
        followUps.push(run);
    }
    if (run.status !== "queued" && run.status !== "cancelled") previous = run;
  }
  return copySorted(
    followUps,
    (left, right) =>
      (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
      left.ordinal - right.ordinal,
  );
}

type SteerRun = FollowUpRun & Pick<OrchestrationV2Run, "providerThreadId" | "activeAttemptId">;

export interface CompactionFollowUpSteerInput<
  R extends SteerRun,
> extends CompactionFollowUpInput<R> {
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "providerSessionId">
  >;
  readonly providerSessions: ReadonlyArray<
    Pick<OrchestrationV2ProviderSession, "id" | "capabilities">
  >;
}

export interface CompactionFollowUpSteer {
  readonly targetRunId: RunId;
  readonly queuedRunIds: ReadonlyArray<RunId>;
}

/**
 * The follow-ups the server steers into the running turn once no compaction
 * runs in it. Only providers that take a steer into the running turn qualify;
 * elsewhere the follow-ups wait for the queue like any other message.
 */
export function planCompactionFollowUpSteer<R extends SteerRun>(
  input: CompactionFollowUpSteerInput<R>,
): CompactionFollowUpSteer | null {
  const target = input.runs.findLast((run) => run.status === "running");
  if (target === undefined || target.activeAttemptId === null) return null;
  const targetMessage = input.messages.find((message) => message.id === target.userMessageId);
  if (targetMessage === undefined || isMaintenanceCommand(targetMessage)) return null;
  if (
    input.compactionItems.some(
      (item) =>
        item.runId === target.id && (item.status === "running" || item.status === "pending"),
    )
  )
    return null;
  if (
    !input.providerTurns.some(
      (turn) => turn.runAttemptId === target.activeAttemptId && turn.status === "running",
    )
  )
    return null;
  const sessionId =
    input.providerThreads.find((thread) => thread.id === target.providerThreadId)
      ?.providerSessionId ?? null;
  const session = input.providerSessions.find((candidate) => candidate.id === sessionId);
  if (session?.capabilities.turns.supportsActiveSteering !== true) return null;
  const queuedRunIds = compactionFollowUpRuns(input)
    .filter((run) => run.ordinal > target.ordinal)
    .map((run) => run.id);
  return queuedRunIds.length === 0 ? null : { targetRunId: target.id, queuedRunIds };
}
