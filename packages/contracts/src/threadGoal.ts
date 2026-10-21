/**
 * Code Atlas: pause, resume, edit and clear a thread's provider goal outside a
 * turn, like Codex's own goal controls. The goal itself stays provider-owned:
 * the provider reports the result back as a provider thread update.
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_GOAL_WS_METHODS = {
  updateGoal: "orchestration.updateGoal",
} as const;

export const OrchestrationV2GoalAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pause") }),
  Schema.Struct({ type: Schema.Literal("resume") }),
  Schema.Struct({ type: Schema.Literal("clear") }),
  Schema.Struct({
    type: Schema.Literal("edit"),
    objective: TrimmedNonEmptyString,
    /** Absent keeps Codex's edit rule: a finished or over-budget goal becomes active again. */
    status: Schema.optional(Schema.Literals(["active", "paused"])),
  }),
]);
export type OrchestrationV2GoalAction = typeof OrchestrationV2GoalAction.Type;

export const OrchestrationV2UpdateGoalInput = Schema.Struct({
  threadId: ThreadId,
  action: OrchestrationV2GoalAction,
});
export type OrchestrationV2UpdateGoalInput = typeof OrchestrationV2UpdateGoalInput.Type;

export class OrchestrationV2UpdateGoalError extends Schema.TaggedError<OrchestrationV2UpdateGoalError>()(
  "OrchestrationV2UpdateGoalError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["no-goal", "unsupported", "unavailable", "update-failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "no-goal":
        return "This thread has no goal.";
      case "unsupported":
        return "This provider cannot change a goal outside a turn.";
      case "unavailable":
        return "This thread has no live provider session.";
      case "update-failed":
        return "Failed to update the goal.";
    }
  }
}
