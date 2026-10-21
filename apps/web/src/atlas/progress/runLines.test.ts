import { type OrchestrationV2TurnItem, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { atlasEditLinesSince, atlasRunEditLines, atlasRunLines } from "./runLines";

const run = RunId.make("run-1");
const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 21) + seconds * 1000);
const edit = (
  id: string,
  lines: { additions?: number; deletions?: number },
  overrides: {
    runId?: RunId | null;
    status?: "inProgress" | "completed" | "failed";
    start?: number;
  } = {},
): OrchestrationV2TurnItem =>
  ({
    id: TurnItemId.make(id),
    type: "file_change",
    threadId: ThreadId.make("thread-1"),
    runId: overrides.runId === undefined ? run : overrides.runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: overrides.status ?? "completed",
    title: null,
    startedAt: at(overrides.start ?? 10),
    completedAt: null,
    updatedAt: at(overrides.start ?? 10),
    fileName: `${id}.ts`,
    ...lines,
  }) as OrchestrationV2TurnItem;

describe("live run lines", () => {
  it("adds each edit of the run once, as it streams in", () => {
    const items = [
      edit("a", { additions: 3, deletions: 1 }, { status: "inProgress" }),
      edit("b", { additions: 5 }),
      // The same edit re-sent as it completes replaces its earlier entry.
      edit("a", { additions: 4, deletions: 1 }),
      edit("failed", { additions: 100 }, { status: "failed" }),
      edit("other-run", { additions: 100 }, { runId: RunId.make("run-0") }),
    ];
    expect(atlasRunEditLines(items, run)).toEqual({ additions: 9, deletions: 1 });
  });

  it("counts a subagent thread's edits since the run started", () => {
    const items = [
      edit("before", { additions: 50 }, { start: 1 }),
      edit("after", { deletions: 2 }),
    ];
    expect(atlasEditLinesSince(items, DateTime.toEpochMillis(at(5)))).toEqual({
      additions: 0,
      deletions: 2,
    });
  });

  it("sums every edit while working, then counts subagent work once from checkpoints", () => {
    const subagents = [
      {
        edits: { additions: 4, deletions: 1 },
        checkpoints: { additions: 4, deletions: 1 },
        sharesCheckout: true,
      },
      {
        edits: { additions: 6, deletions: 3 },
        checkpoints: { additions: 7, deletions: 3 },
        sharesCheckout: false,
      },
    ];
    const runEdits = { additions: 10, deletions: 2 };
    expect(atlasRunLines({ working: true, runEdits, runCheckpoint: null, subagents })).toEqual({
      additions: 20,
      deletions: 6,
    });
    // The parent's checkpoint already holds the subagent that shared its checkout.
    expect(
      atlasRunLines({
        working: false,
        runEdits,
        runCheckpoint: { additions: 15, deletions: 3 },
        subagents,
      }),
    ).toEqual({ additions: 22, deletions: 6 });
    // Finished but not captured yet: the edits stand in for the checkpoint.
    expect(atlasRunLines({ working: false, runEdits, runCheckpoint: null, subagents })).toEqual({
      additions: 20,
      deletions: 6,
    });
  });
});
