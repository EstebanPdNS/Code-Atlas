/**
 * Code Atlas: the lines one file edit added and removed, so clients can count
 * a run's lines live while it works. Providers rarely report the counts, and
 * the diff they record never reaches clients (see projectTurnItemForWire), so
 * the counts are read from it here.
 */
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

type FileChangeItem = Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>;

export interface FileChangeLineStats {
  readonly additions: number;
  readonly deletions: number;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/** Lines an edit replaced, without the unchanged lines around the change. */
function replacementStats(oldText: string, newText: string): FileChangeLineStats {
  const before = oldText.length === 0 ? [] : oldText.split("\n");
  const after = newText.length === 0 ? [] : newText.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return { additions: after.length - start - end, deletions: before.length - start - end };
}

function unifiedDiffStats(lines: ReadonlyArray<unknown>): FileChangeLineStats {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (typeof line !== "string") continue;
    if (line.startsWith("+") && !line.startsWith("+++ ")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("--- ")) deletions += 1;
  }
  return { additions, deletions };
}

function sum(stats: ReadonlyArray<FileChangeLineStats | null>): FileChangeLineStats | null {
  const known = stats.filter((entry): entry is FileChangeLineStats => entry !== null);
  if (known.length === 0) return null;
  return {
    additions: known.reduce((total, entry) => total + entry.additions, 0),
    deletions: known.reduce((total, entry) => total + entry.deletions, 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Claude Code's Edit, MultiEdit and Write results, as recorded in the diff. */
function toolResultStats(value: Record<string, unknown>): FileChangeLineStats | null {
  const patch = value.structuredPatch;
  if (Array.isArray(patch) && patch.length > 0) {
    return sum(
      patch.map((hunk) =>
        isRecord(hunk) && Array.isArray(hunk.lines) ? unifiedDiffStats(hunk.lines) : null,
      ),
    );
  }
  if (typeof value.oldString === "string" && typeof value.newString === "string") {
    return replacementStats(value.oldString, value.newString);
  }
  if (Array.isArray(value.edits)) {
    return sum(
      value.edits.map((edit) =>
        isRecord(edit) && typeof edit.old_string === "string" && typeof edit.new_string === "string"
          ? replacementStats(edit.old_string, edit.new_string)
          : null,
      ),
    );
  }
  if (value.type === "create" && typeof value.content === "string") {
    return { additions: lineCount(value.content), deletions: 0 };
  }
  return null;
}

const UNIFIED_DIFF = /^(?:@@ |\+\+\+ |--- )/mu;

function diffTextStats(diff: string): FileChangeLineStats | null {
  const trimmed = diff.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) return toolResultStats(parsed);
    } catch {
      // Not JSON: fall through to a unified diff.
    }
  }
  return UNIFIED_DIFF.test(diff) ? unifiedDiffStats(diff.split("\n")) : null;
}

/**
 * The counts the provider reported, else the ones its recorded diff shows.
 * A failed edit changed nothing; an unreadable diff counts as unknown.
 */
export function fileChangeLineStats(item: FileChangeItem): FileChangeLineStats | null {
  if (item.status === "failed") return null;
  if (item.additions !== undefined || item.deletions !== undefined) {
    return { additions: item.additions ?? 0, deletions: item.deletions ?? 0 };
  }
  if (item.diffStr !== undefined && item.diffStr.trim().length > 0) {
    const fromDiff = diffTextStats(item.diffStr);
    if (fromDiff !== null) return fromDiff;
  }
  if (item.oldStr !== undefined || item.newStr !== undefined) {
    return replacementStats(item.oldStr ?? "", item.newStr ?? "");
  }
  return null;
}
