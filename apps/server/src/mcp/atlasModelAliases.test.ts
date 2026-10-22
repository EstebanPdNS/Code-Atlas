import { describe, expect, it } from "vite-plus/test";

import { resolveAtlasModelAlias } from "./atlasModelAliases.ts";

const codex = [
  { slug: "gpt-6-astra" },
  { slug: "gpt-6.1-sol" },
  { slug: "gpt-6-sol" },
  { slug: "gpt-6-luna" },
];
const claude = [
  { slug: "claude-fable-5-1" },
  { slug: "claude-opus-5-5" },
  { slug: "claude-sonnet-5-5" },
];

describe("resolveAtlasModelAlias", () => {
  it("maps a family name to the first advertised slug of that family", () => {
    expect(resolveAtlasModelAlias("Sol", codex)).toBe("gpt-6.1-sol");
    expect(resolveAtlasModelAlias("luna", codex)).toBe("gpt-6-luna");
    expect(resolveAtlasModelAlias("opus", claude)).toBe("claude-opus-5-5");
  });

  it("keeps exact slugs and unknown names", () => {
    expect(resolveAtlasModelAlias("gpt-6-sol", codex)).toBe("gpt-6-sol");
    expect(resolveAtlasModelAlias("terra", codex)).toBe("terra");
    expect(resolveAtlasModelAlias("gpt", codex)).toBe("gpt");
  });
});
