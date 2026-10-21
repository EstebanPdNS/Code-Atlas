import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectTurnActivity from "./ProjectTurnActivity.ts";

const layerTest = Layer.mergeAll(
  ProjectTurnActivity.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const NOW = Date.UTC(2026, 9, 21, 12);
const daysAgo = (days: number) => DateTime.makeUnsafe(NOW - days * 24 * 60 * 60 * 1000);

const createProject = (projectId: ProjectId, workspaceRoot: string) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(daysAgo(30)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(daysAgo(30)),
        updatedAt: DateTime.formatIso(daysAgo(30)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: { readonly archivedAt?: DateTime.Utc; readonly deletedAt?: DateTime.Utc } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: daysAgo(30),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

let ordinal = 0;
const checkpoint = (
  threadId: ThreadId,
  input: {
    readonly daysAgo: number;
    readonly lines: ReadonlyArray<readonly [additions: number, deletions: number]>;
    readonly baseline?: boolean;
    readonly status?: OrchestrationV2Checkpoint["status"];
  },
): OrchestrationV2DomainEvent => {
  ordinal += 1;
  const runId = input.baseline === true ? null : RunId.make(`run:${threadId}:${ordinal}`);
  const nodeId = NodeId.make(`node:${threadId}:${ordinal}`);
  return {
    id: EventId.make(`checkpoint:${ordinal}`),
    type: "checkpoint.captured",
    threadId,
    ...(runId === null ? {} : { runId }),
    nodeId,
    providerInstanceId,
    occurredAt: daysAgo(input.daysAgo),
    payload: {
      id: CheckpointId.make(`checkpoint:${ordinal}`),
      threadId,
      scopeId: CheckpointScopeId.make(`scope:${threadId}`),
      runId,
      nodeId,
      parentCheckpointId: null,
      ordinalWithinScope: ordinal,
      appRunOrdinal: runId === null ? null : ordinal,
      ref: CheckpointRef.make(`refs/t3/checkpoints/${ordinal}`),
      status: input.status ?? "ready",
      files: input.lines.map(([additions, deletions], index) => ({
        path: `src/file-${index}.ts`,
        kind: "modified",
        additions,
        deletions,
      })),
      capturedAt: daysAgo(input.daysAgo),
    },
  };
};

it.layer(layerTest)("ProjectTurnActivity", (it) => {
  it.effect("sums this week's turn diffs for the project's live threads", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const activity = yield* ProjectTurnActivity.ProjectTurnActivity;
      const project = ProjectId.make("project:atlas");
      const other = ProjectId.make("project:other");
      yield* createProject(project, "/work/atlas");
      yield* createProject(other, "/work/other");

      const active = ThreadId.make("thread:active");
      const archived = ThreadId.make("thread:archived");
      const deleted = ThreadId.make("thread:deleted");
      const elsewhere = ThreadId.make("thread:elsewhere");
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(active, project),
        checkpoint(active, {
          daysAgo: 1,
          lines: [
            [10, 2],
            [5, 0],
          ],
        }),
        checkpoint(active, { daysAgo: 6, lines: [[3, 1]] }),
        // Outside the seven-day window.
        checkpoint(active, { daysAgo: 8, lines: [[100, 100]] }),
        // A baseline is a starting point, not a turn's diff.
        checkpoint(active, { daysAgo: 1, lines: [[50, 50]], baseline: true }),
        // A turn that changed nothing, and one that was rolled back.
        checkpoint(active, { daysAgo: 1, lines: [] }),
        checkpoint(active, { daysAgo: 1, lines: [[7, 7]], status: "stale" }),
        // Archiving a thread keeps its work.
        thread(archived, project, { archivedAt: daysAgo(0) }),
        checkpoint(archived, { daysAgo: 2, lines: [[4, 4]] }),
        thread(deleted, project, { deletedAt: daysAgo(0) }),
        checkpoint(deleted, { daysAgo: 2, lines: [[1000, 0]] }),
        thread(elsewhere, other),
        checkpoint(elsewhere, { daysAgo: 1, lines: [[999, 999]] }),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      assert.deepStrictEqual(
        yield* activity.weekly("/work/atlas"),
        Option.some({ turns: 3, linesAdded: 22, linesRemoved: 7 }),
      );
      assert.deepStrictEqual(
        yield* activity.weekly("/work/other"),
        Option.some({ turns: 1, linesAdded: 999, linesRemoved: 999 }),
      );
      assert.isTrue(Option.isNone(yield* activity.weekly("/work/unknown")));
    }),
  );
});
