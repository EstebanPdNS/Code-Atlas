import { MessageId, type OrchestrationV2ProviderGoal } from "@t3tools/contracts";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  atlasGoalClearSteps,
  atlasGoalCommandRoute,
  atlasGoalElapsedSeconds,
  atlasGoalSavePlan,
  atlasGoalToggleSteps,
  formatGoalElapsed,
  formatGoalTokens,
  parseAtlasGoalCommand,
  presentAtlasGoal,
  stripGoalCommandPrefix,
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

  it("pauses and resumes a Claude goal's task, and clears it any time", () => {
    const claude = goal({ tokensUsed: undefined, timeUsedSeconds: undefined, checks: 2 });
    expect(presentAtlasGoal(claude, { working: true, provider: "claude" })).toMatchObject({
      status: "Pursuing goal · 2 checks",
      toggle: "pause",
      canClear: true,
    });
    expect(presentAtlasGoal(claude, { working: false, provider: "claude" }).toggle).toBeNull();
    expect(
      presentAtlasGoal(claude, { working: false, provider: "claude", taskResumable: true }).toggle,
    ).toBe("resume");
  });

  it("shows the objective without a repeated /goal, and the time apart from the metrics", () => {
    const presentation = presentAtlasGoal(goal({ objective: "/goal Ship it", checks: 1 }), {
      working: true,
      provider: "codex",
    });
    expect(presentation.objective).toBe("Ship it");
    expect(presentation.metrics).toBe("254K tokens · 1 check");
    expect(presentation.usage).toBe("254K tokens · 23m · 1 check");
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

  it("clears Codex goals natively and Claude goals with /goal clear, pausing a running turn", () => {
    expect(atlasGoalClearSteps("codex", { working: true })).toEqual([
      { type: "update", action: { type: "clear" } },
    ]);
    expect(atlasGoalClearSteps("claude", { working: false })).toEqual([
      { type: "command", text: "/goal clear" },
    ]);
    expect(atlasGoalClearSteps("claude", { working: true })).toEqual([
      { type: "command", text: "/goal clear", restart: true },
    ]);
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

  it("replaces a Claude goal, pausing the current turn when one is running", () => {
    expect(
      atlasGoalSavePlan(goal(), "/goal New", { working: false, provider: "claude" }).steps,
    ).toEqual([{ type: "command", text: "/goal New" }]);
    expect(atlasGoalSavePlan(goal(), "New", { working: true, provider: "claude" })).toEqual({
      steps: [{ type: "command", text: "/goal New", restart: true }],
      note: "Claude Code pauses the current turn and starts on the new goal.",
    });
  });
});

describe("/goal commands", () => {
  it("keeps the objective free of the command", () => {
    expect(stripGoalCommandPrefix("/goal /goal  Fix the build ")).toBe("Fix the build");
    expect(stripGoalCommandPrefix("/goals are fine")).toBe("/goals are fine");
    expect(parseAtlasGoalCommand("/goal /goal Fix it")).toEqual({
      type: "set",
      objective: "Fix it",
    });
    expect(parseAtlasGoalCommand("/goal Pause")).toEqual({ type: "pause" });
    expect(parseAtlasGoalCommand("/goal")).toEqual({ type: "show" });
    expect(parseAtlasGoalCommand("set a /goal")).toBeNull();
  });

  const route = (
    text: string,
    options: { working: boolean; provider: "codex" | "claude"; hasGoal?: boolean },
  ) =>
    atlasGoalCommandRoute(parseAtlasGoalCommand(text)!, {
      text,
      working: options.working,
      provider: options.provider,
      goal: options.hasGoal === false ? null : goal(),
    });

  it("changes a running Codex goal natively instead of queueing", () => {
    expect(route("/goal New aim", { working: true, provider: "codex" })).toEqual({
      type: "update",
      action: { type: "edit", objective: "New aim" },
    });
    expect(route("/goal pause", { working: true, provider: "codex" })).toEqual({
      type: "update",
      action: { type: "pause" },
    });
  });

  it("pauses a running Claude goal turn and starts the new goal", () => {
    expect(route("/goal /goal New aim", { working: true, provider: "claude" })).toEqual({
      type: "restart",
      text: "/goal New aim",
    });
    expect(route("/goal clear", { working: true, provider: "claude" })).toEqual({
      type: "restart",
      text: "/goal clear",
    });
  });

  it("queues what cannot reach a running goal, and sends idle commands once", () => {
    expect(route("/goal New", { working: true, provider: "claude", hasGoal: false })).toEqual({
      type: "queue",
    });
    expect(route("/goal", { working: true, provider: "codex" })).toEqual({ type: "queue" });
    expect(route("/goal New", { working: false, provider: "claude" })).toBeNull();
    expect(route("/goal /goal New", { working: false, provider: "claude" })).toEqual({
      type: "send",
      text: "/goal New",
    });
  });
});

describe("atlasGoalElapsedSeconds", () => {
  const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 21) + seconds * 1000);
  const message = (id: string, text: string) => ({
    id: MessageId.make(id),
    role: "user" as const,
    text,
  });
  const run = (id: string, start: number, end: number | null) => ({
    userMessageId: MessageId.make(id),
    startedAt: at(start),
    completedAt: end === null ? null : at(end),
  });
  const claudeGoal = goal({ objective: "Ship it", timeUsedSeconds: undefined });
  const messages = [
    message("old", "/goal Something else"),
    message("set", "/goal Ship it"),
    message("follow", "keep going"),
  ];

  it("adds up every turn since the /goal that set the objective, live while one runs", () => {
    expect(
      atlasGoalElapsedSeconds({
        goal: claudeGoal,
        messages,
        runs: [run("old", 0, 500), run("set", 1_000, 1_600), run("follow", 2_000, null)],
        nowMs: DateTime.toEpochMillis(at(2_090)),
      }),
    ).toBe(690);
  });

  it("keeps the larger of Codex's own count and the turns'", () => {
    expect(
      atlasGoalElapsedSeconds({
        goal: goal({ objective: "Ship it", timeUsedSeconds: 5_000 }),
        messages,
        runs: [run("set", 0, 60)],
        nowMs: 0,
      }),
    ).toBe(5_000);
    expect(atlasGoalElapsedSeconds({ goal: claudeGoal, messages: [], runs: [], nowMs: 0 })).toBe(0);
  });
});
