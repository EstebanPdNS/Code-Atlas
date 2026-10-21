import { describe, expect, it } from "vite-plus/test";

import { ATLAS_TYPEFACES, resolveAtlasTypeface } from "./appearanceFonts";

describe("resolveAtlasTypeface", () => {
  it("recognises the Code Atlas and Claude style presets", () => {
    expect(resolveAtlasTypeface({ sans: "", composer: "" })).toBe("atlas");
    expect(
      resolveAtlasTypeface({
        sans: ATLAS_TYPEFACES.claude.sans,
        composer: ATLAS_TYPEFACES.claude.composer,
      }),
    ).toBe("claude");
  });

  it("calls any other pairing custom", () => {
    expect(resolveAtlasTypeface({ sans: "Inter", composer: "" })).toBe("custom");
    expect(resolveAtlasTypeface({ sans: "system-ui", composer: "" })).toBe("custom");
  });
});
