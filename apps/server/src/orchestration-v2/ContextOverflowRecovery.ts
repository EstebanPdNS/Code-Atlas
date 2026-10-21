import {
  MessageId,
  RunId,
  type OrchestrationV2ProviderFailure,
  type ThreadId,
} from "@t3tools/contracts";

/** Turn start refuses a turn this code when native compaction should run first. */
export const CONTEXT_WINDOW_FULL_CODE = "context_window_full";

// Codex reports contextWindowExceeded and Claude prompt_too_long. Claude also ends
// with blocking_limit (or an API 400) for a full window; with rate-limit evidence
// its message names the limit instead of the context window, so it is excluded.
export function isContextOverflowFailure(failure: OrchestrationV2ProviderFailure | null): boolean {
  if (failure?.class !== "provider_error") return false;
  return (
    failure.code === CONTEXT_WINDOW_FULL_CODE ||
    failure.code === "prompt_too_long" ||
    failure.code === "contextWindowExceeded" ||
    ((failure.code === "blocking_limit" || failure.code === "api_error_400") &&
      failure.message.includes("exceeds the model's context window"))
  );
}

// Message ids carry the failed run, so each recovery step finds its origin after
// a restart, and deterministic ids make every step happen at most once.
const compactionPrefix = (threadId: ThreadId) => `context-overflow-compact:${threadId}:`;
const resendPrefix = (threadId: ThreadId) => `context-overflow-retry:${threadId}:`;

export const overflowCompactionMessageId = (threadId: ThreadId, failedRunId: RunId) =>
  MessageId.make(`${compactionPrefix(threadId)}${failedRunId}`);

export const overflowResendMessageId = (threadId: ThreadId, failedRunId: RunId) =>
  MessageId.make(`${resendPrefix(threadId)}${failedRunId}`);

function failedRunOf(messageId: string, prefix: string): RunId | null {
  return messageId.startsWith(prefix) ? RunId.make(messageId.slice(prefix.length)) : null;
}

/** The failed run an automatic compaction message recovers, if it is one. */
export const overflowCompactionFor = (threadId: ThreadId, messageId: string) =>
  failedRunOf(messageId, compactionPrefix(threadId));

/** The failed run an automatic resend recovers, if it is one. */
export const overflowResendFor = (threadId: ThreadId, messageId: string) =>
  failedRunOf(messageId, resendPrefix(threadId));
