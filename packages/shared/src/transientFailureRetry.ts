import {
  CommandId,
  MessageId,
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  RunId,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { latestExecutedRun, latestRootProviderFailure } from "./orchestrationV2ThreadError.ts";

/**
 * Code Atlas: a run that failed because the provider was briefly unavailable
 * (model at capacity, overloaded, 5xx, a dropped connection) is retried by the
 * server every 10 seconds until it works. The server and the client derive the
 * same plan from the projection, so the countdown the timeline shows and the
 * retry the server sends cannot disagree, and "Retry now" sends the very
 * command the server would have sent.
 */
export const TRANSIENT_RETRY_DELAY_MS = 10_000;

export const TRANSIENT_RETRY_CONTINUE_TEXT = "Continue where you left off.";

// Codex `codexErrorInfo` variants and Claude API statuses that mean "try again".
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "serverOverloaded",
  "internalServerError",
  "flexUnavailable",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "overloaded_error",
  "api_error_500",
  "api_error_502",
  "api_error_503",
  "api_error_504",
  "api_error_529",
]);

// Failures a retry cannot fix: credentials, configuration, policy, budgets, and
// a full context window (which ContextOverflowRecoveryService compacts).
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  "unauthorized",
  "badRequest",
  "cyberPolicy",
  "misalignmentPolicyViolation",
  "sessionBudgetExceeded",
  "usageLimitExceeded",
  "tooManyDenials",
  "sandboxError",
  "threadRollbackFailed",
  "contextWindowExceeded",
  "context_window_full",
  "prompt_too_long",
  "authentication_failed",
  "billing_error",
  "api_error_400",
  "api_error_401",
  "api_error_403",
  "api_error_404",
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
]);

const TRANSIENT_MESSAGE =
  /at capacity|overloaded|server_overloaded|\b(?:500|502|503|504|529)\b|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|internal server error|please try again|try again (?:shortly|in a (?:moment|few))|rate[ _]limit|too many requests|network error|connection (?:reset|refused|closed|error|lost)|socket hang up|econnreset|econnrefused|etimedout|stream disconnected/i;

const PERMANENT_MESSAGE =
  /unauthori[sz]ed|authenticat|api key|not logged in|log ?in again|forbidden|permission denied|billing|credit balance|quota|usage limit|hit your limit|context window|prompt is too long/i;

// A rate limit with no reset time is a short throttle, not the plan's usage
// cap; a cap carries its reset time and UsageLimitRecoveryWorker resumes it.
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set(["rateLimitExceeded", "api_error_429"]);

export function isTransientProviderFailure(
  failure: OrchestrationV2ProviderFailure | null,
): boolean {
  if (failure === null) return false;
  if (failure.code !== null && PERMANENT_CODES.has(failure.code)) return false;
  if (PERMANENT_MESSAGE.test(failure.message)) return false;
  switch (failure.class) {
    case "usage_limit":
      return failure.resetAt == null && failure.code !== null && RATE_LIMIT_CODES.has(failure.code);
    case "permission_error":
    case "validation_error":
      return false;
    case "transport_error":
      return true;
    case "provider_error":
    case "unknown":
      return (
        (failure.code !== null && TRANSIENT_CODES.has(failure.code)) ||
        TRANSIENT_MESSAGE.test(failure.message)
      );
  }
}

// Retry ids carry the run the chain started from and the attempt number, so
// each attempt is sent at most once and the next failure knows its place.
const TRANSIENT_RETRY_ID_PREFIX = "transient-retry:";
const retryPrefix = (threadId: ThreadId) => `${TRANSIENT_RETRY_ID_PREFIX}${threadId}:`;

/** Every retry of the failure of `originRunId` shares this chain key. */
export const transientRetryChain = (threadId: ThreadId, originRunId: RunId) =>
  `${retryPrefix(threadId)}${originRunId}`;

export const transientRetryMessageId = (threadId: ThreadId, originRunId: RunId, attempt: number) =>
  MessageId.make(`${transientRetryChain(threadId, originRunId)}:${attempt}`);

export const isTransientRetryMessageId = (messageId: string) =>
  messageId.startsWith(TRANSIENT_RETRY_ID_PREFIX);

/** The chain and attempt of a retry message, read without knowing its thread. */
export function transientRetryAttemptOf(
  messageId: string,
): { readonly chain: string; readonly attempt: number } | null {
  if (!isTransientRetryMessageId(messageId)) return null;
  const separator = messageId.lastIndexOf(":");
  const attempt = Number(messageId.slice(separator + 1));
  if (
    separator <= TRANSIENT_RETRY_ID_PREFIX.length ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    return null;
  return { chain: messageId.slice(0, separator), attempt };
}

export function transientRetryOf(
  threadId: ThreadId,
  messageId: string,
): { readonly originRunId: RunId; readonly attempt: number } | null {
  const prefix = retryPrefix(threadId);
  const retry = messageId.startsWith(prefix) ? transientRetryAttemptOf(messageId) : null;
  if (retry === null || retry.chain.length <= prefix.length) return null;
  return { originRunId: RunId.make(retry.chain.slice(prefix.length)), attempt: retry.attempt };
}

export type TransientRetryInput = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "messages" | "turnItems" | "providerThreads" | "runtimeRequests"
>;

export interface TransientRetryPlan {
  readonly failedRunId: RunId;
  readonly failure: OrchestrationV2ProviderFailure;
  readonly attempt: number;
  readonly dueAtMs: number;
  /** A Codex goal resumes, a run that did work continues, an unanswered one is resent. */
  readonly kind: "goal" | "continue" | "resend";
  readonly command: Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
}

export function planTransientRetry(input: TransientRetryInput): TransientRetryPlan | null {
  const { thread } = input;
  if (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride === "settled" ||
    // A subagent reports to its parent, which owns retrying the delegated work.
    thread.lineage.relationshipToParent === "subagent"
  )
    return null;
  const run = latestExecutedRun(input.runs);
  if (run?.status !== "failed") return null;
  if (
    // A queue that runs on its own, or a question waiting for the user, comes first.
    input.runs.some((candidate) => candidate.status === "queued" && candidate.queueHeld !== true) ||
    input.runtimeRequests.some((request) => request.status === "pending") ||
    // Stop on the failed thread records that it reached this run.
    input.turnItems.some((item) => item.type === "run_interrupt_request" && item.runId === run.id)
  )
    return null;
  const failure = latestRootProviderFailure(run, input.turnItems);
  if (failure === null || !isTransientProviderFailure(failure)) return null;

  const chain = transientRetryOf(thread.id, run.userMessageId);
  const attempt = (chain?.attempt ?? 0) + 1;
  const messageId = transientRetryMessageId(thread.id, chain?.originRunId ?? run.id, attempt);
  const message = input.messages.find((candidate) => candidate.id === run.userMessageId);
  const goal =
    input.providerThreads.find(
      (candidate) => candidate.id === (run.providerThreadId ?? thread.activeProviderThreadId),
    ) ?? null;
  const worked = input.messages.some(
    (candidate) => candidate.role === "assistant" && candidate.runId === run.id,
  );
  const kind: TransientRetryPlan["kind"] =
    goal?.driver === "codex" && (goal.goal?.status === "active" || goal.goal?.status === "blocked")
      ? "goal"
      : worked || message === undefined
        ? "continue"
        : "resend";
  const content =
    kind === "resend" && message !== undefined
      ? {
          text: message.text,
          attachments: message.attachments,
          ...(message.context === undefined ? {} : { context: message.context }),
        }
      : { text: kind === "goal" ? "/goal resume" : TRANSIENT_RETRY_CONTINUE_TEXT, attachments: [] };
  const failedAtMs = DateTime.toEpochMillis(run.completedAt ?? run.requestedAt);
  return {
    failedRunId: run.id,
    failure,
    attempt,
    dueAtMs: failedAtMs + TRANSIENT_RETRY_DELAY_MS,
    kind,
    command: {
      type: "message.dispatch",
      commandId: CommandId.make(`server:${messageId}`),
      messageId,
      threadId: thread.id,
      ...content,
      // The user's own work, resumed for them, as a usage-limit resume is.
      createdBy: "user",
      creationSource: "server",
      dispatchMode: { type: "start_immediately" },
    },
  };
}
