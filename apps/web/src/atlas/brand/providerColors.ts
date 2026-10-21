/**
 * Code Atlas: usage bars in each agent's own colors: Claude's coral and the
 * blue-to-violet of the Codex app icon.
 */
const CLAUDE_FILL = "#d97757";
const CODEX_FILL = "linear-gradient(90deg, #4f7cff, #8b5cf6)";

/** Background for a usage bar, by provider driver or display label; null keeps the default. */
export function atlasProviderFill(provider: string): string | null {
  const key = provider.toLowerCase();
  if (key === "claudeagent" || key.startsWith("claude")) return CLAUDE_FILL;
  if (key === "codex") return CODEX_FILL;
  return null;
}
