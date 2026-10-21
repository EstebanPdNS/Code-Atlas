import { expect, it } from "@effect/vitest";
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
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import {
  TRANSIENT_RETRY_CONTINUE_TEXT,
  transientRetryMessageId,
} from "@t3tools/shared/transientFailureRetry";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as TransientFailureRetryService from "./TransientFailureRetryService.ts";

const FAILED_AT_MS = Date.parse("2026-10-21T06:08:00.000Z");
const at = DateTime.makeUnsafe(FAILED_AT_MS);
const threadId = ThreadId.make("capacity-thread");
const instanceId = ProviderInstanceId.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread");
const modelSelection = { instanceId, model: "gpt-6.1" };
const atCapacity = makeProviderFailure({
  class: "provider_error",
  message: "Selected model is at capacity. Please try a different model.",
});

const makeRun = (
  ordinal: number,
  userMessageId: MessageId,
  overrides: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run => ({
  id: RunId.make(`run-${ordinal}`),
  threadId,
  ordinal,
  providerInstanceId: instanceId,
  modelSelection,
  providerThreadId,
  userMessageId,
  rootNodeId: NodeId.make(`root-${ordinal}`),
  activeAttemptId: null,
  status: "failed",
  requestedAt: at,
  startedAt: at,
  completedAt: at,
  checkpointId: null,
  contextHandoffId: null,
  ...overrides,
});

const original = makeRun(1, MessageId.make("message-1"));

let sequence = 0;
const apply = Effect.fn("TransientFailureRetryTest.apply")(function* (
  event: Omit<OrchestrationV2DomainEvent, "id" | "threadId" | "occurredAt">,
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  yield* store.apply({
    ...event,
    id: EventId.make(`e${++sequence}`),
    threadId,
    occurredAt: at,
  } as OrchestrationV2DomainEvent);
});

const createThread = apply({
  type: "thread.created",
  payload: {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Capacity",
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

const addError = Effect.fn("TransientFailureRetryTest.addError")(function* (
  run: OrchestrationV2Run,
  failure: OrchestrationV2ProviderFailure = atCapacity,
) {
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
      title: "Provider error",
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "error",
      failure,
    },
  });
});

const addRun = Effect.fn("TransientFailureRetryTest.addRun")(function* (
  run: OrchestrationV2Run,
  failure: OrchestrationV2ProviderFailure | null = atCapacity,
) {
  yield* apply({ type: "run.created", payload: run });
  yield* apply({
    type: "message.updated",
    payload: {
      id: run.userMessageId,
      threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      role: "user",
      text: "Link the recovered code",
      attachments: [],
      streaming: false,
      createdBy: "user",
      creationSource: "web",
      createdAt: at,
      updatedAt: at,
    },
  });
  if (failure !== null) yield* addError(run, failure);
});

const runUpdated = (run: OrchestrationV2Run): OrchestrationV2DomainEvent => ({
  id: EventId.make(`run-updated-${run.id}-${run.status}`),
  type: "run.updated",
  threadId,
  occurredAt: at,
  payload: run,
});

/**
 * Starts the reactor against an in-memory projection. `planned` yields once
 * the reactor has read the thread for a plan, so the test can move the clock
 * past a sleep the reactor has already scheduled.
 */
const startReactor = Effect.fn("TransientFailureRetryTest.startReactor")(function* () {
  yield* TestClock.setTime(FAILED_AT_MS);
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
  const reads = yield* Queue.unbounded<void>();
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const dependencies = Layer.mergeAll(
    Layer.succeed(ProjectionStore.ProjectionStoreV2, {
      ...store,
      getThreadRecords: (...args) =>
        store
          .getThreadRecords(...args)
          .pipe(
            Effect.tap(() =>
              args[2]?.messageRoles?.includes("assistant") === true
                ? Queue.offer(reads, undefined)
                : Effect.void,
            ),
          ),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(events),
      dispatch: (command) =>
        Queue.offer(commands, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
    }),
  );
  return { events, commands, planned: Queue.take(reads), dependencies };
});

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
    Effect.scoped,
  );

it.effect("retries a capacity failure after 10 seconds, and again after each failed retry", () =>
  withStore(
    Effect.gen(function* () {
      yield* createThread;
      yield* addRun(original);
      const { events, commands, planned, dependencies } = yield* startReactor();
      yield* Effect.gen(function* () {
        yield* (yield* TransientFailureRetryService.make).start();
        yield* planned; // restart pickup of the already failed thread
        yield* Queue.offer(events, runUpdated(original));
        yield* planned;
        yield* TestClock.adjust("9 seconds");
        expect(yield* Queue.size(commands)).toBe(0);
        yield* TestClock.adjust("1 second");
        const first = yield* Queue.take(commands);
        expect(first).toMatchObject({
          type: "message.dispatch",
          threadId,
          messageId: transientRetryMessageId(threadId, original.id, 1),
          text: "Link the recovered code",
          createdBy: "user",
          creationSource: "server",
          dispatchMode: { type: "start_immediately" },
        });
        expect(first.commandId).toBe(`server:${transientRetryMessageId(threadId, original.id, 1)}`);

        // The retry was answered before the model ran out of capacity again.
        const retry = makeRun(2, transientRetryMessageId(threadId, original.id, 1), {
          completedAt: DateTime.makeUnsafe(FAILED_AT_MS + 30_000),
        });
        yield* addRun(retry);
        yield* apply({
          type: "message.updated",
          payload: {
            id: MessageId.make("assistant-2"),
            threadId,
            runId: retry.id,
            nodeId: retry.rootNodeId,
            role: "assistant",
            text: "Linking.",
            attachments: [],
            streaming: false,
            createdBy: "agent",
            creationSource: "provider",
            createdAt: at,
            updatedAt: at,
          },
        });
        yield* TestClock.setTime(FAILED_AT_MS + 30_000);
        yield* Queue.offer(events, runUpdated(retry));
        yield* planned;
        yield* TestClock.adjust("10 seconds");
        expect(yield* Queue.take(commands)).toMatchObject({
          type: "message.dispatch",
          messageId: transientRetryMessageId(threadId, original.id, 2),
          text: TRANSIENT_RETRY_CONTINUE_TEXT,
        });
        expect(yield* Queue.size(commands)).toBe(0);
      }).pipe(Effect.provide(dependencies));
    }),
  ),
);

it.effect("sends nothing once Retry now or the user's own message has started a run", () =>
  withStore(
    Effect.gen(function* () {
      yield* createThread;
      const { events, commands, planned, dependencies } = yield* startReactor();
      yield* Effect.gen(function* () {
        yield* (yield* TransientFailureRetryService.make).start();
        yield* addRun(original);
        yield* Queue.offer(events, runUpdated(original));
        yield* planned;
        // Retry now dispatched the planned attempt from the client before the timer fired.
        const retry = makeRun(2, transientRetryMessageId(threadId, original.id, 1), {
          status: "running",
          completedAt: null,
        });
        yield* addRun(retry, null);
        yield* TestClock.adjust("10 seconds");
        expect(yield* Queue.size(commands)).toBe(0);

        // That retry failed transiently too, and the user wrote before its retry was due.
        const failedRetry: OrchestrationV2Run = {
          ...retry,
          status: "failed",
          completedAt: DateTime.makeUnsafe(FAILED_AT_MS + 10_000),
        };
        yield* apply({ type: "run.updated", payload: failedRetry });
        yield* addError(failedRetry);
        yield* Queue.offer(events, runUpdated(failedRetry));
        yield* planned;
        yield* addRun(
          makeRun(3, MessageId.make("message-3"), { status: "running", completedAt: null }),
          null,
        );
        yield* TestClock.adjust("1 minute");
        expect(yield* Queue.size(commands)).toBe(0);
      }).pipe(Effect.provide(dependencies));
    }),
  ),
);

it.effect("stops after Stop and never retries failures a retry cannot fix", () =>
  withStore(
    Effect.gen(function* () {
      yield* createThread;
      const { events, commands, planned, dependencies } = yield* startReactor();
      yield* Effect.gen(function* () {
        yield* (yield* TransientFailureRetryService.make).start();
        yield* addRun(original);
        yield* Queue.offer(events, runUpdated(original));
        yield* planned;
        yield* apply({
          type: "turn-item.updated",
          payload: {
            id: TurnItemId.make("stop-run-1"),
            threadId,
            runId: original.id,
            nodeId: original.rootNodeId,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 150,
            status: "completed",
            title: "Stop requested",
            startedAt: at,
            completedAt: at,
            updatedAt: at,
            type: "run_interrupt_request",
            message: "Stop requested",
          },
        });
        yield* TestClock.adjust("10 seconds");
        expect(yield* Queue.size(commands)).toBe(0);

        const unauthorized = makeRun(2, MessageId.make("message-2"));
        yield* addRun(
          unauthorized,
          makeProviderFailure({ class: "provider_error", code: "unauthorized", message: "No." }),
        );
        yield* Queue.offer(events, runUpdated(unauthorized));
        yield* planned;
        yield* TestClock.adjust("1 minute");
        expect(yield* Queue.size(commands)).toBe(0);
      }).pipe(Effect.provide(dependencies));
    }),
  ),
);

it.effect("releases the queue the failure held once a retry gets through", () =>
  withStore(
    Effect.gen(function* () {
      yield* createThread;
      const { events, commands, dependencies } = yield* startReactor();
      yield* Effect.gen(function* () {
        yield* (yield* TransientFailureRetryService.make).start();
        yield* addRun(original);
        yield* addRun(
          makeRun(2, MessageId.make("queued-message"), {
            status: "queued",
            queueHeld: true,
            startedAt: null,
            completedAt: null,
          }),
          null,
        );
        const retry = makeRun(3, transientRetryMessageId(threadId, original.id, 1), {
          status: "completed",
        });
        yield* addRun(retry, null);
        yield* Queue.offer(events, runUpdated(retry));
        expect(yield* Queue.take(commands)).toMatchObject({
          type: "queue.resume",
          commandId: `server:transient-retry-resume:${threadId}:${retry.id}`,
          threadId,
        });
      }).pipe(Effect.provide(dependencies));
    }),
  ),
);
