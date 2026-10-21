import type { EnvironmentId, OrchestrationV2GoalAction, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "~/components/ui/toast";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Code Atlas: a native goal change (Codex), as a `/goal` typed while a turn
 * runs sends it. Resolves whether it landed; a failure shows as a toast.
 */
export function useAtlasGoalUpdate() {
  const updateGoal = useAtomCommand(orchestrationEnvironment.updateGoal);
  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly action: OrchestrationV2GoalAction;
  }): Promise<boolean> => {
    const result = await updateGoal({
      environmentId: input.environmentId,
      input: { threadId: input.threadId, action: input.action },
    });
    if (result._tag !== "Failure") return true;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not update the goal",
        description: error instanceof Error ? error.message : undefined,
      });
    }
    return false;
  };
}
