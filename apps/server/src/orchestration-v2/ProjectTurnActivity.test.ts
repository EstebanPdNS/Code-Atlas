import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
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
  overrides: {
    readonly archivedAt?: DateTime.Utc;
    readonly deletedAt?: DateTime.Utc;
    readonly subagentOf?: ThreadId;
    readonly worktreePath?: string;
  } = {},
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
    worktreePath: overrides.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage:
      overrides.subagentOf === undefined
        ? { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId }
        : {
            parentThreadId: overrides.subagentOf,
            relationshipToParent: "subagent",
            rootThreadId: overrides.subagentOf,
          },
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

/** A run still working, with one edit per entry of `edits` so far. */
const workingRun = (
  threadId: ThreadId,
  edits: ReadonlyArray<string>,
): ReadonlyArray<OrchestrationV2DomainEvent> => {
  ordinal += 1;
  const runId = RunId.make(`run:${threadId}:${ordinal}`);
  const nodeId = NodeId.make(`node:${threadId}:${ordinal}`);
  const at = daysAgo(0);
  return [
    {
      id: EventId.make(`run:${ordinal}`),
      type: "run.created",
      threadId,
      runId,
      nodeId,
      providerInstanceId,
      occurredAt: at,
      payload: {
        id: runId,
        threadId,
        ordinal,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
        providerThreadId: null,
        userMessageId: MessageId.make(`message:${ordinal}`),
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: "running",
        requestedAt: at,
        startedAt: at,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
    ...edits.map((diffStr, index): OrchestrationV2DomainEvent => ({
      id: EventId.make(`edit:${ordinal}:${index}`),
      type: "turn-item.updated",
      threadId,
      runId,
      nodeId,
      providerInstanceId,
      occurredAt: at,
      payload: {
        id: TurnItemId.make(`edit:${ordinal}:${index}`),
        threadId,
        runId,
        nodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: index + 1,
        status: "completed",
        title: null,
        startedAt: at,
        completedAt: at,
        updatedAt: at,
        type: "file_change",
        fileName: `src/edit-${index}.ts`,
        diffStr,
      },
    })),
  ];
};

/** A finished run in a project without git: no checkpoint diff, only the agent's own work. */
const plainRun = (
  threadId: ThreadId,
  input: {
    readonly minutes: number;
    readonly edits: ReadonlyArray<readonly [fileName: string, diffStr: string]>;
    readonly commands: number;
    readonly reads: ReadonlyArray<string>;
  },
): ReadonlyArray<OrchestrationV2DomainEvent> => {
  ordinal += 1;
  const runId = RunId.make(`run:${threadId}:${ordinal}`);
  const nodeId = NodeId.make(`node:${threadId}:${ordinal}`);
  const startedAt = daysAgo(1);
  const completedAt = DateTime.makeUnsafe(NOW - 24 * 60 * 60 * 1000 + input.minutes * 60 * 1000);
  const base = (index: number, title: string | null) => ({
    id: TurnItemId.make(`plain:${ordinal}:${index}`),
    threadId,
    runId,
    nodeId,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: index + 1,
    status: "completed" as const,
    title,
    startedAt,
    completedAt,
    updatedAt: completedAt,
  });
  const items = [
    ...input.edits.map(([fileName, diffStr]) => ({
      type: "file_change" as const,
      fileName,
      diffStr,
    })),
    ...Array.from({ length: input.commands }, () => ({
      type: "command_execution" as const,
      input: "make",
    })),
    ...input.reads.map((path) => ({
      type: "dynamic_tool" as const,
      readTitle: `Read ${path}`,
      toolName: "Read",
      input: { file_path: path },
    })),
  ];
  return [
    {
      id: EventId.make(`run:${ordinal}`),
      type: "run.created",
      threadId,
      runId,
      nodeId,
      providerInstanceId,
      occurredAt: startedAt,
      payload: {
        id: runId,
        threadId,
        ordinal,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
        providerThreadId: null,
        userMessageId: MessageId.make(`message:${ordinal}`),
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: "completed",
        requestedAt: startedAt,
        startedAt,
        completedAt,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
    ...items.map((item, index): OrchestrationV2DomainEvent => {
      const { readTitle, ...fields } = item as typeof item & { readonly readTitle?: string };
      return {
        id: EventId.make(`plain:${ordinal}:${index}`),
        type: "turn-item.updated",
        threadId,
        runId,
        nodeId,
        providerInstanceId,
        occurredAt: completedAt,
        payload: { ...base(index, readTitle ?? null), ...fields } as never,
      };
    }),
  ];
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
        Option.some({
          turns: 3,
          linesAdded: 22,
          linesRemoved: 7,
          filesChanged: 2,
          filesRead: 0,
          commands: 0,
          threads: 0,
          agentSeconds: 0,
        }),
      );
      assert.deepStrictEqual(
        yield* activity.weekly("/work/other"),
        Option.some({
          turns: 1,
          linesAdded: 999,
          linesRemoved: 999,
          filesChanged: 1,
          filesRead: 0,
          commands: 0,
          threads: 0,
          agentSeconds: 0,
        }),
      );
      assert.isTrue(Option.isNone(yield* activity.weekly("/work/unknown")));
      // Every project at once (the Usage page): one file path per project.
      assert.deepStrictEqual(
        Option.map(yield* activity.weekly(null), (week) => ({
          turns: week.turns,
          linesAdded: week.linesAdded,
          linesRemoved: week.linesRemoved,
          filesChanged: week.filesChanged,
        })),
        Option.some({ turns: 4, linesAdded: 1021, linesRemoved: 1006, filesChanged: 3 }),
      );
    }),
  );

  it.effect("counts a subagent's work once and a working run's edits so far", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const activity = yield* ProjectTurnActivity.ProjectTurnActivity;
      const project = ProjectId.make("project:subagents");
      yield* createProject(project, "/work/subagents");

      const parent = ThreadId.make("thread:parent");
      const shared = ThreadId.make("thread:shared-subagent");
      const isolated = ThreadId.make("thread:worktree-subagent");
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(parent, project),
        // The parent's checkpoint was taken on the checkout both edited.
        checkpoint(parent, { daysAgo: 1, lines: [[10, 2]] }),
        thread(shared, project, { subagentOf: parent }),
        checkpoint(shared, { daysAgo: 1, lines: [[4, 1]] }),
        // A subagent in its own worktree is not in the parent's checkpoint.
        thread(isolated, project, { subagentOf: parent, worktreePath: "/work/trees/one" }),
        checkpoint(isolated, { daysAgo: 1, lines: [[6, 3]] }),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });
      assert.deepStrictEqual(
        yield* activity.weekly("/work/subagents"),
        Option.some({
          turns: 2,
          linesAdded: 16,
          linesRemoved: 5,
          filesChanged: 1,
          filesRead: 0,
          commands: 0,
          threads: 0,
          agentSeconds: 0,
        }),
      );

      // Working now: the parent and a subagent are editing, before any checkpoint.
      yield* Effect.forEach(
        [
          ...workingRun(parent, ["@@ -1 +1,2 @@\n-a\n+b\n+c"]),
          ...workingRun(shared, ["@@ -1 +1 @@\n-x\n+y"]),
        ],
        projections.apply,
        { discard: true },
      );
      assert.deepStrictEqual(
        yield* activity.weekly("/work/subagents"),
        Option.some({
          turns: 4,
          linesAdded: 19,
          linesRemoved: 7,
          filesChanged: 2,
          filesRead: 0,
          commands: 0,
          threads: 1,
          agentSeconds: 0,
        }),
      );
    }),
  );
  it.effect("reads a project without git from the agents' own work", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const activity = yield* ProjectTurnActivity.ProjectTurnActivity;
      const project = ProjectId.make("project:plain");
      yield* createProject(project, "/work/plain");
      const main = ThreadId.make("thread:plain");
      const helper = ThreadId.make("thread:plain-subagent");
      yield* Effect.forEach(
        [
          thread(main, project),
          // Without git the checkpoint records no files.
          checkpoint(main, { daysAgo: 1, lines: [] }),
          ...plainRun(main, {
            minutes: 10,
            edits: [
              ["/work/plain/src/game.cpp", "@@ -1 +1,3 @@\n-a\n+b\n+c\n+d"],
              ["/work/plain/src/game.cpp", "@@ -4 +4 @@\n-e\n+f"],
              ["/work/plain/README.md", "@@ -0,0 +1,2 @@\n+# Title\n+Text"],
            ],
            commands: 3,
            reads: ["/work/plain/src/game.cpp", "/work/plain/notes.md"],
          }),
          // A subagent's edits and commands count; its time is inside its parent's run.
          thread(helper, project, { subagentOf: main }),
          ...plainRun(helper, {
            minutes: 4,
            edits: [["/work/plain/src/audio.cpp", "@@ -1 +1 @@\n-x\n+y"]],
            commands: 2,
            reads: ["/work/plain/notes.md"],
          }),
        ],
        projections.apply,
        { discard: true },
      );
      assert.deepStrictEqual(
        yield* activity.weekly("/work/plain"),
        Option.some({
          turns: 2,
          linesAdded: 7,
          linesRemoved: 3,
          filesChanged: 3,
          filesRead: 2,
          commands: 5,
          threads: 1,
          agentSeconds: 600,
        }),
      );
    }),
  );
});
