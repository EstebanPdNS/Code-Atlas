import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

import {
  atlasActivityLabel,
  atlasPlanFocus,
  formatAtlasChangedFiles,
  formatAtlasElapsed,
  formatAtlasLines,
  formatAtlasTokens,
} from "./claudeProgress";

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

describe("atlasPlanFocus", () => {
  const plan = (statuses: string) =>
    [...statuses].map((c) => ({
      status:
        c === "x"
          ? ("completed" as const)
          : c === ">"
            ? ("inProgress" as const)
            : ("pending" as const),
    }));

  it("shows the step in progress and the next ones", () => {
    expect(atlasPlanFocus(plan("xx>...."))).toEqual([2, 3, 4]);
  });

  it("keeps every step in progress first", () => {
    expect(atlasPlanFocus(plan("x>>>>."))).toEqual([1, 2, 3]);
  });

  it("starts from the first pending step before work begins", () => {
    expect(atlasPlanFocus(plan("...."), 2)).toEqual([0, 1]);
  });

  it("shows the last step of a finished plan", () => {
    expect(atlasPlanFocus(plan("xxx"))).toEqual([2]);
    expect(atlasPlanFocus([])).toEqual([]);
  });
});

describe("status line lines", () => {
  it("shows added and removed lines only once a line changed", () => {
    expect(formatAtlasLines({ additions: 0, deletions: 0 })).toBeNull();
    expect(formatAtlasLines({ additions: 40, deletions: 12 })).toEqual({
      added: "+40",
      removed: "−12",
    });
    expect(formatAtlasLines({ additions: 1_234, deletions: 0 })).toEqual({
      added: "+1.2k",
      removed: "−0",
    });
    expect(formatAtlasChangedFiles(1)).toBe("1 file changed");
    expect(formatAtlasChangedFiles(3)).toBe("3 files changed");
  });
});
