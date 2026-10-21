import { describe, expect, it } from "vite-plus/test";

import {
  publishAtlasTerminalMeta,
  slugifyAtlasCommand,
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
