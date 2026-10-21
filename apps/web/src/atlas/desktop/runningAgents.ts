/**
 * Code Atlas: how many agents are working on this machine right now, read by
 * the desktop shell before a Cmd+Q quit when the hold/double-press confirmation
 * is off (apps/desktop/src/window/DesktopWindow.ts). Quitting only stops the
 * local server, so agents on remote environments do not count.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import type { SidebarThreadStatus } from "~/components/Sidebar.logic";
import { usePrimaryEnvironmentId } from "~/state/environments";

declare global {
  var codeAtlasRunningAgents: number | undefined;
}

interface RunningAgentCandidate {
  readonly environmentId: EnvironmentId;
  readonly status: SidebarThreadStatus;
}

export function countLocalRunningAgents(
  threads: ReadonlyArray<RunningAgentCandidate>,
  primaryEnvironmentId: EnvironmentId | null,
): number {
  if (primaryEnvironmentId === null) return 0;
  return threads.filter(
    (thread) =>
      thread.environmentId === primaryEnvironmentId &&
      (thread.status === "working" || thread.status === "waiting"),
  ).length;
}

export function usePublishRunningAgents(threads: ReadonlyArray<RunningAgentCandidate>): void {
  const count = countLocalRunningAgents(threads, usePrimaryEnvironmentId());
  useEffect(() => {
    globalThis.codeAtlasRunningAgents = count;
    return () => {
      globalThis.codeAtlasRunningAgents = undefined;
    };
  }, [count]);
}
