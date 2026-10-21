import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2GoalAction,
  OrchestrationV2ProviderGoal,
  OrchestrationV2Run,
} from "@t3tools/contracts";
import { DateTime } from "effect";

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

const GOAL_COMMAND_PREFIX = /^\/goal(?:\s+|$)/u;

/**
 * "/goal /goal Fix it" reads "Fix it": a pasted or repeated `/goal` never
 * becomes part of the objective.
 */
export function stripGoalCommandPrefix(text: string): string {
  let rest = text.trim();
  while (GOAL_COMMAND_PREFIX.test(rest)) rest = rest.replace(GOAL_COMMAND_PREFIX, "").trim();
  return rest;
}

export type AtlasGoalCommand =
  | { readonly type: "show" | "clear" | "pause" | "resume" }
  | { readonly type: "set"; readonly objective: string };

/** A `/goal` message as Codex reads it; any other text is not a goal command. */
export function parseAtlasGoalCommand(text: string): AtlasGoalCommand | null {
  if (!GOAL_COMMAND_PREFIX.test(text.trim())) return null;
  const argument = stripGoalCommandPrefix(text);
  switch (argument.toLowerCase()) {
    case "":
    case "edit":
      return { type: "show" };
    case "clear":
    case "pause":
    case "resume":
      return { type: argument.toLowerCase() as "clear" | "pause" | "resume" };
    default:
      return { type: "set", objective: argument };
  }
}

function goalCommandText(command: AtlasGoalCommand): string {
  return command.type === "set"
    ? `/goal ${command.objective}`
    : command.type === "show"
      ? "/goal"
      : `/goal ${command.type}`;
}

/**
 * How a typed `/goal` is delivered. While a turn runs it must not wait in
 * the queue behind a goal turn that may run for hours: Codex changes the goal
 * natively; Claude Code only reads `/goal` at the start of a turn, so its
 * running turn pauses and the command starts the next one (`restart`).
 * Anything else queues, since a goal command cannot steer the running turn.
 * Idle, a repeated `/goal` is sent once (`send`); `null` sends it as typed.
 */
export type AtlasGoalCommandRoute =
  | { readonly type: "update"; readonly action: OrchestrationV2GoalAction }
  | { readonly type: "restart" | "send"; readonly text: string }
  | { readonly type: "queue" };

export function atlasGoalCommandRoute(
  command: AtlasGoalCommand,
  options: {
    readonly text: string;
    readonly working: boolean;
    readonly goal: OrchestrationV2ProviderGoal | null;
    readonly provider: AtlasGoalProvider;
  },
): AtlasGoalCommandRoute | null {
  if (!options.working) {
    const text = goalCommandText(command);
    return command.type === "set" && text !== options.text.trim() ? { type: "send", text } : null;
  }
  if (options.provider === "codex" && options.goal !== null) {
    switch (command.type) {
      case "set":
        return { type: "update", action: { type: "edit", objective: command.objective } };
      case "clear":
      case "pause":
      case "resume":
        return { type: "update", action: { type: command.type } };
      case "show":
        return { type: "queue" };
    }
  }
  if (
    options.provider === "claude" &&
    options.goal !== null &&
    (command.type === "set" || command.type === "clear")
  ) {
    return { type: "restart", text: goalCommandText(command) };
  }
  return { type: "queue" };
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

function goalUsageParts(
  goal: OrchestrationV2ProviderGoal,
  options: { readonly withTime: boolean },
): Array<string> {
  const parts: Array<string> = [];
  if (goal.tokensUsed !== undefined && goal.tokensUsed > 0) {
    parts.push(
      goal.tokenBudget == null
        ? `${formatGoalTokens(goal.tokensUsed)} tokens`
        : `${formatGoalTokens(goal.tokensUsed)} / ${formatGoalTokens(goal.tokenBudget)} tokens`,
    );
  }
  if (options.withTime && goal.timeUsedSeconds !== undefined && goal.timeUsedSeconds > 0) {
    parts.push(formatGoalElapsed(goal.timeUsedSeconds));
  }
  if (goal.checks !== undefined && goal.checks > 0) {
    parts.push(`${goal.checks} ${goal.checks === 1 ? "check" : "checks"}`);
  }
  return parts;
}

const RESUMABLE: ReadonlySet<GoalStatus> = new Set(["paused", "blocked", "usage_limited"]);

export interface AtlasGoalPresentation {
  readonly title: string;
  readonly usage: string | null;
  /** Tokens and checks for the goal bar, which shows the time on its own. */
  readonly metrics: string | null;
  /** The title and usage on one line, as the card and the editor show them. */
  readonly status: string;
  readonly objective: string;
  /**
   * "pause" while the goal is pursued, "resume" when it can continue. Codex
   * pauses the goal itself; other agents pause and resume the running task.
   */
  readonly toggle: "pause" | "resume" | null;
  /** Codex clears natively; Claude Code pauses a running turn and runs `/goal clear`. */
  readonly canClear: boolean;
}

export function presentAtlasGoal(
  goal: OrchestrationV2ProviderGoal,
  options: {
    readonly working: boolean;
    readonly provider: AtlasGoalProvider;
    /** A paused (interrupted) task that Resume continues. */
    readonly taskResumable?: boolean;
  },
): AtlasGoalPresentation {
  const title = goalTitle(goal, options.working);
  const usageParts = goalUsageParts(goal, { withTime: true });
  const usage = usageParts.length === 0 ? null : usageParts.join(" · ");
  const metrics = goalUsageParts(goal, { withTime: false });
  const native = options.provider === "codex";
  const toggle = !native
    ? goal.status !== "active"
      ? null
      : options.working
        ? "pause"
        : options.taskResumable === true
          ? "resume"
          : null
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
    metrics: metrics.length === 0 ? null : metrics.join(" · "),
    status: usage === null ? title : `${title} · ${usage}`,
    objective: stripGoalCommandPrefix(goal.objective),
    toggle,
    canClear: true,
  };
}

/**
 * What a goal control does: a native goal update, a `/goal` turn, or both.
 * `restart` pauses the running turn first so the command starts right away.
 */
export type AtlasGoalStep =
  | { readonly type: "update"; readonly action: OrchestrationV2GoalAction }
  | { readonly type: "command"; readonly text: string; readonly restart?: true };

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

export function atlasGoalClearSteps(
  provider: AtlasGoalProvider,
  options: { readonly working: boolean },
): ReadonlyArray<AtlasGoalStep> {
  if (provider === "codex") return [{ type: "update", action: { type: "clear" } }];
  return options.working
    ? [{ type: "command", text: "/goal clear", restart: true }]
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
  const trimmed = stripGoalCommandPrefix(objective);
  if (options.provider !== "codex") {
    return options.working
      ? {
          steps: [{ type: "command", text: `/goal ${trimmed}`, restart: true }],
          note: "Claude Code pauses the current turn and starts on the new goal.",
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

/**
 * The goal's total working time, counted across turns and sessions: every run
 * since the `/goal` that set the current objective (the latest one when the
 * objective was edited in place), live while one runs. Codex also reports its
 * own count; the larger one wins.
 */
export function atlasGoalElapsedSeconds(input: {
  readonly goal: OrchestrationV2ProviderGoal;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "id" | "role" | "text">
  >;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "userMessageId" | "startedAt" | "completedAt">
  >;
  readonly nowMs: number;
}): number {
  const native = input.goal.timeUsedSeconds ?? 0;
  const objective = normalizeObjective(input.goal.objective);
  let latestSet = -1;
  let matchingSet = -1;
  input.messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const command = parseAtlasGoalCommand(message.text);
    if (command?.type !== "set") return;
    latestSet = index;
    if (normalizeObjective(command.objective) === objective) matchingSet = index;
  });
  const setIndex = matchingSet >= 0 ? matchingSet : latestSet;
  if (setIndex < 0) return native;
  const since = new Set(input.messages.slice(setIndex).map((message) => message.id));
  let totalMs = 0;
  for (const run of input.runs) {
    if (run.startedAt === null || !since.has(run.userMessageId)) continue;
    const start = DateTime.toEpochMillis(run.startedAt);
    const end = run.completedAt === null ? input.nowMs : DateTime.toEpochMillis(run.completedAt);
    totalMs += Math.max(0, end - start);
  }
  return Math.max(native, Math.floor(totalMs / 1000));
}

function normalizeObjective(text: string): string {
  return stripGoalCommandPrefix(text).replace(/\s+/gu, " ");
}
