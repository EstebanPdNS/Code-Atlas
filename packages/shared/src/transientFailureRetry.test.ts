import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  TRANSIENT_RETRY_CONTINUE_TEXT,
  TRANSIENT_RETRY_DELAY_MS,
  isTransientProviderFailure,
  planTransientRetry,
  transientRetryAttemptOf,
  transientRetryChain,
  transientRetryMessageId,
  transientRetryOf,
  type TransientRetryInput,
} from "./transientFailureRetry.ts";

const failure = (
  overrides: Partial<OrchestrationV2ProviderFailure> = {},
): OrchestrationV2ProviderFailure => ({
  class: "provider_error",
  message: "Selected model is at capacity. Please try a different model.",
  code: null,
  retryable: null,
  ...overrides,
});

describe("isTransientProviderFailure", () => {
  it("retries capacity, overload, 5xx and dropped connections", () => {
    expect(isTransientProviderFailure(failure())).toBe(true);
    expect(
      isTransientProviderFailure(failure({ code: "serverOverloaded", message: "Busy." })),
    ).toBe(true);
    expect(
      isTransientProviderFailure(
        failure({ code: "api_error_529", message: "Claude API is overloaded (529)." }),
      ),
    ).toBe(true);
    expect(
      isTransientProviderFailure(failure({ message: "API Error: 503 Service Unavailable" })),
    ).toBe(true);
    expect(
      isTransientProviderFailure(
        failure({ class: "transport_error", code: "responseStreamDisconnected", message: "x" }),
      ),
    ).toBe(true);
    expect(
      isTransientProviderFailure(failure({ class: "transport_error", message: "Gone." })),
    ).toBe(true);
    expect(
      isTransientProviderFailure(failure({ class: "unknown", message: "Please try again." })),
    ).toBe(true);
  });

  it("retries a throttle but leaves usage caps to the usage-limit resume", () => {
    expect(
      isTransientProviderFailure(
        failure({ class: "usage_limit", code: "rateLimitExceeded", message: "Rate limited." }),
      ),
    ).toBe(true);
    expect(
      isTransientProviderFailure(
        failure({
          class: "usage_limit",
          code: "api_error_429",
          message: "Claude API rate limit reached.",
          resetAt: "2026-10-21T12:00:00.000Z",
        }),
      ),
    ).toBe(false);
    expect(
      isTransientProviderFailure(
        failure({ class: "usage_limit", code: "usageLimitExceeded", message: "Limit." }),
      ),
    ).toBe(false);
    expect(
      isTransientProviderFailure(
        failure({ class: "usage_limit", code: "rateLimitExceeded", message: "Usage limit hit." }),
      ),
    ).toBe(false);
  });

  it("never retries auth, configuration, policy or full-context failures", () => {
    expect(isTransientProviderFailure(null)).toBe(false);
    expect(isTransientProviderFailure(failure({ code: "unauthorized", message: "No." }))).toBe(
      false,
    );
    expect(
      isTransientProviderFailure(
        failure({ class: "transport_error", message: "Invalid API key. Please try again." }),
      ),
    ).toBe(false);
    expect(
      isTransientProviderFailure(failure({ class: "permission_error", message: "Overloaded." })),
    ).toBe(false);
    expect(
      isTransientProviderFailure(
        failure({ code: "contextWindowExceeded", message: "Please try again." }),
      ),
    ).toBe(false);
    expect(isTransientProviderFailure(failure({ message: "The model returned an error." }))).toBe(
      false,
    );
  });
});

const threadId = ThreadId.make("thread:with:colons");
const at = DateTime.makeUnsafe("2026-10-21T06:08:00.000Z");
const instanceId = ProviderInstanceId.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread");
const modelSelection = { instanceId, model: "gpt-6.1" };

const run = (
  ordinal: number,
  userMessageId: MessageId,
  overrides: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run => ({
  id: RunId.make(`run:${ordinal}`),
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

const message = (
  id: MessageId,
  runId: RunId,
  role: "user" | "assistant",
  text: string,
): OrchestrationV2ConversationMessage => ({
  id,
  threadId,
  runId,
  nodeId: null,
  role,
  text,
  attachments: [],
  streaming: false,
  createdBy: role === "user" ? "user" : "agent",
  creationSource: role === "user" ? "web" : "provider",
  createdAt: at,
  updatedAt: at,
});

const errorItem = (
  failed: OrchestrationV2Run,
  value: OrchestrationV2ProviderFailure = failure(),
): OrchestrationV2TurnItem => ({
  id: TurnItemId.make(`error-${failed.id}`),
  threadId,
  runId: failed.id,
  nodeId: failed.rootNodeId,
  providerThreadId,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: failed.ordinal * 100,
  status: "failed",
  title: "Provider error",
  startedAt: at,
  completedAt: at,
  updatedAt: at,
  type: "error",
  failure: value,
});

function input(overrides: Partial<TransientRetryInput> = {}): TransientRetryInput {
  const first = run(1, MessageId.make("message-1"));
  return {
    thread: {
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
    runs: [first],
    messages: [message(first.userMessageId, first.id, "user", "Link the recovered code")],
    turnItems: [errorItem(first)],
    providerThreads: [],
    runtimeRequests: [],
    ...overrides,
  };
}

describe("planTransientRetry", () => {
  it("resends an unanswered message ten seconds after the failure", () => {
    const plan = planTransientRetry(input());
    expect(plan).toMatchObject({
      failedRunId: RunId.make("run:1"),
      attempt: 1,
      kind: "resend",
      dueAtMs: DateTime.toEpochMillis(at) + TRANSIENT_RETRY_DELAY_MS,
      command: {
        type: "message.dispatch",
        messageId: transientRetryMessageId(threadId, RunId.make("run:1"), 1),
        text: "Link the recovered code",
        createdBy: "user",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      },
    });
    expect(plan?.command.commandId).toBe(`server:${plan?.command.messageId}`);
  });

  it("continues a run that did work and counts attempts along the chain", () => {
    const origin = RunId.make("run:1");
    const retry = run(2, transientRetryMessageId(threadId, origin, 3));
    const plan = planTransientRetry(
      input({
        runs: [run(1, MessageId.make("message-1")), retry],
        messages: [
          message(retry.userMessageId, retry.id, "user", "Link the recovered code"),
          message(MessageId.make("assistant-2"), retry.id, "assistant", "Working on it"),
        ],
        turnItems: [errorItem(retry)],
      }),
    );
    expect(plan).toMatchObject({
      failedRunId: retry.id,
      attempt: 4,
      kind: "continue",
      command: {
        messageId: transientRetryMessageId(threadId, origin, 4),
        text: TRANSIENT_RETRY_CONTINUE_TEXT,
        attachments: [],
      },
    });
  });

  it("resumes an active Codex goal instead of resending text", () => {
    const goalThread = {
      id: providerThreadId,
      driver: ProviderDriverKind.make("codex"),
      goal: { objective: "Finish the port", status: "active" },
    } as OrchestrationV2ProviderThread;
    expect(planTransientRetry(input({ providerThreads: [goalThread] }))).toMatchObject({
      kind: "goal",
      command: { text: "/goal resume" },
    });
  });

  it("stops once the user moves on, stops, or the thread is put away", () => {
    const base = input();
    const failed = base.runs[0]!;
    const next = run(2, MessageId.make("message-2"), { status: "running", completedAt: null });
    expect(planTransientRetry({ ...base, runs: [failed, next] })).toBeNull();
    expect(
      planTransientRetry({
        ...base,
        turnItems: [
          ...base.turnItems,
          {
            ...errorItem(failed),
            id: TurnItemId.make("stop"),
            type: "run_interrupt_request",
            status: "completed",
            message: "Stop requested",
          } as OrchestrationV2TurnItem,
        ],
      }),
    ).toBeNull();
    expect(planTransientRetry({ ...base, thread: { ...base.thread, archivedAt: at } })).toBeNull();
    expect(
      planTransientRetry({
        ...base,
        runtimeRequests: [{ status: "pending" } as OrchestrationV2RuntimeRequest],
      }),
    ).toBeNull();
    expect(
      planTransientRetry({
        ...base,
        turnItems: [errorItem(failed, failure({ code: "unauthorized", message: "No." }))],
      }),
    ).toBeNull();
    expect(planTransientRetry({ ...base, runs: [{ ...failed, status: "completed" }] })).toBeNull();
  });

  it("reads retry ids back, even when ids contain colons", () => {
    const origin = RunId.make("run:with:colons");
    expect(transientRetryOf(threadId, transientRetryMessageId(threadId, origin, 12))).toEqual({
      originRunId: origin,
      attempt: 12,
    });
    expect(transientRetryOf(threadId, "message-1")).toBeNull();
    expect(transientRetryOf(threadId, `transient-retry:${threadId}:run:0`)).toBeNull();
    expect(transientRetryAttemptOf(transientRetryMessageId(threadId, origin, 12))).toEqual({
      chain: transientRetryChain(threadId, origin),
      attempt: 12,
    });
    expect(transientRetryAttemptOf("message-1")).toBeNull();
  });
});
