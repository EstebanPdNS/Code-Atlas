import type { OrchestrationV2AppThread, RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { TransientRetryPlan } from "@t3tools/shared/transientFailureRetry";
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useNowSecond } from "~/hooks/useNowSecond";
import { useThreadProjection } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { transientRetryForRow, transientRetryLabel } from "./transientRetry";

function AtlasTransientRetryCountdown(props: {
  readonly threadRef: ScopedThreadRef;
  readonly thread: OrchestrationV2AppThread;
  readonly plan: TransientRetryPlan;
}) {
  const { threadRef, thread, plan } = props;
  const nowMs = useNowSecond();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn);
  const stop = useOrchestrationCommand(threadEnvironment.interruptTurn);
  // Keyed by attempt, so the buttons come back for the next attempt.
  const [sentAttempt, setSentAttempt] = useState<number | null>(null);
  const busy = sentAttempt === plan.attempt;
  const { command } = plan;
  // The server's planned attempt under its own command id: whichever lands
  // first wins and the other is the same receipt, so nothing is sent twice.
  const retryNow = () => {
    setSentAttempt(plan.attempt);
    void startTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        commandId: command.commandId,
        creationSource: command.creationSource,
        message: {
          messageId: command.messageId,
          role: "user",
          text: command.text,
          attachments: command.attachments,
          ...(command.context === undefined ? {} : { context: command.context }),
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "start",
      },
    });
  };
  // Stop on an idle thread marks the failed run stopped, which ends the retries.
  const stopRetrying = () => {
    setSentAttempt(plan.attempt);
    void stop({ environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } });
  };
  return (
    <div data-atlas-rise className="ms-7 flex flex-wrap items-center gap-2 pb-1">
      <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
        {transientRetryLabel(plan, nowMs)}
      </span>
      <Button type="button" size="xs" variant="outline" disabled={busy} onClick={retryNow}>
        <RotateCcwIcon aria-hidden />
        Retry now
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={stopRetrying}>
        Stop
      </Button>
    </div>
  );
}

/**
 * Code Atlas: under a run that failed because the provider was briefly
 * unavailable, the server's next retry as a countdown, with Retry now. The
 * server retries on its own, so this only shows and hastens it.
 */
export function AtlasTransientRetry(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly runId: RunId | null;
}) {
  const detail = useThreadProjection(props.threadRef);
  const projection = detail?.projection ?? null;
  const plan = transientRetryForRow(projection, props.runId);
  if (props.threadRef === null || projection === null || plan === null) return null;
  return (
    <AtlasTransientRetryCountdown
      threadRef={props.threadRef}
      thread={projection.thread}
      plan={plan}
    />
  );
}
