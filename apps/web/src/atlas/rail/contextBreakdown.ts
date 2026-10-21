import type { ContextWindowSnapshot } from "~/lib/contextWindow";

// Fixed colors for the breakdown, in the order rows appear (Claude's /context: messages,
// system tools, system prompt, then smaller rows); the reserve and free space stay neutral.
const CONTEXT_ROW_TONES = [
  "bg-info",
  "bg-primary",
  "bg-success",
  "bg-warning",
  "bg-muted-foreground/80",
  "bg-muted-foreground/60",
  "bg-muted-foreground/45",
];

// Claude Code's own /context colors for its categories.
const CLAUDE_CATEGORY_COLORS: Readonly<Record<string, string>> = {
  Messages: "#5b8def",
  "System tools": "#d97757",
  "System prompt": "#3fb37f",
  Skills: "#d6a33a",
  "Memory files": "#e0679a",
  "MCP tools": "#9b7be0",
  "Custom agents": "#3fb7b0",
};

export interface ContextRow {
  readonly name: string;
  readonly tokens: number;
  readonly kind: "used" | "free" | "buffer" | "deferred";
}

export interface TonedContextRow extends ContextRow {
  /** A Tailwind background class; empty when `color` paints the row. */
  readonly tone: string;
  readonly color: string | null;
}

type ContextBreakdownInput = Pick<
  ContextWindowSnapshot,
  | "contextCategories"
  | "cachedInputTokens"
  | "inputTokens"
  | "outputTokens"
  | "reasoningOutputTokens"
  | "usedTokens"
>;

/** The provider's own categories, or what every provider reports: input, cache, output. */
export function contextRows(contextWindow: ContextBreakdownInput, maxTokens: number): ContextRow[] {
  if (contextWindow.contextCategories && contextWindow.contextCategories.length > 0) {
    // Like Claude Code's /context: what fills the window first, deferred tools last.
    return contextWindow.contextCategories
      .filter((row) => row.tokens > 0 || row.kind === "free")
      .toSorted(
        (left, right) => Number(left.kind === "deferred") - Number(right.kind === "deferred"),
      );
  }
  const cached = contextWindow.cachedInputTokens ?? 0;
  const input = Math.max(0, (contextWindow.inputTokens ?? 0) - cached);
  const rows: ContextRow[] = [
    { name: "Input", tokens: input, kind: "used" },
    { name: "Cached input", tokens: cached, kind: "used" },
    { name: "Output", tokens: contextWindow.outputTokens ?? 0, kind: "used" },
    { name: "Reasoning", tokens: contextWindow.reasoningOutputTokens ?? 0, kind: "used" },
  ];
  return [
    ...rows.filter((row) => row.tokens > 0),
    { name: "Free space", tokens: Math.max(0, maxTokens - contextWindow.usedTokens), kind: "free" },
  ];
}

function contextRowTone(row: ContextRow, usedIndex: number): string {
  if (row.kind === "free") return "bg-foreground/10";
  if (row.kind === "buffer") return "bg-muted-foreground/30";
  if (row.kind === "deferred") return "bg-muted-foreground/20";
  if (CLAUDE_CATEGORY_COLORS[row.name] !== undefined) return "";
  return CONTEXT_ROW_TONES[Math.min(usedIndex, CONTEXT_ROW_TONES.length - 1)]!;
}

export function withContextTones(rows: readonly ContextRow[]): TonedContextRow[] {
  const usedRows = rows.filter((row) => row.kind === "used");
  return rows.map((row) => ({
    ...row,
    tone: contextRowTone(row, usedRows.indexOf(row)),
    color: row.kind === "used" ? (CLAUDE_CATEGORY_COLORS[row.name] ?? null) : null,
  }));
}

export function formatContextShare(tokens: number, maxTokens: number): string {
  return `${((tokens / maxTokens) * 100).toFixed(1)}%`;
}
