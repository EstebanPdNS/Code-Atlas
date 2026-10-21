import { CommandId, type ProviderTurnId, type ThreadId } from "@t3tools/contracts";
import { planCompactionFollowUpSteer } from "@t3tools/shared/compactionFollowUps";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Code Atlas: messages the user sent while the thread compacted wait in the
 * queue, because a compacting turn cannot take steering input. When a native
 * compaction ends inside a running turn, or the first of those messages starts
 * its own turn after `/compact`, this steers the rest into that turn so the
 * agent reads them at once. See `planCompactionFollowUpSteer`.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const deliver = Effect.fn("CompactionFollowUpService.deliver")(
    function* (threadId: ThreadId) {
      const records = yield* projections.getThreadRecords(
        threadId,
        ["runs", "messages", "providerTurns", "providerThreads", "providerSessions"],
        { messageRoles: ["user"] },
      );
      if (!records.runs.some((run) => run.status === "queued")) return;
      const { turnItems } = yield* projections.getThreadRecords(threadId, ["turnItems"], {
        turnItemTypes: ["compaction"],
      });
      const plan = planCompactionFollowUpSteer({
        ...records,
        compactionItems: turnItems.flatMap((item) => (item.type === "compaction" ? [item] : [])),
      });
      if (plan === null) return;
      for (const queuedRunId of plan.queuedRunIds) {
        yield* orchestrator.dispatch({
          type: "queued-message.promote-to-steer",
          // A target that ended first rejects this id; the next turn gets its own.
          commandId: CommandId.make(
            `server:compaction-follow-up:${threadId}:${queuedRunId}:${plan.targetRunId}`,
          ),
          threadId,
          queuedRunId,
          targetRunId: plan.targetRunId,
        });
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("compaction follow-up delivery skipped", { threadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("CompactionFollowUpService.start")(function* () {
    // A provider turn is updated many times while it runs; only its start matters here.
    const startedTurns = new Map<ThreadId, ProviderTurnId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (event.type === "turn-item.updated") {
          return event.payload.type === "compaction" && event.payload.status !== "running"
            ? deliver(event.threadId)
            : Effect.void;
        }
        if (event.type !== "provider-turn.updated" || event.payload.status !== "running") {
          return Effect.void;
        }
        if (startedTurns.get(event.threadId) === event.payload.id) return Effect.void;
        startedTurns.set(event.threadId, event.payload.id);
        return deliver(event.threadId);
      }),
    );
  });
  return { start };
});
