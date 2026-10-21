import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";

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
  // Codex's estimated rows borrow the closest Claude color.
  "System prompt & tools": "#3fb37f",
  "Code Atlas instructions": "#9b7be0",
};

/** Claude's /context row for what the conversation added since its breakdown. */
export const SINCE_LAST_UPDATE = "Since last update";

export interface ContextRow {
  readonly name: string;
  readonly tokens: number;
  readonly kind: "used" | "free" | "buffer" | "deferred";
  /** Code Atlas's estimate rather than the provider's count. */
  readonly estimated?: boolean;
}

export interface TonedContextRow extends ContextRow {
  /** A Tailwind background class; empty when `color` paints the row. */
  readonly tone: string;
  readonly color: string | null;
}

type ContextBreakdownInput = Pick<
  ContextWindowSnapshot,
  | "contextCategories"
  | "contextBreakdownTotalTokens"
  | "contextEstimated"
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
    const rows: ContextRow[] = contextWindow.contextCategories
      .filter((row) => row.tokens > 0 || row.kind === "free")
      .map((row) =>
        contextWindow.contextEstimated === true && row.kind === "used"
          ? { ...row, estimated: true }
          : row,
      )
      .toSorted(
        (left, right) => Number(left.kind === "deferred") - Number(right.kind === "deferred"),
      );
    // Usage keeps arriving between breakdowns; what it added is its own row,
    // after the used rows.
    const sinceLastUpdate =
      contextWindow.contextBreakdownTotalTokens === undefined
        ? 0
        : Math.round(contextWindow.usedTokens - contextWindow.contextBreakdownTotalTokens);
    if (sinceLastUpdate > 0) {
      const lastUsed = rows.findLastIndex((row) => row.kind === "used");
      rows.splice(lastUsed + 1, 0, {
        name: SINCE_LAST_UPDATE,
        tokens: sinceLastUpdate,
        kind: "used",
      });
    }
    return rows;
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
  if (row.name === SINCE_LAST_UPDATE) return "bg-muted-foreground/60";
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

/** A row's tokens, with "≈" when Code Atlas estimated them. */
export function formatContextRowTokens(row: Pick<ContextRow, "tokens" | "estimated">): string {
  return `${row.estimated === true ? "≈" : ""}${formatContextWindowTokens(row.tokens)}`;
}
