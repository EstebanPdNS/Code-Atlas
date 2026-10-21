import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ClaudeProviderCapabilitiesV2 } from "./Adapters/ClaudeAdapterV2.ts";
import * as CompactionFollowUpService from "./CompactionFollowUpService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const threadId = ThreadId.make("compacting-thread");
const providerThreadId = ProviderThreadId.make("provider-thread");
const sessionId = ProviderSessionId.make("provider-session");
const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 21, 9, 0, seconds));

const run = (ordinal: number, status: "running" | "queued" | "completed") => ({
  id: RunId.make(`run-${ordinal}`),
  ordinal,
  status,
  userMessageId: MessageId.make(`message-${ordinal}`),
  providerThreadId,
  activeAttemptId: status === "running" ? RunAttemptId.make(`attempt-${ordinal}`) : null,
  requestedAt: at(ordinal),
  startedAt: status === "queued" ? null : at(ordinal),
  completedAt: status === "completed" ? at(20) : null,
});

const message = (ordinal: number, text: string, createdSecond: number) => ({
  id: MessageId.make(`message-${ordinal}`),
  role: "user",
  text,
  attachments: [],
  createdAt: at(createdSecond),
});

const compaction = (runOrdinal: number, completedSecond: number | null) => ({
  type: "compaction",
  runId: RunId.make(`run-${runOrdinal}`),
  status: completedSecond === null ? "running" : "completed",
  startedAt: at(10),
  completedAt: completedSecond === null ? null : at(completedSecond),
});

const steerableSession = {
  providerTurns: [] as Array<{ runAttemptId: RunAttemptId; status: "running" }>,
  providerThreads: [{ id: providerThreadId, providerSessionId: sessionId }],
  providerSessions: [{ id: sessionId, capabilities: ClaudeProviderCapabilitiesV2 }],
};

const event = (type: string, payload: unknown, id: string) =>
  ({ id: EventId.make(id), type, threadId, occurredAt: at(30), payload }) as never;

/** Runs the service against fixed thread records and a mocked orchestrator. */
const startService = Effect.fn("CompactionFollowUpTest.startService")(function* (
  records: Record<string, unknown>,
) {
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
  yield* Effect.gen(function* () {
    yield* (yield* CompactionFollowUpService.make).start();
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadRecords: () => Effect.succeed(records as never),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.fromQueue(events),
          dispatch: (command) =>
            Queue.offer(commands, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
        }),
      ),
    ),
  );
  return { events, commands };
});

it.effect("steers a message sent during a native compaction once compaction ends", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { events, commands } = yield* startService({
        runs: [run(1, "running"), run(2, "queued")],
        messages: [message(1, "Refactor the parser", 1), message(2, "Also add tests", 15)],
        ...steerableSession,
        providerTurns: [{ runAttemptId: RunAttemptId.make("attempt-1"), status: "running" }],
        turnItems: [compaction(1, 25)],
      });
      yield* Queue.offer(events, event("turn-item.updated", compaction(1, 25), "compacted"));
      expect(yield* Queue.take(commands)).toEqual({
        type: "queued-message.promote-to-steer",
        commandId: `server:compaction-follow-up:${threadId}:run-2:run-1`,
        threadId,
        queuedRunId: RunId.make("run-2"),
        targetRunId: RunId.make("run-1"),
      });
    }),
  ),
);

it.effect("steers later messages into the turn the first one started after /compact", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const turn = {
        id: ProviderTurnId.make("provider-turn-2"),
        runAttemptId: RunAttemptId.make("attempt-2"),
        status: "running" as const,
      };
      const { events, commands } = yield* startService({
        runs: [run(1, "completed"), run(2, "running"), run(3, "queued")],
        messages: [
          message(1, "/compact", 1),
          message(2, "First while compacting", 12),
          message(3, "Second while compacting", 14),
        ],
        ...steerableSession,
        providerTurns: [turn],
        turnItems: [compaction(1, 19)],
      });
      yield* Queue.offer(events, event("provider-turn.updated", turn, "turn-started"));
      expect(yield* Queue.take(commands)).toMatchObject({
        type: "queued-message.promote-to-steer",
        queuedRunId: RunId.make("run-3"),
        targetRunId: RunId.make("run-2"),
      });
    }),
  ),
);
