import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  codexBreakdownKey,
  codexContextBreakdown,
  codexContextSkills,
  codexEstimatedBreakdown,
  codexInstructionsTokens,
  codexTextInputTokens,
  discoverCodexMemoryFiles,
  noteCodexTurnStart,
  type CodexContextEstimateState,
} from "./codexContextEstimate.ts";

const parts = {
  instructionsTokens: 1_000,
  memoryFiles: [{ path: "/repo/AGENTS.md", tokens: 500 }],
  skills: [{ name: "release-notes", tokens: 100 }],
};

describe("codexContextBreakdown", () => {
  it("lists Claude-style rows, with messages as what the other rows leave", () => {
    const breakdown = codexContextBreakdown({
      usedTokens: 20_000,
      maxTokens: 100_000,
      baselineTokens: 12_000,
      parts,
    });
    assert.deepEqual(breakdown.contextCategories, [
      { name: "Messages", tokens: 6_400, kind: "used" },
      { name: "System prompt & tools", tokens: 12_000, kind: "used" },
      { name: "Code Atlas instructions", tokens: 1_000, kind: "used" },
      { name: "Skills", tokens: 100, kind: "used" },
      { name: "Memory files", tokens: 500, kind: "used" },
      { name: "Free space", tokens: 80_000, kind: "free" },
    ]);
    assert.deepEqual(breakdown.contextMemoryFiles, parts.memoryFiles);
    assert.deepEqual(breakdown.contextSkills, parts.skills);
    assert.isTrue(breakdown.contextEstimated);
  });

  it("never reports negative messages and leaves Skills out when they are unknown", () => {
    const breakdown = codexContextBreakdown({
      usedTokens: 1_000,
      maxTokens: null,
      baselineTokens: 12_000,
      parts: { instructionsTokens: 0, memoryFiles: [] },
    });
    assert.deepEqual(
      breakdown.contextCategories.map((row) => [row.name, row.tokens]),
      [
        ["Messages", 0],
        ["System prompt & tools", 12_000],
        ["Code Atlas instructions", 0],
        ["Memory files", 0],
      ],
    );
    assert.isUndefined(breakdown.contextMemoryFiles);
  });
});

describe("codexEstimatedBreakdown", () => {
  const usage = (usedTokens: number, inputTokens = usedTokens) => ({
    usedTokens,
    maxTokens: 100_000,
    inputTokens,
  });

  it("measures a new thread's baseline from its first request and reuses it per model", () => {
    const baselines = new Map<string, number>();
    const fresh: CodexContextEstimateState = { measureBaseline: true };
    noteCodexTurnStart(fresh, { model: "gpt-5", userMessageTokens: 50 });
    // The file reads have not finished: the first input is kept for later.
    assert.isUndefined(codexEstimatedBreakdown(fresh, baselines, usage(13_650)));
    fresh.parts = parts;
    const later = codexEstimatedBreakdown(fresh, baselines, usage(20_000, 19_000));
    // 13,650 - 50 (message) - 1,000 - 500 - 100 = 12,000.
    assert.equal(fresh.baselineTokens, 12_000);
    assert.equal(baselines.get("gpt-5"), 12_000);
    assert.equal(later?.contextCategories[0]?.tokens, 6_400);

    const resumed: CodexContextEstimateState = { measureBaseline: false, parts };
    noteCodexTurnStart(resumed, { model: "gpt-5", userMessageTokens: 10 });
    assert.equal(
      codexEstimatedBreakdown(resumed, baselines, usage(30_000))?.contextCategories[1]?.tokens,
      12_000,
    );
    assert.isUndefined(resumed.baselineTokens);
  });

  it("does not measure a first turn with images, and drops the baseline on a model switch", () => {
    const baselines = new Map<string, number>();
    const withImage: CodexContextEstimateState = { measureBaseline: true, parts };
    noteCodexTurnStart(withImage, { model: "gpt-5", userMessageTokens: undefined });
    assert.isUndefined(codexEstimatedBreakdown(withImage, baselines, usage(14_000)));

    const switched: CodexContextEstimateState = { measureBaseline: true, parts };
    noteCodexTurnStart(switched, { model: "gpt-5", userMessageTokens: 50 });
    codexEstimatedBreakdown(switched, baselines, usage(13_650));
    noteCodexTurnStart(switched, { model: "gpt-5-mini", userMessageTokens: 50 });
    assert.isUndefined(switched.baselineTokens);
    assert.isUndefined(codexEstimatedBreakdown(switched, baselines, usage(15_000)));
  });

  it("keys a breakdown by its rows", () => {
    const at = (usedTokens: number) =>
      codexContextBreakdown({ usedTokens, maxTokens: 100_000, baselineTokens: 12_000, parts });
    assert.equal(codexBreakdownKey(at(20_000)), codexBreakdownKey(at(20_000)));
    assert.notEqual(codexBreakdownKey(at(20_000)), codexBreakdownKey(at(21_000)));
  });
});

describe("Codex context inputs", () => {
  it("estimates text input, and gives up on images", () => {
    assert.equal(codexTextInputTokens([{ type: "text", text: "12345678" }]), 2);
    assert.isUndefined(
      codexTextInputTokens([{ type: "text", text: "hi" }, { type: "localImage" }]),
    );
  });

  it("counts developer instructions and additionalContext as Codex renders them", () => {
    // "<a>12345678</a>" (15) + "<external_b>1234</external_b>" (29) + "abcd" (4) = 48 bytes.
    assert.equal(
      codexInstructionsTokens({
        developerInstructions: "abcd",
        additionalContext: {
          a: { kind: "application", value: "12345678" },
          b: { kind: "untrusted", value: "1234" },
        },
      }),
      12,
    );
  });

  it("lists enabled skills", () => {
    const skill = (name: string, enabled: boolean) => ({
      name,
      description: "Writes notes",
      path: `/skills/${name}/SKILL.md`,
      enabled,
    });
    const skills = codexContextSkills([skill("notes", true), skill("off", false)]);
    // "- notes: Writes notes (file: /skills/notes/SKILL.md)\n" is 53 bytes.
    assert.deepEqual(skills, [{ name: "notes", tokens: 14 }]);
  });
});

it.layer(NodeServices.layer)("discoverCodexMemoryFiles", (it) => {
  it.effect("finds the global file, then the repo chain down to cwd, override first", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-agents-" });
      const home = `${root}/codex-home`;
      const repo = `${root}/repo`;
      yield* fs.makeDirectory(home, { recursive: true });
      yield* fs.makeDirectory(`${repo}/.git`, { recursive: true });
      yield* fs.makeDirectory(`${repo}/packages/app`, { recursive: true });
      yield* fs.writeFileString(`${home}/AGENTS.md`, "x".repeat(400));
      yield* fs.writeFileString(`${repo}/AGENTS.md`, "x".repeat(800));
      yield* fs.writeFileString(`${repo}/packages/app/AGENTS.md`, "x".repeat(40));
      yield* fs.writeFileString(`${repo}/packages/app/AGENTS.override.md`, "x".repeat(80));
      // Above the repo root: not loaded.
      yield* fs.writeFileString(`${root}/AGENTS.md`, "x".repeat(4));

      const files = yield* discoverCodexMemoryFiles(fs, {
        cwd: `${repo}/packages/app`,
        codexHome: home,
      });
      assert.deepEqual(files, [
        { path: `${home}/AGENTS.md`, tokens: 100 },
        { path: `${repo}/AGENTS.md`, tokens: 200 },
        { path: `${repo}/packages/app/AGENTS.override.md`, tokens: 20 },
      ]);
    }),
  );
});
