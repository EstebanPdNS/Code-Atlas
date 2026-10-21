import {
  MessageId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  compactionFollowUpRuns,
  isCompactCommandMessage,
  planCompactionFollowUpSteer,
} from "./compactionFollowUps.ts";

const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 21, 9, 0, seconds));
const providerThreadId = ProviderThreadId.make("provider-thread");

const run = (
  ordinal: number,
  status: OrchestrationV2Run["status"],
  overrides: Partial<OrchestrationV2Run> = {},
) => ({
  id: RunId.make(`run-${ordinal}`),
  ordinal,
  status,
  userMessageId: MessageId.make(`message-${ordinal}`),
  requestedAt: at(ordinal),
  startedAt: status === "queued" ? null : at(ordinal),
  completedAt: null,
  providerThreadId,
  activeAttemptId: status === "running" ? RunAttemptId.make(`attempt-${ordinal}`) : null,
  ...overrides,
});

const message = (
  ordinal: number,
  text: string,
  createdSecond: number,
  overrides: Partial<OrchestrationV2ConversationMessage> = {},
) => ({
  id: MessageId.make(`message-${ordinal}`),
  text,
  attachments: [],
  createdAt: at(createdSecond),
  ...overrides,
});

const compaction = (
  runOrdinal: number,
  status: "running" | "completed",
  startSecond: number,
  endSecond?: number,
) => ({
  runId: RunId.make(`run-${runOrdinal}`),
  status,
  startedAt: at(startSecond),
  completedAt: endSecond === undefined ? null : at(endSecond),
});

const ids = (runs: ReadonlyArray<{ readonly id: RunId }>) => runs.map(({ id }) => id);

describe("compactionFollowUpRuns", () => {
  it("keeps messages sent during a /compact turn, but not those queued before it", () => {
    const input = {
      runs: [
        run(1, "running"),
        run(2, "queued"),
        run(3, "queued", { requestedAt: at(3) }),
        run(4, "queued"),
      ],
      messages: [
        message(1, "Work on it", 1),
        message(2, "/compact", 2),
        message(3, "Before compaction", 3),
        message(4, "Still waiting", 4),
      ],
      compactionItems: [],
    };
    // A /compact still waiting behind a turn holds nothing yet.
    expect(compactionFollowUpRuns(input)).toEqual([]);

    const compacting = {
      runs: [
        run(1, "completed", { completedAt: at(10) }),
        run(2, "running", { startedAt: at(10) }),
        run(3, "queued"),
        run(5, "queued"),
      ],
      messages: [...input.messages, message(5, "Sent while compacting", 20)],
      compactionItems: [compaction(2, "running", 11)],
    };
    // Once it runs, the queue behind it waits only for compaction, and so does
    // every message the user sends meanwhile.
    expect(ids(compactionFollowUpRuns(compacting))).toEqual([
      RunId.make("run-3"),
      RunId.make("run-5"),
    ]);
  });

  it("keeps a message sent during a native compaction inside a running turn", () => {
    const input = {
      runs: [run(1, "running"), run(2, "queued"), run(3, "queued")],
      messages: [
        message(1, "Work on it", 1),
        message(2, "Queued before compaction", 5),
        message(3, "Sent while compacting", 25),
      ],
      compactionItems: [compaction(1, "running", 20)],
    };
    expect(ids(compactionFollowUpRuns(input))).toEqual([RunId.make("run-3")]);
    // The message stays a follow-up after compaction ends, until it is delivered.
    expect(
      ids(
        compactionFollowUpRuns({ ...input, compactionItems: [compaction(1, "completed", 20, 30)] }),
      ),
    ).toEqual([RunId.make("run-3")]);
  });

  it("keeps the message sent with compact-before-send behind its /compact", () => {
    const input = {
      runs: [
        run(1, "completed", { completedAt: at(1) }),
        run(2, "starting", { startedAt: null, requestedAt: at(9) }),
        run(3, "queued"),
      ],
      messages: [message(1, "Old", 0), message(2, "/compact", 9), message(3, "Resume", 8)],
      compactionItems: [],
    };
    expect(ids(compactionFollowUpRuns(input))).toEqual([RunId.make("run-3")]);
  });

  it("leaves held queues, automatic deliveries and maintenance commands to the queue", () => {
    const input = {
      runs: [
        run(1, "running", { startedAt: at(10) }),
        run(2, "queued", { queueHeld: true }),
        run(3, "queued"),
        run(4, "queued"),
        run(5, "queued"),
      ],
      messages: [
        message(1, "/compact", 10),
        message(2, "Held", 11),
        message(3, "Wake", 12, { notification: {} as never }),
        message(4, " /LOGOUT ", 13),
        message(5, "Delivered after compaction", 14),
      ],
      compactionItems: [],
    };
    expect(ids(compactionFollowUpRuns(input))).toEqual([RunId.make("run-5")]);
  });
});

describe("planCompactionFollowUpSteer", () => {
  const sessionId = ProviderSessionId.make("session");
  const steerable = (steer: boolean) => ({
    providerThreads: [{ id: providerThreadId, providerSessionId: sessionId }],
    providerSessions: [
      { id: sessionId, capabilities: { turns: { supportsActiveSteering: steer } } as never },
    ],
  });

  it("steers native-compaction follow-ups into the turn once compaction ends", () => {
    const base = {
      runs: [run(1, "running"), run(2, "queued")],
      messages: [message(1, "Work on it", 1), message(2, "Sent while compacting", 25)],
      providerTurns: [{ runAttemptId: RunAttemptId.make("attempt-1"), status: "running" as const }],
      ...steerable(true),
    };
    expect(
      planCompactionFollowUpSteer({ ...base, compactionItems: [compaction(1, "running", 20)] }),
    ).toBeNull();
    expect(
      planCompactionFollowUpSteer({
        ...base,
        compactionItems: [compaction(1, "completed", 20, 30)],
      }),
    ).toEqual({ targetRunId: RunId.make("run-1"), queuedRunIds: [RunId.make("run-2")] });
    // Providers that cannot take a steer deliver them through the queue instead.
    expect(
      planCompactionFollowUpSteer({
        ...base,
        ...steerable(false),
        compactionItems: [compaction(1, "completed", 20, 30)],
      }),
    ).toBeNull();
  });

  it("never steers into a /compact turn, and steers later follow-ups into the first one", () => {
    const messages = [
      message(1, "/compact", 10),
      message(2, "First while compacting", 12),
      message(3, "Second while compacting", 13),
    ];
    const compactionItems = [compaction(1, "completed", 10, 20)];
    expect(
      planCompactionFollowUpSteer({
        runs: [run(1, "running", { startedAt: at(10) }), run(2, "queued"), run(3, "queued")],
        messages,
        compactionItems,
        providerTurns: [
          { runAttemptId: RunAttemptId.make("attempt-1"), status: "running" as const },
        ],
        ...steerable(true),
      }),
    ).toBeNull();
    expect(
      planCompactionFollowUpSteer({
        runs: [
          run(1, "completed", { startedAt: at(10), completedAt: at(20) }),
          run(2, "running", { startedAt: at(21) }),
          run(3, "queued"),
        ],
        messages,
        compactionItems,
        providerTurns: [
          { runAttemptId: RunAttemptId.make("attempt-2"), status: "running" as const },
        ],
        ...steerable(true),
      }),
    ).toEqual({ targetRunId: RunId.make("run-2"), queuedRunIds: [RunId.make("run-3")] });
  });
});

describe("isCompactCommandMessage", () => {
  it("matches only a bare /compact", () => {
    expect(isCompactCommandMessage({ text: " /Compact ", attachments: [] })).toBe(true);
    expect(isCompactCommandMessage({ text: "/compact", attachments: [{}] })).toBe(false);
    expect(isCompactCommandMessage({ text: "/compact now" })).toBe(false);
  });
});
