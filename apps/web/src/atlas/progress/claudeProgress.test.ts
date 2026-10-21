import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

import { atlasActivityLabel, formatAtlasElapsed, formatAtlasTokens } from "./claudeProgress";

const work = (entry: Partial<WorkLogEntry>): TimelineEntry => ({
  id: "w",
  kind: "work",
  createdAt: "2026-10-20T00:00:00.000Z",
  entry: {
    id: "w",
    createdAt: "2026-10-20T00:00:00.000Z",
    label: "Tool",
    tone: "tool",
    ...entry,
  },
});

describe("atlasActivityLabel", () => {
  it("names the running step like Claude Code", () => {
    expect(atlasActivityLabel([])).toBe("Thinking");
    expect(
      atlasActivityLabel([work({ command: "vp test", toolLifecycleStatus: "inProgress" })]),
    ).toBe("Running a command");
    expect(
      atlasActivityLabel([work({ changedFiles: ["a.ts"], toolLifecycleStatus: "inProgress" })]),
    ).toBe("Editing files");
    expect(atlasActivityLabel([work({ tone: "thinking", itemType: "reasoning" })])).toBe(
      "Thinking",
    );
    expect(
      atlasActivityLabel([work({ toolTitle: "Web search", toolLifecycleStatus: "inProgress" })]),
    ).toBe("Web search");
  });

  it("returns to Thinking once a tool finished", () => {
    expect(atlasActivityLabel([work({ command: "ls", toolLifecycleStatus: "completed" })])).toBe(
      "Thinking",
    );
  });
});

describe("status line formatting", () => {
  it("formats elapsed time and tokens", () => {
    expect(formatAtlasElapsed(8_400)).toBe("8s");
    expect(formatAtlasElapsed(68_000)).toBe("1m 8s");
    expect(formatAtlasElapsed(3_720_000)).toBe("1h 2m");
    expect(formatAtlasTokens(950)).toBe("950 tokens");
    expect(formatAtlasTokens(37_012)).toBe("37.0k tokens");
    expect(formatAtlasTokens(1_234_567)).toBe("1.2M tokens");
  });
});
