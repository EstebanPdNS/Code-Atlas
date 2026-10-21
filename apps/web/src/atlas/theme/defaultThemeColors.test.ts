// @effect-diagnostics nodeBuiltinImport:off - reads atlas.css, which Vitest serves empty as a module.
import * as NodeFS from "node:fs";

import { htmlRenderTheme } from "@t3tools/shared/htmlRender";
import type { ThemeColorRole } from "@t3tools/shared/themePalettes";
import { describe, expect, it } from "vite-plus/test";

import { themeColorToHex } from "../../themePalette";
import { atlasDefaultThemeColors } from "./defaultThemeColors";

const ATLAS_CSS = NodeFS.readFileSync(new URL("../atlas.css", import.meta.url), "utf8");

function cssTokens(selector: string) {
  const start = ATLAS_CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing ${selector} in atlas.css`);
  const block = ATLAS_CSS.slice(start, ATLAS_CSS.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]),
  );
}

// The roles agent pages read, against the atlas.css token each one mirrors.
const MIRRORED: ReadonlyArray<readonly [ThemeColorRole, string]> = [
  ["canvas", "--background"],
  ["text", "--foreground"],
  ["surface", "--card"],
  ["surfaceOverlay", "--popover"],
  ["secondary", "--secondary"],
  ["secondaryForeground", "--secondary-foreground"],
  ["muted", "--muted"],
  ["mutedForeground", "--muted-foreground"],
  ["border", "--border"],
  ["input", "--input"],
  ["focus", "--ring"],
  ["codeBackground", "--code-background"],
];

describe("atlasDefaultThemeColors", () => {
  it.each([
    ["dark", "html.dark:not([data-theme-id])"],
    ["light", "html:not(.dark):not([data-theme-id])"],
  ] as const)("mirrors the atlas.css default theme in %s mode", (appearance, selector) => {
    const tokens = cssTokens(selector);
    const colors = atlasDefaultThemeColors(appearance);

    for (const [role, token] of MIRRORED) {
      expect(colors[role], `${role} (${token})`).toBe(tokens[token]);
      // The render hook converts every color to hex; it must not drift.
      expect(themeColorToHex(colors[role]), role).toBe(tokens[token]);
    }
  });

  it("gives agent pages the warm graphite thread instead of the upstream black", () => {
    const theme = htmlRenderTheme(atlasDefaultThemeColors("dark"), "dark");

    expect(theme.variables["--background"]).toBe("#262624");
    expect(theme.variables["--foreground"]).toBe("#ecebe6");
  });

  it("returns a stable snapshot per appearance", () => {
    expect(atlasDefaultThemeColors("dark")).toBe(atlasDefaultThemeColors("dark"));
    expect(atlasDefaultThemeColors("light")).not.toBe(atlasDefaultThemeColors("dark"));
  });
});
