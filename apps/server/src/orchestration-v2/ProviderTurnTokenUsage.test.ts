import {
  NodeId,
  type OrchestrationV2ProviderTurn,
  ProviderThreadId,
  ProviderTurnId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { upsertProviderTurn } from "./ProjectionStore.ts";

describe("provider turn token usage projection", () => {
  it("keeps live usage when a terminal update omits it", () => {
    const now = DateTime.makeUnsafe("2026-08-29T00:00:00.000Z");
    const running = {
      id: ProviderTurnId.make("provider-turn-usage"),
      providerThreadId: ProviderThreadId.make("provider-thread-usage"),
      nodeId: NodeId.make("node-usage"),
      runAttemptId: null,
      nativeTurnRef: null,
      ordinal: 1,
      status: "running",
      startedAt: now,
      completedAt: null,
      tokenUsage: {
        usedTokens: 50_000,
        maxTokens: 200_000,
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
    } satisfies OrchestrationV2ProviderTurn;
    const completed = {
      ...running,
      status: "completed",
      completedAt: now,
      tokenUsage: undefined,
    } satisfies OrchestrationV2ProviderTurn;

    const projected = upsertProviderTurn([running], completed);

    assert.deepEqual(projected[0]?.tokenUsage, running.tokenUsage);
    assert.equal(projected[0]?.status, "completed");
  });

  // Code Atlas: Claude sends its context breakdown only when it changes.
  it("keeps the context breakdown until an update replaces or clears it", () => {
    const now = DateTime.makeUnsafe("2026-08-29T00:00:00.000Z");
    const usage = { usedTokens: 10, maxTokens: 200_000, updatedAt: "2026-08-29T00:00:00.000Z" };
    const withBreakdown = {
      id: ProviderTurnId.make("provider-turn-breakdown"),
      providerThreadId: ProviderThreadId.make("provider-thread-breakdown"),
      nodeId: NodeId.make("node-breakdown"),
      runAttemptId: null,
      nativeTurnRef: null,
      ordinal: 1,
      status: "running",
      startedAt: now,
      completedAt: null,
      tokenUsage: {
        ...usage,
        contextCategories: [{ name: "Messages", tokens: 10, kind: "used" }],
        contextMemoryFiles: [{ path: "/w/CLAUDE.md", tokens: 4 }],
        contextSkills: [{ name: "notes", tokens: 3 }],
        contextBreakdownTotalTokens: 10,
        contextEstimated: true,
      },
    } satisfies OrchestrationV2ProviderTurn;

    const kept = upsertProviderTurn([withBreakdown], {
      ...withBreakdown,
      tokenUsage: { ...usage, usedTokens: 20 },
    })[0]?.tokenUsage;
    assert.equal(kept?.usedTokens, 20);
    assert.deepEqual(kept?.contextCategories, withBreakdown.tokenUsage.contextCategories);
    assert.deepEqual(kept?.contextMemoryFiles, withBreakdown.tokenUsage.contextMemoryFiles);
    assert.deepEqual(kept?.contextSkills, withBreakdown.tokenUsage.contextSkills);
    assert.equal(kept?.contextBreakdownTotalTokens, 10);
    assert.isTrue(kept?.contextEstimated);

    const cleared = upsertProviderTurn([withBreakdown], {
      ...withBreakdown,
      tokenUsage: { ...usage, contextCategories: [] },
    })[0]?.tokenUsage;
    assert.deepEqual(cleared?.contextCategories, []);
    assert.isUndefined(cleared?.contextMemoryFiles);
    assert.isUndefined(cleared?.contextSkills);
    assert.isUndefined(cleared?.contextBreakdownTotalTokens);
    assert.isUndefined(cleared?.contextEstimated);
  });
});
