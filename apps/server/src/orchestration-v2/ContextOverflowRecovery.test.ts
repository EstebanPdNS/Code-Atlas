import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  CONTEXT_WINDOW_FULL_CODE,
  isContextOverflowFailure,
  overflowCompactionFor,
  overflowCompactionMessageId,
  overflowResendMessageId,
} from "./ContextOverflowRecovery.ts";
import * as ContextOverflowRecoveryService from "./ContextOverflowRecoveryService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const claudeFull =
  "Claude stopped: the prompt exceeds the model's context window. Run /compact or start a new thread.";

describe("isContextOverflowFailure", () => {
  it("recognizes full context windows and ignores rate limits", () => {
    const failure = (code: string, message = "Provider turn failed.", cls = "provider_error") =>
      makeProviderFailure({ code, message, class: cls as "provider_error" });
    expect(isContextOverflowFailure(failure("prompt_too_long", claudeFull))).toBe(true);
    expect(isContextOverflowFailure(failure("blocking_limit", claudeFull))).toBe(true);
    expect(isContextOverflowFailure(failure("api_error_400", claudeFull))).toBe(true);
    expect(isContextOverflowFailure(failure("contextWindowExceeded"))).toBe(true);
    expect(isContextOverflowFailure(failure(CONTEXT_WINDOW_FULL_CODE))).toBe(true);
    expect(
      isContextOverflowFailure(failure("blocking_limit", "Claude API rate limit reached.")),
    ).toBe(false);
    expect(isContextOverflowFailure(failure("contextWindowExceeded", "Limit", "usage_limit"))).toBe(
      false,
    );
    expect(isContextOverflowFailure(null)).toBe(false);
  });

  it("finds the failed run behind an automatic compaction", () => {
    const threadId = ThreadId.make("thread:with:colons");
    const runId = RunId.make("run:7");
    expect(overflowCompactionFor(threadId, overflowCompactionMessageId(threadId, runId))).toBe(
      runId,
    );
    expect(overflowCompactionFor(threadId, overflowResendMessageId(threadId, runId))).toBeNull();
  });
});

const at = DateTime.makeUnsafe("2026-10-20T12:00:00.000Z");
const threadId = ThreadId.make("overflow-thread");
const instanceId = ProviderInstanceId.make("claudeAgent");
const providerThreadId = ProviderThreadId.make("provider-thread");
const modelSelection = { instanceId, model: "claude-opus-5-5" };

const failedRun = (ordinal: number, messageId: MessageId): OrchestrationV2Run => ({
  id: RunId.make(`run-${ordinal}`),
  threadId,
  ordinal,
  providerInstanceId: instanceId,
  modelSelection,
  providerThreadId,
  userMessageId: messageId,
  rootNodeId: NodeId.make(`root-${ordinal}`),
  activeAttemptId: null,
  status: "failed",
  requestedAt: at,
  startedAt: at,
  completedAt: at,
  checkpointId: null,
  contextHandoffId: null,
});

const seed = Effect.fn("seedOverflowThread")(function* (runs: ReadonlyArray<OrchestrationV2Run>) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  let sequence = 0;
  const apply = (event: Omit<OrchestrationV2DomainEvent, "id" | "threadId" | "occurredAt">) =>
    store.apply({
      ...event,
      id: EventId.make(`e${++sequence}`),
      threadId,
      occurredAt: at,
    } as OrchestrationV2DomainEvent);
  yield* apply({
    type: "thread.created",
    payload: {
      id: threadId,
      projectId: ProjectId.make("project"),
      title: "Overflow",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: at,
      deletedAt: null,
    },
  });
  for (const run of runs) {
    yield* apply({ type: "run.created", payload: run });
    yield* apply({
      type: "message.updated",
      payload: {
        id: run.userMessageId,
        threadId,
        runId: run.id,
        nodeId: run.rootNodeId,
        role: "user",
        text: "Summarize the repository",
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: at,
        updatedAt: at,
      },
    });
    yield* apply({
      type: "turn-item.updated",
      payload: {
        id: TurnItemId.make(`error-${run.id}`),
        threadId,
        runId: run.id,
        nodeId: run.rootNodeId,
        providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: run.ordinal * 100,
        status: "failed",
        title: "Provider turn failed",
        startedAt: at,
        completedAt: at,
        updatedAt: at,
        type: "error",
        failure: makeProviderFailure({
          class: "provider_error",
          code: "prompt_too_long",
          message: claudeFull,
        }),
      },
    });
  }
});

it.effect("never recovers a resend that overflows again", () =>
  Effect.gen(function* () {
    // Run 1 overflowed and was compacted; its resend (run 2, the latest) overflowed again.
    const original = failedRun(1, MessageId.make("message-1"));
    const resend = failedRun(2, overflowResendMessageId(threadId, original.id));
    yield* seed([original, resend]);
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
    const orchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(events),
      dispatch: (command) =>
        Queue.offer(commands, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
    });
    yield* Effect.gen(function* () {
      yield* (yield* ContextOverflowRecoveryService.make).start();
      yield* Queue.offer(events, {
        id: EventId.make("resend-failed"),
        type: "run.updated",
        threadId,
        occurredAt: at,
        payload: resend,
      });
      // A compaction completing later resends its message; events are handled in
      // order, so a /compact for the failed resend would have arrived first.
      yield* Queue.offer(events, {
        id: EventId.make("compaction-completed"),
        type: "run.updated",
        threadId,
        occurredAt: at,
        payload: {
          ...failedRun(3, overflowCompactionMessageId(threadId, original.id)),
          status: "completed",
        },
      });
      expect(yield* Queue.take(commands)).toMatchObject({
        type: "message.dispatch",
        threadId,
        messageId: overflowResendMessageId(threadId, original.id),
        text: "Summarize the repository",
        createdBy: "user",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    }).pipe(Effect.provide(orchestrator));
  }).pipe(
    Effect.provide(ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
    Effect.scoped,
  ),
);
