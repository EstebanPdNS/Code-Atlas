import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

import { computerUseApp } from "./agentControlOverlay";

const work = (entry: Partial<WorkLogEntry>): TimelineEntry => ({
  id: `w-${Math.random()}`,
  kind: "work",
  createdAt: "2026-10-20T00:00:00.000Z",
  entry: { id: "w", createdAt: "2026-10-20T00:00:00.000Z", label: "Tool", tone: "tool", ...entry },
});

const userMessage: TimelineEntry = {
  id: "m",
  kind: "message",
  createdAt: "2026-10-20T00:00:00.000Z",
  message: {
    id: "m" as never,
    role: "user",
    text: "open Safari",
    runId: null,
    streaming: false,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  },
};

describe("computerUseApp", () => {
  it("names the app the current turn drives", () => {
    expect(
      computerUseApp([
        userMessage,
        work({
          toolSurface: "computer",
          toolIcon: { _tag: "native-app", app: { _tag: "app-id", appId: "com.apple.Safari" } },
        }),
        work({ command: "ls" }),
      ]),
    ).toBe("com.apple.Safari");
    expect(
      computerUseApp([
        work({
          toolSurface: "computer",
          toolSource: { key: "notes", name: "Notes", kind: "computer" },
        }),
      ]),
    ).toBe("Notes");
  });

  it("ignores computer use from an earlier turn", () => {
    expect(
      computerUseApp([
        work({
          toolSurface: "computer",
          toolIcon: { _tag: "native-app", app: { _tag: "display-name", displayName: "Notes" } },
        }),
        userMessage,
        work({ command: "ls" }),
      ]),
    ).toBeNull();
  });
});
