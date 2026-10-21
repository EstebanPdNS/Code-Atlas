import type { OrchestrationV2GoalAction, OrchestrationV2ProviderGoal } from "@t3tools/contracts";

/**
 * The thread goal as Codex shows it: its status-line wording, compact usage,
 * and which controls apply. Codex controls a goal natively (pause, resume,
 * edit in place); Claude Code only replaces or clears it with `/goal`.
 */

type GoalStatus = OrchestrationV2ProviderGoal["status"];

export type AtlasGoalProvider = "codex" | "claude" | "other";

export function atlasGoalProvider(driver: string | null | undefined): AtlasGoalProvider {
  if (driver === "codex") return "codex";
  if (driver === "claudeAgent") return "claude";
  return "other";
}

/** Codex's compact token count: 950, 9.85K, 63.9K, 254K, 1.2M. */
export function formatGoalTokens(value: number): string {
  const tokens = Math.max(0, Math.round(value));
  if (tokens < 1_000) return `${tokens}`;
  const [scaled, suffix] =
    tokens >= 1_000_000_000
      ? [tokens / 1_000_000_000, "B"]
      : tokens >= 1_000_000
        ? [tokens / 1_000_000, "M"]
        : [tokens / 1_000, "K"];
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const formatted = scaled.toFixed(decimals);
  return `${formatted.includes(".") ? formatted.replace(/\.?0+$/u, "") : formatted}${suffix}`;
}

/** Codex's goal time: 59s, 23m, 1h 30m, 2d 23h 42m. */
export function formatGoalElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h ${remainingMinutes}m`;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function goalTitle(goal: OrchestrationV2ProviderGoal, working: boolean): string {
  switch (goal.status) {
    case "active":
      return working ? "Pursuing goal" : "Goal active";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Goal stalled";
    case "usage_limited":
      return "Goal hit usage limits";
    case "budget_limited":
      return goal.tokenBudget == null ? "Goal abandoned" : "Goal unmet";
    case "complete":
      return "Goal achieved";
  }
}

function goalUsage(goal: OrchestrationV2ProviderGoal): string | null {
  const parts: Array<string> = [];
  if (goal.tokensUsed !== undefined && goal.tokensUsed > 0) {
    parts.push(
      goal.tokenBudget == null
        ? `${formatGoalTokens(goal.tokensUsed)} tokens`
        : `${formatGoalTokens(goal.tokensUsed)} / ${formatGoalTokens(goal.tokenBudget)} tokens`,
    );
  }
  if (goal.timeUsedSeconds !== undefined && goal.timeUsedSeconds > 0) {
    parts.push(formatGoalElapsed(goal.timeUsedSeconds));
  }
  if (goal.checks !== undefined && goal.checks > 0) {
    parts.push(`${goal.checks} ${goal.checks === 1 ? "check" : "checks"}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

const RESUMABLE: ReadonlySet<GoalStatus> = new Set(["paused", "blocked", "usage_limited"]);

export interface AtlasGoalPresentation {
  readonly title: string;
  readonly usage: string | null;
  /** The title and usage on one line, as the card and the editor show them. */
  readonly status: string;
  readonly objective: string;
  /** "pause" while Codex pursues the goal, "resume" when it can continue. */
  readonly toggle: "pause" | "resume" | null;
  /** Clearing through `/goal clear` needs an idle thread; Codex clears any time. */
  readonly canClear: boolean;
}

export function presentAtlasGoal(
  goal: OrchestrationV2ProviderGoal,
  options: { readonly working: boolean; readonly provider: AtlasGoalProvider },
): AtlasGoalPresentation {
  const title = goalTitle(goal, options.working);
  const usage = goalUsage(goal);
  const native = options.provider === "codex";
  const toggle = !native
    ? null
    : goal.status === "active"
      ? options.working
        ? "pause"
        : "resume"
      : RESUMABLE.has(goal.status)
        ? "resume"
        : null;
  return {
    title,
    usage,
    status: usage === null ? title : `${title} · ${usage}`,
    objective: goal.objective,
    toggle,
    canClear: native || !options.working,
  };
}

/** What a goal control does: a native goal update, a `/goal` turn, or both. */
export type AtlasGoalStep =
  | { readonly type: "update"; readonly action: OrchestrationV2GoalAction }
  | { readonly type: "command"; readonly text: string; readonly queue?: true };

export function atlasGoalToggleSteps(
  toggle: "pause" | "resume",
  options: { readonly working: boolean },
): ReadonlyArray<AtlasGoalStep> {
  if (toggle === "pause") return [{ type: "update", action: { type: "pause" } }];
  // A goal Codex resumes on its own while the thread is idle has no run to
  // own its turns, so an idle resume starts one with `/goal resume`.
  return options.working
    ? [{ type: "update", action: { type: "resume" } }]
    : [{ type: "command", text: "/goal resume" }];
}

export function atlasGoalClearSteps(provider: AtlasGoalProvider): ReadonlyArray<AtlasGoalStep> {
  return provider === "codex"
    ? [{ type: "update", action: { type: "clear" } }]
    : [{ type: "command", text: "/goal clear" }];
}

export interface AtlasGoalSavePlan {
  readonly steps: ReadonlyArray<AtlasGoalStep>;
  /** Shown in the editor before saving, so the user knows when the change lands. */
  readonly note: string;
}

/**
 * Saving an edited objective, as the Codex TUI does: the status and usage
 * stay, except a finished or over-budget goal, which becomes active again.
 */
export function atlasGoalSavePlan(
  goal: OrchestrationV2ProviderGoal,
  objective: string,
  options: { readonly working: boolean; readonly provider: AtlasGoalProvider },
): AtlasGoalSavePlan {
  const trimmed = objective.trim();
  if (options.provider !== "codex") {
    return options.working
      ? {
          steps: [{ type: "command", text: `/goal ${trimmed}`, queue: true }],
          note: "Claude Code applies the new goal after the current turn.",
        }
      : {
          steps: [{ type: "command", text: `/goal ${trimmed}` }],
          note: "Claude Code replaces the goal and starts working on it.",
        };
  }
  const continues = !RESUMABLE.has(goal.status);
  if (options.working) {
    return {
      steps: [{ type: "update", action: { type: "edit", objective: trimmed } }],
      note: continues
        ? "Codex picks up the new objective in the current turn."
        : "The goal keeps its status. Resume it to continue with the new objective.",
    };
  }
  if (!continues) {
    return {
      steps: [{ type: "update", action: { type: "edit", objective: trimmed } }],
      note: "The goal stays paused. Resume it to continue with the new objective.",
    };
  }
  return {
    steps: [
      { type: "update", action: { type: "edit", objective: trimmed, status: "paused" } },
      { type: "command", text: "/goal resume" },
    ],
    note: "Saving continues the goal with the new objective.",
  };
}
