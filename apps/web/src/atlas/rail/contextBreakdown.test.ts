import { describe, expect, it } from "vite-plus/test";

import {
  contextRows,
  formatContextRowTokens,
  formatContextShare,
  withContextTones,
} from "./contextBreakdown";

const usage = {
  cachedInputTokens: null,
  inputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  usedTokens: 0,
};

describe("contextRows", () => {
  it("splits generic usage into input, cache and output, then free space", () => {
    expect(
      contextRows(
        {
          ...usage,
          inputTokens: 1_000,
          cachedInputTokens: 400,
          outputTokens: 200,
          usedTokens: 1_200,
        },
        10_000,
      ),
    ).toEqual([
      { name: "Input", tokens: 600, kind: "used" },
      { name: "Cached input", tokens: 400, kind: "used" },
      { name: "Output", tokens: 200, kind: "used" },
      { name: "Free space", tokens: 8_800, kind: "free" },
    ]);
  });

  it("keeps the provider's categories, dropping empty ones and moving deferred tools last", () => {
    const rows = contextRows(
      {
        ...usage,
        contextCategories: [
          { name: "MCP tools (deferred)", tokens: 900, kind: "deferred" },
          { name: "Messages", tokens: 3_000, kind: "used" },
          { name: "Skills", tokens: 0, kind: "used" },
          { name: "Free space", tokens: 0, kind: "free" },
        ],
      },
      10_000,
    );
    expect(rows.map((row) => row.name)).toEqual(["Messages", "Free space", "MCP tools (deferred)"]);
  });

  it("adds what usage grew by since the breakdown after the used rows, like Claude's /context", () => {
    const contextCategories = [
      { name: "Messages", tokens: 3_000, kind: "used" },
      { name: "Memory files", tokens: 500, kind: "used" },
      { name: "Autocompact buffer", tokens: 1_000, kind: "buffer" },
      { name: "Free space", tokens: 5_500, kind: "free" },
      { name: "System tools (deferred)", tokens: 900, kind: "deferred" },
    ] as const;
    const rows = contextRows(
      { ...usage, usedTokens: 4_200, contextBreakdownTotalTokens: 3_500, contextCategories },
      10_000,
    );
    expect(rows.map(({ name, tokens }) => [name, tokens])).toEqual([
      ["Messages", 3_000],
      ["Memory files", 500],
      ["Since last update", 700],
      ["Autocompact buffer", 1_000],
      ["Free space", 5_500],
      ["System tools (deferred)", 900],
    ]);
    // Nothing added, or usage that shrank, shows no row.
    expect(
      contextRows(
        { ...usage, usedTokens: 3_400, contextBreakdownTotalTokens: 3_500, contextCategories },
        10_000,
      ).some((row) => row.name === "Since last update"),
    ).toBe(false);
  });

  it("marks an estimated breakdown's used rows, not its free space", () => {
    const rows = contextRows(
      {
        ...usage,
        usedTokens: 2_000,
        contextEstimated: true,
        contextCategories: [
          { name: "Messages", tokens: 1_200, kind: "used" },
          { name: "System prompt & tools", tokens: 800, kind: "used" },
          { name: "Free space", tokens: 8_000, kind: "free" },
        ],
      },
      10_000,
    );
    expect(rows.map((row) => [row.name, row.estimated === true])).toEqual([
      ["Messages", true],
      ["System prompt & tools", true],
      ["Free space", false],
    ]);
    expect(rows.map((row) => formatContextRowTokens(row))).toEqual(["≈1.2k", "≈800", "8k"]);
  });
});

describe("withContextTones", () => {
  it("paints Claude's categories in its colors and other used rows in order", () => {
    const toned = withContextTones([
      { name: "Messages", tokens: 10, kind: "used" },
      { name: "Input", tokens: 10, kind: "used" },
      { name: "Autocompact buffer", tokens: 10, kind: "buffer" },
      { name: "Free space", tokens: 10, kind: "free" },
    ]);
    expect(toned.map(({ tone, color }) => ({ tone, color }))).toEqual([
      { tone: "", color: "#5b8def" },
      { tone: "bg-primary", color: null },
      { tone: "bg-muted-foreground/30", color: null },
      { tone: "bg-foreground/10", color: null },
    ]);
  });
});

describe("formatContextShare", () => {
  it("shows one decimal", () => {
    expect(formatContextShare(1_234, 10_000)).toBe("12.3%");
  });
});
