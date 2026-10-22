/**
 * Code Atlas: each agent's own colors, the one source for usage bars, chart
 * lines, legends and limits: Claude's coral and the blue-to-violet of the
 * Codex app icon.
 */
export const CLAUDE_COLOR = "#d97757";
export const CODEX_GRADIENT_STOPS = ["#4f7cff", "#8b5cf6"] as const;
/** The gradient's midpoint, for places that take one flat color (hatching, `color-mix`). */
export const CODEX_COLOR = "#6d6cfb";
const CODEX_FILL = `linear-gradient(90deg, ${CODEX_GRADIENT_STOPS[0]}, ${CODEX_GRADIENT_STOPS[1]})`;

type AtlasProvider = "claude" | "codex";

/** Accepts a provider driver (`claudeAgent`), usage kind (`claude`) or display label. */
export function atlasProvider(provider: string): AtlasProvider | null {
  const key = provider.toLowerCase();
  if (key.startsWith("claude")) return "claude";
  if (key === "codex") return "codex";
  return null;
}

/** Background for a usage bar, by provider driver or display label; null keeps the default. */
export function atlasProviderFill(provider: string): string | null {
  const kind = atlasProvider(provider);
  return kind === "claude" ? CLAUDE_COLOR : kind === "codex" ? CODEX_FILL : null;
}

/** Stops for an SVG gradient, or null for a provider painted with one flat color. */
export function atlasProviderGradient(provider: string): readonly [string, string] | null {
  return atlasProvider(provider) === "codex" ? CODEX_GRADIENT_STOPS : null;
}
