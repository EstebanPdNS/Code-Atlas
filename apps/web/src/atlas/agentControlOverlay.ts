/**
 * Code Atlas: while an agent drives another app (Codex computer use), the
 * desktop shell frames that app's window with an orange glow.
 */
import { useEffect } from "react";

import type { TimelineEntry } from "~/session-logic";

/** The app the current turn's latest computer-use step drives, if any. */
export function computerUseApp(entries: readonly TimelineEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    // Only the turn since the user's last message counts.
    if (entry.kind === "message" && entry.message.role === "user") return null;
    if (entry.kind !== "work" || entry.entry.toolSurface !== "computer") continue;
    const icon = entry.entry.toolIcon;
    if (icon?._tag === "native-app") {
      return icon.app._tag === "app-id" ? icon.app.appId : icon.app.displayName;
    }
    return entry.entry.toolSource?.kind === "computer" ? entry.entry.toolSource.name : null;
  }
  return null;
}

export function useAgentControlOverlay(app: string | null): void {
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.setAgentControlOverlay) return;
    void bridge.setAgentControlOverlay(app === null ? null : { app }).catch(() => undefined);
  }, [app]);
  useEffect(
    () => () => {
      void window.desktopBridge?.setAgentControlOverlay?.(null).catch(() => undefined);
    },
    [],
  );
}
