/**
 * Code Atlas: while an agent drives an app on this Mac, the desktop shell
 * frames that app's window with an orange glow and a pill naming the agent,
 * whose Stop pauses the thread's run (an interrupt, like ⏸).
 */
import type {
  AgentControlOverlayEvent,
  AgentControlOverlayTarget,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import type { TimelineEntry } from "~/session-logic";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import {
  AGENT_DESKTOP_HINT_DELAY_MS,
  type AgentDesktopTarget,
  agentDesktopTarget,
  rememberResolvedDesktopApp,
} from "./desktopTarget";

/** The app the current turn's latest desktop call drives, if any. */
export function computerUseApp(entries: readonly TimelineEntry[]): AgentDesktopTarget | null {
  return agentDesktopTarget(entries);
}

function overlayTarget(target: AgentDesktopTarget): AgentControlOverlayTarget {
  return {
    key: target.key,
    apps: target.apps,
    hint: target.apps.length === 0 ? target.hint : null,
    agent: target.agent,
    running: target.running,
    startedAt: target.startedAt,
    // A running call has no idle timer: a stable payload is not re-sent per output chunk.
    actionAt: target.running ? target.startedAt : target.actionAt,
  };
}

export function useAgentControlOverlay(target: AgentDesktopTarget | null): void {
  const params = useParams({ strict: false }) as {
    readonly environmentId?: string;
    readonly threadId?: string;
  };
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn);
  // The overlay looks for apps on this Mac: only agents of the local environment drive them.
  const local = params.environmentId !== undefined && params.environmentId === primaryEnvironmentId;
  const payload = local && target !== null ? JSON.stringify(overlayTarget(target)) : null;
  const hintOnly = target !== null && target.apps.length === 0;
  const startedAt = target?.startedAt ?? null;

  // The desktop's name for a hinted app shows in the status line ("Using Azahar").
  const [, setResolvedKey] = useState<string | null>(null);
  const onOverlayEvent = useStableCallback((event: AgentControlOverlayEvent) => {
    if (payload === null || target === null || event.key !== target.key) return;
    if (event.type === "resolved") {
      rememberResolvedDesktopApp(event.key, event.app);
      setResolvedKey(`${event.key}\n${event.app}`);
      return;
    }
    const threadId = target.threadId ?? params.threadId;
    if (threadId === undefined || params.environmentId === undefined) return;
    void interruptTurn({
      environmentId: params.environmentId as EnvironmentId,
      input: { threadId: threadId as ThreadId },
    });
  });

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.setAgentControlOverlay) return;
    const send = (value: AgentControlOverlayTarget | null) =>
      void bridge.setAgentControlOverlay?.(value).catch(() => undefined);
    if (payload === null) {
      send(null);
      return;
    }
    const value = JSON.parse(payload) as AgentControlOverlayTarget;
    // A command only hints at an app once it ran a while: `ls` never spawns the watcher.
    const delay =
      hintOnly && startedAt !== null
        ? Math.max(0, Date.parse(startedAt) + AGENT_DESKTOP_HINT_DELAY_MS - Date.now())
        : 0;
    if (!(delay > 0)) {
      send(value);
      return;
    }
    send(null);
    const timer = window.setTimeout(() => send(value), delay);
    return () => window.clearTimeout(timer);
  }, [payload, hintOnly, startedAt]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onAgentControlOverlayEvent) return;
    return bridge.onAgentControlOverlayEvent(onOverlayEvent);
  }, [onOverlayEvent]);

  useEffect(
    () => () => {
      void window.desktopBridge?.setAgentControlOverlay?.(null).catch(() => undefined);
    },
    [],
  );
}
