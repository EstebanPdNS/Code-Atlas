import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type {
  EnvironmentId,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { DateTime } from "effect";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "~/state/threads";
import type { TurnDiffFileChange } from "~/types";

import {
  type AtlasLineStats,
  type AtlasSubagentLines,
  atlasCheckpointLinesSince,
  atlasEditLinesSince,
  atlasFileLines,
  atlasRunEditLines,
  atlasRunLines,
} from "./runLines";

const NO_SUBAGENT_THREADS = Atom.make<ReadonlyArray<EnvironmentThread | null>>([]);

/** The subagent threads one run started, keyed "environment\nthread\nthread…". */
const subagentThreadsAtom = Atom.family((key: string) => {
  const [environmentId, ...threadIds] = key.split("\n");
  const refs = threadIds.map((threadId) =>
    scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
  );
  return Atom.make((get) => refs.map((ref) => get(environmentThreadDetails.threadAtom(ref))));
});

export interface AtlasLatestRunLines {
  readonly runId: RunId;
  readonly lines: AtlasLineStats;
  /** The run's checkpoint files, once it finished and was captured. */
  readonly files: ReadonlyArray<TurnDiffFileChange> | null;
}

/**
 * Code Atlas: the lines the thread's latest run added and removed, live while
 * it works. Its app-owned subagents run in their own threads, so only those
 * threads are followed, and only for this run.
 */
export function useAtlasRunLines(input: {
  readonly environmentId: EnvironmentId;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly working: boolean;
  readonly checkpoints: ReadonlyArray<ThreadCheckpointSummary>;
}): AtlasLatestRunLines | null {
  const run =
    input.projection?.runs.reduce<OrchestrationV2Run | null>(
      (latest, candidate) =>
        candidate.startedAt !== null && (latest === null || candidate.ordinal > latest.ordinal)
          ? candidate
          : latest,
      null,
    ) ?? null;
  const runId = run?.id ?? null;
  const childThreadIds =
    input.projection === null || runId === null
      ? []
      : [
          ...new Set(
            input.projection.subagents.flatMap((subagent) =>
              subagent.runId === runId && subagent.childThreadId !== null
                ? [subagent.childThreadId]
                : [],
            ),
          ),
        ];
  const childThreads = useAtomValue(
    childThreadIds.length === 0
      ? NO_SUBAGENT_THREADS
      : subagentThreadsAtom([input.environmentId, ...childThreadIds].join("\n")),
  );

  if (input.projection === null || run === null) return null;
  const sinceMs = DateTime.toEpochMillis(run.startedAt ?? run.requestedAt);
  const parentWorktree = input.projection.thread.worktreePath ?? null;
  const subagents = childThreads.flatMap((child): AtlasSubagentLines[] =>
    child === null
      ? []
      : [
          {
            edits: atlasEditLinesSince(child.projection.turnItems, sinceMs),
            checkpoints: atlasCheckpointLinesSince(child.projection.checkpoints, sinceMs),
            sharesCheckout: (child.projection.thread.worktreePath ?? null) === parentWorktree,
          },
        ],
  );
  const checkpoint = input.checkpoints.findLast(
    (summary) => summary.runId === run.id && summary.status === "ready",
  );
  const files = checkpoint === undefined ? null : checkpoint.files;
  return {
    runId: run.id,
    files,
    lines: atlasRunLines({
      working: input.working,
      runEdits: atlasRunEditLines(input.projection.turnItems, run.id),
      runCheckpoint: files === null ? null : atlasFileLines(files),
      subagents,
    }),
  };
}
