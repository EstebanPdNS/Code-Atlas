import type {
  ChatAttachment,
  MessageId,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";
import {
  compactionFollowUpRuns,
  isCompactCommandMessage,
} from "@t3tools/shared/compactionFollowUps";
import * as DateTime from "effect/DateTime";

import type { TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";

/**
 * `/compact`, typed or sent by Code Atlas, shows only as its "Compacting
 * context" row, never as a message bubble.
 */
export function withoutCompactCommandMessages(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<TimelineEntry> {
  const hidden = (entry: TimelineEntry) =>
    entry.kind === "message" &&
    entry.message.role === "user" &&
    isCompactCommandMessage(entry.message);
  return entries.some(hidden) ? entries.filter((entry) => !hidden(entry)) : entries;
}

/** A message sent while the thread compacts that the agent has not received yet. */
export interface CompactionFollowUp {
  readonly runId: RunId | null;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

export interface CompactionFollowUps {
  /** Shown in the conversation as sent, in place of the Queued panel. */
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly byMessageId: ReadonlyMap<string, CompactionFollowUp>;
}

const EMPTY: CompactionFollowUps = { messages: [], byMessageId: new Map() };

/**
 * Messages sent while the thread compacts read as sent: they leave the Queued
 * panel for the conversation, and the server delivers them as soon as
 * compaction ends (`@t3tools/shared/compactionFollowUps`). A message being
 * edited goes back to the panel, which owns the edit.
 */
export function deriveCompactionFollowUps(input: {
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  readonly visibleTurnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  /** Not yet acknowledged by the server; a queued one sent mid-compaction counts. */
  readonly optimisticMessages: ReadonlyArray<ChatMessage>;
  readonly isCompacting: boolean;
  readonly editingRunId: RunId | null;
}): CompactionFollowUps {
  const compactionItems = input.visibleTurnItems.flatMap(({ item }) =>
    item.type === "compaction" ? [item] : [],
  );
  const runs =
    input.projection == null
      ? []
      : compactionFollowUpRuns({
          runs: input.projection.runs,
          messages: input.projection.messages,
          compactionItems,
        }).filter((run) => run.id !== input.editingRunId);
  const acknowledged = new Set(input.projection?.messages.map((message) => message.id));
  const optimistic = input.isCompacting
    ? input.optimisticMessages.filter(
        (message) => message.inputIntent === "queued_turn" && !acknowledged.has(message.id),
      )
    : [];
  if (runs.length === 0 && optimistic.length === 0) return EMPTY;

  // Below the "Compacting context" row even when sent just before it began.
  const latestCompactionStart = compactionItems.reduce<string | null>((latest, item) => {
    if (item.startedAt === null) return latest;
    const start = DateTime.formatIso(item.startedAt);
    return latest === null || start > latest ? start : latest;
  }, null);
  const shownAt = (createdAt: string) =>
    latestCompactionStart !== null && latestCompactionStart > createdAt
      ? latestCompactionStart
      : createdAt;

  const messageById = new Map(input.projection?.messages.map((message) => [message.id, message]));
  const messages: Array<ChatMessage> = [];
  const byMessageId = new Map<string, CompactionFollowUp>();
  for (const run of runs) {
    const message = messageById.get(run.userMessageId);
    if (message === undefined) continue;
    const createdAt = shownAt(DateTime.formatIso(message.createdAt));
    messages.push({
      id: message.id,
      role: "user",
      text: message.text,
      ...(message.attachments.length > 0 ? { attachments: message.attachments } : {}),
      ...(message.context ? { context: message.context } : {}),
      runId: null,
      streaming: false,
      createdBy: message.createdBy,
      creationSource: message.creationSource,
      ...(message.senderThreadId !== undefined ? { senderThreadId: message.senderThreadId } : {}),
      ...(message.scheduledTaskId !== undefined
        ? { scheduledTaskId: message.scheduledTaskId }
        : {}),
      createdAt,
      updatedAt: DateTime.formatIso(message.updatedAt),
    });
    byMessageId.set(message.id, {
      runId: run.id,
      messageId: message.id,
      text: message.text,
      attachments: message.attachments,
    });
  }
  for (const message of optimistic) {
    const { inputIntent: _queued, ...sent } = message;
    messages.push({ ...sent, createdAt: shownAt(message.createdAt) });
    byMessageId.set(message.id, {
      runId: null,
      messageId: message.id,
      text: message.text,
      attachments: [],
    });
  }
  return { messages, byMessageId };
}
