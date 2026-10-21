import { MessageId, RunId, ThreadId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import {
  transientRetryMessageId,
  type TransientRetryPlan,
} from "@t3tools/shared/transientFailureRetry";
import { describe, expect, it } from "vite-plus/test";

import { deriveMessagesTimelineRows } from "~/components/chat/MessagesTimeline.logic";
import type { TimelineEntry } from "~/session-logic";

import { transientRetryLabel, withoutTransientRetryChains } from "./transientRetry";

const plan = (attempt: number) => ({ dueAtMs: 10_000, attempt }) as TransientRetryPlan;

describe("transientRetryLabel", () => {
  it("counts down whole seconds to the server's retry", () => {
    expect(transientRetryLabel(plan(1), 0)).toBe("Retrying in 10s");
    expect(transientRetryLabel(plan(1), 9_001)).toBe("Retrying in 1s");
  });

  it("waits on the server once due and numbers later attempts", () => {
    expect(transientRetryLabel(plan(1), 10_000)).toBe("Retrying…");
    expect(transientRetryLabel(plan(3), 4_000)).toBe("Retrying in 6s · attempt 3");
  });
});

const threadId = ThreadId.make("thread:1");
const origin = RunId.make("run-1");

const userMessage = (id: string, runId: string): TimelineEntry => ({
  id: `message-${id}`,
  kind: "message",
  createdAt: "2026-10-21T06:08:00.000Z",
  message: {
    id: MessageId.make(id),
    role: "user",
    text: "Continue where you left off.",
    runId: RunId.make(runId),
    streaming: false,
    createdAt: "2026-10-21T06:08:00.000Z",
    updatedAt: "2026-10-21T06:08:00.000Z",
  },
});

const reply = (runId: string): TimelineEntry => ({
  ...userMessage(`reply-${runId}`, runId),
  id: `reply-${runId}`,
});

const providerError = (runId: string): TimelineEntry =>
  ({
    id: `error-${runId}`,
    kind: "event",
    createdAt: "2026-10-21T06:08:00.000Z",
    projectedItem: {
      item: {
        id: `error-${runId}`,
        threadId,
        runId: RunId.make(runId),
        type: "error",
        status: "failed",
        parentItemId: null,
      } as unknown as OrchestrationV2TurnItem,
    },
  }) as TimelineEntry;

const retry = (attempt: number, runId: string) =>
  userMessage(transientRetryMessageId(threadId, origin, attempt), runId);

const ids = (entries: ReadonlyArray<TimelineEntry>) => entries.map((entry) => entry.id);

describe("withoutTransientRetryChains", () => {
  it("leaves a timeline without server retries untouched", () => {
    const entries = [userMessage("prompt", "run-1"), providerError("run-1")];
    expect(withoutTransientRetryChains(entries)).toBe(entries);
  });

  it("shows a failing chain as the prompt and the latest attempt's error", () => {
    const entries = [
      userMessage("prompt", "run-1"),
      providerError("run-1"),
      retry(1, "run-2"),
      providerError("run-2"),
      retry(2, "run-3"),
      providerError("run-3"),
    ];
    expect(ids(withoutTransientRetryChains(entries))).toEqual(["message-prompt", "error-run-3"]);
  });

  it("leaves no error behind once a retry gets through", () => {
    const entries = [
      userMessage("prompt", "run-1"),
      providerError("run-1"),
      retry(1, "run-2"),
      providerError("run-2"),
      retry(2, "run-3"),
      reply("run-3"),
    ];
    expect(ids(withoutTransientRetryChains(entries))).toEqual(["message-prompt", "reply-run-3"]);
  });

  it("keeps errors outside the chain", () => {
    const entries = [
      userMessage("earlier", "run-0"),
      providerError("run-0"),
      userMessage("prompt", "run-1"),
      providerError("run-1"),
      retry(1, "run-2"),
    ];
    expect(ids(withoutTransientRetryChains(entries))).toEqual([
      "message-earlier",
      "error-run-0",
      "message-prompt",
    ]);
  });

  it("drops the server's retry turns from the timeline rows", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [userMessage("prompt", "run-1"), retry(1, "run-2"), reply("run-2")],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    const messageIds = rows.flatMap((row) => (row.kind === "message" ? [row.message.id] : []));
    expect(messageIds).toEqual(["prompt", "reply-run-2"]);
  });
});
