import { CommandId, type OrchestrationV2Run, type RunId, type ThreadId } from "@t3tools/contracts";
import { latestRootProviderFailure } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import {
  isContextOverflowFailure,
  overflowCompactionFor,
  overflowCompactionMessageId,
  overflowResendFor,
  overflowResendMessageId,
} from "./ContextOverflowRecovery.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

function isLatestExecutedRun(runs: ReadonlyArray<OrchestrationV2Run>, run: OrchestrationV2Run) {
  return !runs.some(
    (candidate) => candidate.status !== "queued" && candidate.ordinal > run.ordinal,
  );
}

/**
 * When a turn is refused because the thread's context window is full, compacts
 * the thread natively with `/compact`, resends the refused message once
 * compaction completes, and then resumes any queue that failure held. A resend
 * that overflows again is not recovered, so recovery never loops; turn start
 * replaces the native thread for it instead.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const compactAfterOverflow = Effect.fn("ContextOverflowRecoveryService.compactAfterOverflow")(
    function* (threadId: ThreadId, runId: RunId) {
      const records = yield* projections.getThreadRecords(threadId, ["runs", "messages"], {
        messageRoles: ["user"],
      });
      const run = records.runs.find((candidate) => candidate.id === runId);
      const message = records.messages.find((candidate) => candidate.id === run?.userMessageId);
      if (
        run?.status !== "failed" ||
        message === undefined ||
        records.thread.archivedAt !== null ||
        records.thread.deletedAt !== null ||
        !isLatestExecutedRun(records.runs, run) ||
        // Compacting cannot shrink a compaction, and a resend already had its recovery.
        (message.attachments.length === 0 && message.text.trim().toLowerCase() === "/compact") ||
        overflowCompactionFor(threadId, message.id) !== null ||
        overflowResendFor(threadId, message.id) !== null
      )
        return;
      const { turnItems } = yield* projections.getThreadRecords(threadId, ["turnItems"], {
        turnItemTypes: ["error"],
        turnItemRunId: run.id,
      });
      if (!isContextOverflowFailure(latestRootProviderFailure(run, turnItems))) return;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:context-overflow-compact:${threadId}:${runId}`),
        messageId: overflowCompactionMessageId(threadId, runId),
        threadId,
        text: "/compact",
        attachments: [],
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
  );

  const resendAfterCompaction = Effect.fn("ContextOverflowRecoveryService.resendAfterCompaction")(
    function* (threadId: ThreadId, compaction: OrchestrationV2Run, failedRunId: RunId) {
      const records = yield* projections.getThreadRecords(threadId, ["runs", "messages"], {
        messageRoles: ["user"],
      });
      const failedRun = records.runs.find((candidate) => candidate.id === failedRunId);
      const message = records.messages.find(
        (candidate) => candidate.id === failedRun?.userMessageId,
      );
      // The user moved on (sent, stopped, or archived) while the thread compacted.
      if (
        failedRun === undefined ||
        message === undefined ||
        records.thread.archivedAt !== null ||
        records.thread.deletedAt !== null ||
        !isLatestExecutedRun(records.runs, compaction)
      )
        return;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:context-overflow-retry:${threadId}:${failedRunId}`),
        messageId: overflowResendMessageId(threadId, failedRunId),
        threadId,
        text: message.text,
        attachments: message.attachments,
        ...(message.context === undefined ? {} : { context: message.context }),
        modelSelection: failedRun.modelSelection,
        // The user's own words, resent by the server, as a usage-limit resume is.
        createdBy: "user",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
  );

  const resumeHeldQueue = Effect.fn("ContextOverflowRecoveryService.resumeHeldQueue")(function* (
    threadId: ThreadId,
    failedRunId: RunId,
  ) {
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    if (!runs.some((run) => run.status === "queued" && run.queueHeld === true)) return;
    yield* orchestrator.dispatch({
      type: "queue.resume",
      commandId: CommandId.make(`server:context-overflow-resume:${threadId}:${failedRunId}`),
      threadId,
    });
  });

  const react = Effect.fn("ContextOverflowRecoveryService.react")(
    function* (threadId: ThreadId, run: OrchestrationV2Run) {
      if (run.status === "failed") return yield* compactAfterOverflow(threadId, run.id);
      if (run.status !== "completed") return;
      const compactedFor = overflowCompactionFor(threadId, run.userMessageId);
      if (compactedFor !== null) return yield* resendAfterCompaction(threadId, run, compactedFor);
      const resentFor = overflowResendFor(threadId, run.userMessageId);
      if (resentFor !== null) yield* resumeHeldQueue(threadId, resentFor);
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("context overflow recovery skipped", { threadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("ContextOverflowRecoveryService.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" ? react(event.threadId, event.payload) : Effect.void,
      ),
    );
  });
  return { start };
});
