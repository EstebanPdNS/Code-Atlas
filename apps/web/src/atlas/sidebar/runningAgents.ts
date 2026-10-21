/**
 * Code Atlas: how many agents are working right now, read by the desktop shell
 * before a Cmd+Q quit when the hold/double-press confirmation is off.
 */
import { useEffect } from "react";

declare global {
  var codeAtlasRunningAgents: number | undefined;
}

export function usePublishRunningAgents(count: number): void {
  useEffect(() => {
    globalThis.codeAtlasRunningAgents = count;
  }, [count]);
}
