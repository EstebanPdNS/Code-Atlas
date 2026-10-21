import type { ThemeAppearance, ThemeColors } from "@t3tools/shared/themePalettes";

import { getStandardThemeColors } from "../../themePalette";

/**
 * The default theme's colors as palette roles, for surfaces that cannot read
 * the CSS tokens: agent pages (html_render, html_preview) and MCP apps run in
 * their own documents and get the theme as values. atlas.css restyles the
 * default theme with CSS alone, so the upstream palette still holds the T3 Code
 * colors (a #0a0a0a page, system sans) that clashed with the thread. Keep these
 * in sync with the default-theme overrides in atlas.css.
 */
const ATLAS_DEFAULT_THEME_OVERRIDES: Readonly<
  Record<ThemeAppearance, Readonly<Partial<ThemeColors>>>
> = {
  dark: {
    canvas: "#262624",
    chrome: "#1c1b19",
    toolbar: "#1f1e1d",
    toolbarForeground: "#ecebe6",
    toolbarBorder: "#34332f",
    toolbarControl: "#30302d",
    toolbarControlForeground: "#ecebe6",
    toolbarControlHover: "#3a3936",
    surface: "#2b2a28",
    surfaceRaised: "#2e2d2b",
    surfaceOverlay: "#30302d",
    text: "#ecebe6",
    textMuted: "#a3a199",
    border: "#3a3935",
    input: "#46443f",
    focus: "#ffad66",
    // The brand orange, deep enough to carry light text: pages often color
    // links with --accent-foreground, so it stays a light ink.
    accent: "#df721f",
    accentForeground: "#ffffff",
    secondary: "#30302d",
    secondaryForeground: "#ecebe6",
    muted: "#2e2d2b",
    mutedForeground: "#a3a199",
    placeholder: "#8a887f",
    secondaryLabel: "#a3a199",
    iconMuted: "#a3a199",
    update: "#ffad66",
    updateForeground: "#ffbf88",
    accentSurface: "#34332f",
    accentSurfaceForeground: "#f4f3ee",
    messageSurface: "#34332f",
    messageForeground: "#ecebe6",
    messageAction: "#ffad66",
    messageActionForeground: "#2a1708",
    messageActionHover: "#f79443",
    codeBackground: "#1f1e1d",
    codeForeground: "#ecebe6",
    terminalBackground: "#1f1e1d",
    terminalForeground: "#ecebe6",
    terminalCursor: "#ffad66",
  },
  light: {
    canvas: "#faf9f5",
    chrome: "#f1efe8",
    toolbar: "#f5f4ee",
    toolbarForeground: "#1f1e1b",
    toolbarBorder: "#e8e6dc",
    toolbarControl: "#ffffff",
    toolbarControlForeground: "#1f1e1b",
    toolbarControlHover: "#efede4",
    surface: "#ffffff",
    surfaceRaised: "#ffffff",
    surfaceOverlay: "#ffffff",
    text: "#1f1e1b",
    textMuted: "#73716a",
    border: "#e6e3d8",
    input: "#d8d5c9",
    focus: "#b4541a",
    accent: "#a84200",
    accentForeground: "#ffffff",
    secondary: "#f0eee6",
    secondaryForeground: "#1f1e1b",
    muted: "#f0eee6",
    mutedForeground: "#73716a",
    update: "#b4541a",
    updateForeground: "#a84200",
    accentSurface: "#efede4",
    accentSurfaceForeground: "#1f1e1b",
    messageSurface: "#f0eee6",
    messageForeground: "#1f1e1b",
    messageAction: "#b4541a",
    messageActionForeground: "#ffffff",
    messageActionHover: "#a84200",
    codeBackground: "#f3f1ea",
    codeForeground: "#1f1e1b",
    terminalBackground: "#faf9f5",
    terminalCursor: "#a84200",
  },
};

/** The default theme's corner radius in atlas.css. */
export const ATLAS_DEFAULT_THEME_RADIUS = "0.75rem";

const cache: Partial<Record<ThemeAppearance, ThemeColors>> = {};

/**
 * Stable per appearance, so it can be a `useSyncExternalStore` snapshot and
 * callers can tell the default theme apart by identity.
 */
export function atlasDefaultThemeColors(appearance: ThemeAppearance): ThemeColors {
  return (cache[appearance] ??= {
    ...getStandardThemeColors(appearance),
    ...ATLAS_DEFAULT_THEME_OVERRIDES[appearance],
  });
}
