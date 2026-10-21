import { htmlRenderTheme } from "@t3tools/shared/htmlRender";
import { useSyncExternalStore } from "react";

import {
  appearanceFontStack,
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
} from "../appearanceFonts";
// Code Atlas: agent pages follow the default theme's atlas.css colors.
import {
  ATLAS_DEFAULT_THEME_RADIUS,
  atlasDefaultThemeColors,
} from "../atlas/theme/defaultThemeColors";
import {
  getThemeColorsForMode,
  getThemeDefinition,
  resolveThemeHalf,
  subscribeToCustomThemes,
  themeColorToHex,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreference,
} from "../themePalette";
import { useClientSettings } from "./useSettings";
import { useTheme } from "./useTheme";

function resolveActiveThemeColors(
  theme: ThemePreference,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
) {
  const definition = getThemeDefinition(resolveThemeHalf(theme, halves, appearance));
  return definition === null
    ? // Code Atlas: atlas.css restyles the default theme; the upstream palette is #0a0a0a.
      atlasDefaultThemeColors(appearance)
    : (getThemeColorsForMode(definition, appearance) ?? definition.colors);
}

export function useHtmlRenderTheme() {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  // Custom and published palettes can be edited in place, under an unchanged preference.
  const colors = useSyncExternalStore(
    subscribeToCustomThemes,
    () => resolveActiveThemeColors(theme, themeHalves, resolvedTheme),
    // Code Atlas: the default theme's atlas.css colors, as above.
    () => atlasDefaultThemeColors(resolvedTheme),
  );
  const sans = useClientSettings((settings) => settings.fontFamilySans);
  const mono = useClientSettings((settings) => settings.fontFamilyCode);
  const renderTheme = htmlRenderTheme(
    Object.fromEntries(
      Object.entries(colors).map(([role, color]) => [role, themeColorToHex(color) ?? color]),
    ) as typeof colors,
    resolvedTheme,
    // Code Atlas: the app's own faces (the console monospace unless Appearance
    // sets one), not the upstream system sans.
    {
      sans: appearanceFontStack(sans, DEFAULT_SANS_FONT_STACK),
      mono: appearanceFontStack(mono, DEFAULT_CODE_FONT_STACK),
    },
  );
  // Code Atlas: the default theme's rounder corners, as in atlas.css.
  return colors === atlasDefaultThemeColors(resolvedTheme)
    ? {
        ...renderTheme,
        variables: { ...renderTheme.variables, "--radius": ATLAS_DEFAULT_THEME_RADIUS },
      }
    : renderTheme;
}
