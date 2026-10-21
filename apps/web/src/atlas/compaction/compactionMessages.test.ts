import { MessageId, RunId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveMessagesTimelineRows } from "~/components/chat/MessagesTimeline.logic";
import type { TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";

import { deriveCompactionFollowUps, withoutCompactCommandMessages } from "./compactionMessages";

const iso = (second: number) => new Date(Date.UTC(2026, 9, 21, 9, 0, second)).toISOString();
const at = (second: number) => DateTime.makeUnsafe(iso(second));

const chatMessage = (id: string, text: string, second: number): ChatMessage => ({
  id: MessageId.make(id),
  role: "user",
  text,
  runId: null,
  streaming: false,
  createdAt: iso(second),
  updatedAt: iso(second),
});

const messageEntry = (id: string, text: string, second: number): TimelineEntry => ({
  id,
  kind: "message",
  createdAt: iso(second),
  message: chatMessage(id, text, second),
});

describe("withoutCompactCommandMessages", () => {
  it("drops /compact bubbles and keeps other messages", () => {
    const entries = [
      messageEntry("first", "Fix the build", 1),
      messageEntry("compact", " /compact ", 2),
      messageEntry("later", "/compact the parser", 3),
    ];
    expect(withoutCompactCommandMessages(entries).map(({ id }) => id)).toEqual(["first", "later"]);
    expect(
      deriveMessagesTimelineRows({
        timelineEntries: entries,
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
      }).flatMap((row) => (row.kind === "message" ? [row.message.text] : [])),
    ).toEqual(["Fix the build", "/compact the parser"]);
  });
});

describe("deriveCompactionFollowUps", () => {
  const projection = {
    runs: [
      {
        id: RunId.make("run-1"),
        ordinal: 1,
        status: "running",
        userMessageId: MessageId.make("compact"),
        requestedAt: at(10),
        startedAt: at(10),
        completedAt: null,
      },
      {
        id: RunId.make("run-2"),
        ordinal: 2,
        status: "queued",
        userMessageId: MessageId.make("follow-up"),
        requestedAt: at(15),
        startedAt: null,
        completedAt: null,
      },
    ],
    messages: [
      { id: MessageId.make("compact"), text: "/compact", attachments: [], createdAt: at(10) },
      {
        id: MessageId.make("follow-up"),
        role: "user",
        text: "Then add tests",
        attachments: [],
        createdAt: at(15),
        updatedAt: at(15),
        createdBy: "user",
        creationSource: "web",
      },
    ],
  } as unknown as OrchestrationV2ThreadProjection;
  const compactionRow = {
    item: {
      type: "compaction",
      runId: "run-1",
      status: "running",
      startedAt: at(11),
      completedAt: null,
    },
  } as never;

  it("shows a message queued behind compaction as sent, with its queued run", () => {
    const followUps = deriveCompactionFollowUps({
      projection,
      visibleTurnItems: [compactionRow],
      optimisticMessages: [],
      isCompacting: true,
      editingRunId: null,
    });
    expect(followUps.messages).toMatchObject([
      { id: "follow-up", role: "user", text: "Then add tests", runId: null, createdAt: iso(15) },
    ]);
    expect(followUps.byMessageId.get("follow-up")?.runId).toBe("run-2");
    // While it is edited, the Queued panel owns it.
    expect(
      deriveCompactionFollowUps({
        projection,
        visibleTurnItems: [compactionRow],
        optimisticMessages: [],
        isCompacting: true,
        editingRunId: RunId.make("run-2"),
      }).messages,
    ).toEqual([]);
  });

  it("shows a queued send at once while compacting, below the compaction row", () => {
    const optimistic = {
      ...chatMessage("pending", "Use the new API", 5),
      inputIntent: "queued_turn" as const,
    };
    const followUps = deriveCompactionFollowUps({
      projection: { ...projection, runs: [], messages: [] },
      visibleTurnItems: [compactionRow],
      optimisticMessages: [optimistic],
      isCompacting: true,
      editingRunId: null,
    });
    expect(followUps.messages).toEqual([
      { ...chatMessage("pending", "Use the new API", 5), createdAt: iso(11) },
    ]);
    expect(followUps.byMessageId.get("pending")?.runId).toBeNull();
    expect(
      deriveCompactionFollowUps({
        projection: { ...projection, runs: [], messages: [] },
        visibleTurnItems: [],
        optimisticMessages: [optimistic],
        isCompacting: false,
        editingRunId: null,
      }).messages,
    ).toEqual([]);
  });
});
