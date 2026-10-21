/**
 * Code Atlas: the lines a run added and removed, like Codex's status line.
 * While the run works they are its file edits so far, its subagents' included,
 * each edit counted once; once it finishes, its checkpoint diff replaces them.
 */
import type { OrchestrationV2Checkpoint, OrchestrationV2TurnItem, RunId } from "@t3tools/contracts";
import { DateTime } from "effect";

export interface AtlasLineStats {
  readonly additions: number;
  readonly deletions: number;
}

export const NO_ATLAS_LINES: AtlasLineStats = { additions: 0, deletions: 0 };

function addLines(left: AtlasLineStats, right: AtlasLineStats): AtlasLineStats {
  return {
    additions: left.additions + right.additions,
    deletions: left.deletions + right.deletions,
  };
}

/**
 * The lines of the file edits `include` accepts. An edit re-sent as it
 * progresses keeps one entry per item id, so it is never counted twice.
 */
export function atlasEditLines(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  include: (item: OrchestrationV2TurnItem) => boolean,
): AtlasLineStats {
  const byItem = new Map<string, AtlasLineStats>();
  for (const item of items) {
    if (item.type !== "file_change" || item.status === "failed" || !include(item)) continue;
    byItem.set(item.id, { additions: item.additions ?? 0, deletions: item.deletions ?? 0 });
  }
  let total = NO_ATLAS_LINES;
  for (const lines of byItem.values()) total = addLines(total, lines);
  return total;
}

/** A run's own edits, its native subagents' included (they share its run). */
export function atlasRunEditLines(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runId: RunId,
): AtlasLineStats {
  return atlasEditLines(items, (item) => item.runId === runId);
}

/** A subagent thread's edits since the parent run started. */
export function atlasEditLinesSince(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  sinceMs: number,
): AtlasLineStats {
  return atlasEditLines(
    items,
    (item) => item.startedAt !== null && DateTime.toEpochMillis(item.startedAt) >= sinceMs,
  );
}

export function atlasFileLines(
  files: ReadonlyArray<{ readonly additions: number; readonly deletions: number }>,
): AtlasLineStats {
  return files.reduce<AtlasLineStats>(
    (total, file) => addLines(total, { additions: file.additions, deletions: file.deletions }),
    NO_ATLAS_LINES,
  );
}

/** The diffs a thread's turns captured since `sinceMs`. */
export function atlasCheckpointLinesSince(
  checkpoints: ReadonlyArray<
    Pick<OrchestrationV2Checkpoint, "runId" | "status" | "files" | "capturedAt">
  >,
  sinceMs: number,
): AtlasLineStats {
  return checkpoints.reduce<AtlasLineStats>(
    (total, checkpoint) =>
      checkpoint.runId !== null &&
      checkpoint.status === "ready" &&
      DateTime.toEpochMillis(checkpoint.capturedAt) >= sinceMs
        ? addLines(total, atlasFileLines(checkpoint.files))
        : total,
    NO_ATLAS_LINES,
  );
}

export interface AtlasSubagentLines {
  /** Its edits so far, live. */
  readonly edits: AtlasLineStats;
  /** What its finished turns' checkpoints captured. */
  readonly checkpoints: AtlasLineStats;
  /** Working in the parent's checkout, whose checkpoint then holds its edits. */
  readonly sharesCheckout: boolean;
}

/**
 * The run's total. Working: every edit so far, the parent's and each
 * subagent's. Finished: the parent's checkpoint, taken on the shared working
 * tree, plus the checkpoints of subagents that worked in their own worktree.
 */
export function atlasRunLines(input: {
  readonly working: boolean;
  readonly runEdits: AtlasLineStats;
  readonly runCheckpoint: AtlasLineStats | null;
  readonly subagents: ReadonlyArray<AtlasSubagentLines>;
}): AtlasLineStats {
  if (input.working || input.runCheckpoint === null) {
    return input.subagents.reduce(
      (total, subagent) => addLines(total, subagent.edits),
      input.runEdits,
    );
  }
  return input.subagents.reduce(
    (total, subagent) => (subagent.sharesCheckout ? total : addLines(total, subagent.checkpoints)),
    input.runCheckpoint,
  );
}
