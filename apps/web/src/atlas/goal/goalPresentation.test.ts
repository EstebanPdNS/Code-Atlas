import type { OrchestrationV2ProviderGoal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  atlasGoalClearSteps,
  atlasGoalSavePlan,
  atlasGoalToggleSteps,
  formatGoalElapsed,
  formatGoalTokens,
  presentAtlasGoal,
} from "./goalPresentation";

const goal = (overrides: Partial<OrchestrationV2ProviderGoal> = {}): OrchestrationV2ProviderGoal =>
  ({
    objective: "Ship the release",
    status: "active",
    tokensUsed: 254_000,
    tokenBudget: null,
    timeUsedSeconds: 1_415,
    ...overrides,
  }) as OrchestrationV2ProviderGoal;

describe("goal usage formats", () => {
  it("counts tokens like Codex", () => {
    expect(formatGoalTokens(950)).toBe("950");
    expect(formatGoalTokens(9_850)).toBe("9.85K");
    expect(formatGoalTokens(63_876)).toBe("63.9K");
    expect(formatGoalTokens(50_000)).toBe("50K");
    expect(formatGoalTokens(254_000)).toBe("254K");
    expect(formatGoalTokens(1_200_000)).toBe("1.2M");
  });

  it("shows time like Codex", () => {
    expect(formatGoalElapsed(59)).toBe("59s");
    expect(formatGoalElapsed(1_415)).toBe("23m");
    expect(formatGoalElapsed(90 * 60)).toBe("1h 30m");
    expect(formatGoalElapsed(2 * 3_600)).toBe("2h");
    expect(formatGoalElapsed(2 * 86_400 + 23 * 3_600 + 42 * 60)).toBe("2d 23h 42m");
  });
});

describe("presentAtlasGoal", () => {
  it("reads like the Codex status line while pursuing the goal", () => {
    const presentation = presentAtlasGoal(goal(), { working: true, provider: "codex" });
    expect(presentation.status).toBe("Pursuing goal · 254K tokens · 23m");
    expect(presentation.toggle).toBe("pause");
  });

  it("offers Resume for an idle active goal and for every resumable stop", () => {
    expect(presentAtlasGoal(goal(), { working: false, provider: "codex" })).toMatchObject({
      title: "Goal active",
      toggle: "resume",
    });
    for (const [status, title] of [
      ["paused", "Goal paused"],
      ["blocked", "Goal stalled"],
      ["usage_limited", "Goal hit usage limits"],
    ] as const) {
      expect(
        presentAtlasGoal(goal({ status }), { working: false, provider: "codex" }),
      ).toMatchObject({ title, toggle: "resume" });
    }
  });

  it("ends a finished goal without a toggle", () => {
    expect(
      presentAtlasGoal(goal({ status: "complete" }), { working: false, provider: "codex" }),
    ).toMatchObject({ title: "Goal achieved", toggle: null });
    expect(
      presentAtlasGoal(
        goal({ status: "budget_limited", tokensUsed: 63_876, tokenBudget: 50_000 }),
        {
          working: false,
          provider: "codex",
        },
      ),
    ).toMatchObject({ title: "Goal unmet", usage: "63.9K / 50K tokens · 23m", toggle: null });
  });

  it("gives Claude goals no pause and clears them only between turns", () => {
    const claude = goal({ tokensUsed: undefined, timeUsedSeconds: undefined, checks: 2 });
    expect(presentAtlasGoal(claude, { working: true, provider: "claude" })).toMatchObject({
      status: "Pursuing goal · 2 checks",
      toggle: null,
      canClear: false,
    });
    expect(presentAtlasGoal(claude, { working: false, provider: "claude" }).canClear).toBe(true);
  });
});

describe("goal controls", () => {
  it("pauses natively and resumes an idle goal with a turn that owns it", () => {
    expect(atlasGoalToggleSteps("pause", { working: true })).toEqual([
      { type: "update", action: { type: "pause" } },
    ]);
    expect(atlasGoalToggleSteps("resume", { working: true })).toEqual([
      { type: "update", action: { type: "resume" } },
    ]);
    expect(atlasGoalToggleSteps("resume", { working: false })).toEqual([
      { type: "command", text: "/goal resume" },
    ]);
  });

  it("clears Codex goals natively and Claude goals with /goal clear", () => {
    expect(atlasGoalClearSteps("codex")).toEqual([{ type: "update", action: { type: "clear" } }]);
    expect(atlasGoalClearSteps("claude")).toEqual([{ type: "command", text: "/goal clear" }]);
  });
});

describe("atlasGoalSavePlan", () => {
  it("edits a running Codex goal in place", () => {
    expect(
      atlasGoalSavePlan(goal(), "  New objective ", { working: true, provider: "codex" }).steps,
    ).toEqual([{ type: "update", action: { type: "edit", objective: "New objective" } }]);
  });

  it("keeps an idle paused goal paused", () => {
    expect(
      atlasGoalSavePlan(goal({ status: "paused" }), "New", { working: false, provider: "codex" })
        .steps,
    ).toEqual([{ type: "update", action: { type: "edit", objective: "New" } }]);
  });

  it("continues an idle goal that the edit reactivates through a turn", () => {
    expect(
      atlasGoalSavePlan(goal({ status: "complete" }), "New", { working: false, provider: "codex" })
        .steps,
    ).toEqual([
      { type: "update", action: { type: "edit", objective: "New", status: "paused" } },
      { type: "command", text: "/goal resume" },
    ]);
  });

  it("replaces a Claude goal, after the current turn when one is running", () => {
    expect(atlasGoalSavePlan(goal(), "New", { working: false, provider: "claude" }).steps).toEqual([
      { type: "command", text: "/goal New" },
    ]);
    expect(atlasGoalSavePlan(goal(), "New", { working: true, provider: "claude" })).toEqual({
      steps: [{ type: "command", text: "/goal New", queue: true }],
      note: "Claude Code applies the new goal after the current turn.",
    });
  });
});
