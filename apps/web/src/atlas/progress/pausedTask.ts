import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

interface PausedTaskRun {
  readonly id: RunId;
  readonly status: string;
  readonly queueHeld?: boolean | undefined;
}

export function heldQueuedRunIds(runs: ReadonlyArray<PausedTaskRun>): RunId[] {
  return runs
    .filter((run) => run.status === "queued" && run.queueHeld === true)
    .map((run) => run.id);
}

/**
 * Identifies one pause: the interrupted run and the held queue it left behind.
 * A later pause on the same thread has different ids, so a Stop never hides it.
 */
export function pausedTaskKey(input: {
  readonly threadKey: string | null;
  readonly resumableRunId: RunId | null;
  readonly heldRunIds: ReadonlyArray<RunId>;
}): string | null {
  if (input.resumableRunId === null && input.heldRunIds.length === 0) return null;
  return [input.threadKey ?? "", input.resumableRunId ?? "", ...input.heldRunIds].join(":");
}

/**
 * Code Atlas: Stop on a paused task ends it. The held queued runs are cancelled
 * on the server; the interrupted run already ended, so it only loses Resume.
 */
export function useAtlasPausedTask(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly threadKey: string | null;
  readonly resumableRunId: RunId | null;
  readonly runs: ReadonlyArray<PausedTaskRun>;
}) {
  const cancelQueuedRun = useOrchestrationCommand(threadEnvironment.cancelQueuedRun);
  const heldRunIds = heldQueuedRunIds(input.runs);
  const key = pausedTaskKey({
    threadKey: input.threadKey,
    resumableRunId: input.resumableRunId,
    heldRunIds,
  });
  const [stoppedKey, setStoppedKey] = useState<string | null>(null);
  const stop = () => {
    setStoppedKey(key);
    const { threadId } = input;
    if (threadId === null) return;
    for (const runId of heldRunIds) {
      void cancelQueuedRun({ environmentId: input.environmentId, input: { threadId, runId } });
    }
  };
  return { canResume: key !== null && key !== stoppedKey, stop };
}
