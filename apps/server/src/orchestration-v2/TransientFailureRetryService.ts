import { CommandId, type OrchestrationV2Run, type RunId, type ThreadId } from "@t3tools/contracts";
import { planTransientRetry, transientRetryOf } from "@t3tools/shared/transientFailureRetry";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// Timers live in memory; a restart picks up recent failures again from the shell.
const RESTART_PICKUP_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Code Atlas: a run that fails because the provider was briefly unavailable
 * (model at capacity, overloaded, a 5xx, a dropped connection) is retried
 * 10 seconds after it failed, and again after each transient failure of the
 * retry, until a run gets through. The retry continues the work (or resumes a
 * Codex goal) and is sent once per attempt, under an id the client's
 * "Retry now" shares. A message from the user, Stop, a pending question, or a
 * failure a retry cannot fix ends the chain; see `planTransientRetry`.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const readPlan = Effect.fn("TransientFailureRetryService.readPlan")(function* (
    threadId: ThreadId,
    failedRunId: RunId,
  ) {
    const records = yield* projections.getThreadRecords(threadId, [
      "runs",
      "providerThreads",
      "runtimeRequests",
    ]);
    const run = records.runs.find((candidate) => candidate.id === failedRunId);
    if (run === undefined) return null;
    const { turnItems } = yield* projections.getThreadRecords(threadId, ["turnItems"], {
      turnItemTypes: ["error", "run_interrupt_request"],
      turnItemRunIds: [failedRunId],
    });
    const prompt = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageIds: [run.userMessageId],
    });
    const replies = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageRunIds: [failedRunId],
      messageRoles: ["assistant"],
    });
    const plan = planTransientRetry({
      ...records,
      turnItems,
      messages: [...prompt.messages, ...replies.messages],
    });
    return plan?.failedRunId === failedRunId ? plan : null;
  });

  const retryWhenDue = Effect.fn("TransientFailureRetryService.retryWhenDue")(
    function* (threadId: ThreadId, failedRunId: RunId) {
      // Loops once after the wait: the user may have moved on meanwhile.
      while (true) {
        const plan = yield* readPlan(threadId, failedRunId);
        if (plan === null) return;
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        if (nowMs < plan.dueAtMs) {
          yield* Effect.sleep(Duration.millis(plan.dueAtMs - nowMs));
          continue;
        }
        yield* Effect.logInfo("retrying a run that failed transiently", {
          threadId,
          failedRunId,
          attempt: plan.attempt,
          code: plan.failure.code,
        });
        yield* orchestrator.dispatch(plan.command);
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("transient failure retry skipped", { threadId, cause }),
        ),
      ),
  );

  // The failure held any queued messages; a retry that got through releases them.
  const resumeHeldQueue = Effect.fn("TransientFailureRetryService.resumeHeldQueue")(
    function* (threadId: ThreadId, retry: OrchestrationV2Run) {
      const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
      if (!runs.some((run) => run.status === "queued" && run.queueHeld === true)) return;
      yield* orchestrator.dispatch({
        type: "queue.resume",
        commandId: CommandId.make(`server:transient-retry-resume:${threadId}:${retry.id}`),
        threadId,
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("transient failure queue resume skipped", { threadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("TransientFailureRetryService.start")(function* () {
    // Keyed by thread: a newer failure replaces the waiting retry.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (event.type !== "run.updated") return Effect.void;
        const run = event.payload;
        if (run.status === "failed")
          return FiberMap.run(timers, event.threadId, retryWhenDue(event.threadId, run.id));
        return run.status === "completed" &&
          transientRetryOf(event.threadId, run.userMessageId) !== null
          ? resumeHeldQueue(event.threadId, run)
          : Effect.void;
      }),
    );
    yield* forkParked(
      Effect.gen(function* () {
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const shell = yield* projections.getShellSnapshot({ location: "active" });
        for (const thread of shell.threads) {
          if (
            thread.status !== "failed" ||
            !thread.latestRunId ||
            !thread.latestRunCompletedAt ||
            nowMs - DateTime.toEpochMillis(thread.latestRunCompletedAt) > RESTART_PICKUP_WINDOW_MS
          )
            continue;
          yield* FiberMap.run(timers, thread.id, retryWhenDue(thread.id, thread.latestRunId), {
            onlyIfMissing: true,
          });
        }
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("transient failure retry pickup skipped", { cause }),
        ),
      ),
    );
  });
  return { start };
});
