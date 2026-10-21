import { describe, expect, it } from "vite-plus/test";

import type { SourceControlDiscoveryResult } from "@t3tools/contracts";

import {
  formatAtlasWeekCounts,
  publishAtlasTerminalMeta,
  slugifyAtlasCommand,
  toAtlasWeekActivity,
  type AtlasTerminalMeta,
} from "./atlasIntro";

describe("slugifyAtlasCommand", () => {
  it("turns a project name into a shell-safe slug", () => {
    expect(slugifyAtlasCommand("Code Atlas (App)")).toBe("atlas --open code-atlas-app");
    expect(slugifyAtlasCommand("Café Ñandú")).toBe("atlas --open cafe-nandu");
  });

  it("falls back to workspace for a missing or symbol-only name", () => {
    expect(slugifyAtlasCommand(null)).toBe("atlas --open workspace");
    expect(slugifyAtlasCommand("***")).toBe("atlas --open workspace");
  });
});

describe("publishAtlasTerminalMeta", () => {
  const meta = (projectName: string): AtlasTerminalMeta => ({
    projectName,
    agents: ["Claude Code"],
    usage: [],
    week: null,
    github: [],
  });

  it("ignores a fresh object with the same content", () => {
    expect(publishAtlasTerminalMeta(meta("dedupe-a"))).toBe(true);
    expect(publishAtlasTerminalMeta(meta("dedupe-a"))).toBe(false);
    expect(publishAtlasTerminalMeta(meta("dedupe-b"))).toBe(true);
  });
});

describe("this week's activity", () => {
  const discovery = (
    activity: Pick<SourceControlDiscoveryResult, "turnActivity" | "weeklyActivity">,
  ): SourceControlDiscoveryResult => ({
    versionControlSystems: [],
    sourceControlProviders: [],
    ...activity,
  });

  it("counts Code Atlas turns and adds git commits when the repository has them", () => {
    const week = toAtlasWeekActivity(
      discovery({
        turnActivity: { turns: 12, linesAdded: 1_240, linesRemoved: 310 },
        weeklyActivity: { commits: 1, linesAdded: 5, linesRemoved: 2 },
      }),
    );
    expect(week).toEqual({ linesAdded: 1_240, linesRemoved: 310, turns: 12, commits: 1 });
    expect(formatAtlasWeekCounts(week!)).toBe("12 turns · 1 commit");
  });

  it("shows turns alone outside a repository", () => {
    const week = toAtlasWeekActivity(
      discovery({ turnActivity: { turns: 1, linesAdded: 4, linesRemoved: 0 } }),
    );
    expect(formatAtlasWeekCounts(week!)).toBe("1 turn");
  });

  it("falls back to git when no turn changed files", () => {
    const week = toAtlasWeekActivity(
      discovery({ weeklyActivity: { commits: 3, linesAdded: 11, linesRemoved: 9 } }),
    );
    expect(week).toEqual({ linesAdded: 11, linesRemoved: 9, turns: null, commits: 3 });
    expect(formatAtlasWeekCounts(week!)).toBe("3 commits");
  });

  it("has nothing to show without either source", () => {
    expect(toAtlasWeekActivity(discovery({}))).toBeNull();
    expect(toAtlasWeekActivity(undefined)).toBeNull();
  });
});
