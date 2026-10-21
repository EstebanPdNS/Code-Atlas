import type { OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";
import { latestExecutedRun } from "@t3tools/shared/orchestrationV2ThreadError";
import {
  planTransientRetry,
  transientRetryAttemptOf,
  transientRetryChain,
  type TransientRetryPlan,
} from "@t3tools/shared/transientFailureRetry";

import type { TimelineEntry } from "~/session-logic";

/**
 * The server's pending retry for this failed run's error row, if any. Cheap
 * runs check first: older failure rows stay mounted while a thread streams.
 */
export function transientRetryForRow(
  projection: OrchestrationV2ThreadProjection | null,
  runId: RunId | null,
): TransientRetryPlan | null {
  if (projection === null || runId === null) return null;
  if (latestExecutedRun(projection.runs)?.id !== runId) return null;
  const plan = planTransientRetry(projection);
  return plan?.failedRunId === runId ? plan : null;
}

/** "Retrying in 7s", then "Retrying…" while the server sends it. */
export function transientRetryLabel(plan: TransientRetryPlan, nowMs: number): string {
  const seconds = Math.ceil((plan.dueAtMs - nowMs) / 1000);
  const status = seconds > 0 ? `Retrying in ${seconds}s` : "Retrying…";
  return plan.attempt > 1 ? `${status} · attempt ${plan.attempt}` : status;
}

function failedErrorItem(entry: TimelineEntry) {
  const item =
    entry.kind === "event"
      ? entry.projectedItem.item
      : entry.kind === "work"
        ? entry.entry.projectedItem?.item
        : null;
  return item?.type === "error" && item.status === "failed" && item.runId !== null ? item : null;
}

/**
 * A chain of server retries reads as one card: the retry turns the server
 * sent are not shown as user messages, and only the latest attempt's error
 * stays, so a retry that got through leaves no error behind.
 */
export function withoutTransientRetryChains(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<TimelineEntry> {
  const chainByRun = new Map<RunId, string>();
  const latestByChain = new Map<string, { readonly runId: RunId; readonly attempt: number }>();
  for (const entry of entries) {
    if (entry.kind !== "message" || entry.message.runId === null) continue;
    const retry = transientRetryAttemptOf(entry.message.id);
    if (retry === null) continue;
    chainByRun.set(entry.message.runId, retry.chain);
    const latest = latestByChain.get(retry.chain);
    if (latest === undefined || retry.attempt > latest.attempt)
      latestByChain.set(retry.chain, { runId: entry.message.runId, attempt: retry.attempt });
  }
  if (latestByChain.size === 0) return entries;
  return entries.filter((entry) => {
    if (entry.kind === "message") return transientRetryAttemptOf(entry.message.id) === null;
    const error = failedErrorItem(entry);
    if (error === null || error.runId === null) return true;
    const chain = chainByRun.get(error.runId) ?? transientRetryChain(error.threadId, error.runId);
    const latest = latestByChain.get(chain);
    return latest === undefined || latest.runId === error.runId;
  });
}
