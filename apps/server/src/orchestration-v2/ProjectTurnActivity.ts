/**
 * Code Atlas: the lines a project's turns changed this week, summed from the
 * checkpoint each turn captures, plus the edits of runs still working. Unlike
 * git history, this needs no repository, no commit and no matching author email.
 */
import { NonNegativeInt, type TurnWeeklyActivityResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { type FileChangeLineStats, fileChangeLineStats } from "./AtlasFileChangeStats.ts";

const WEEK = Duration.days(7);

const WeeklyRequest = Schema.Struct({ workspaceRoot: Schema.String, since: Schema.String });
const WeeklyRow = Schema.Struct({
  turns: NonNegativeInt,
  linesAdded: NonNegativeInt,
  linesRemoved: NonNegativeInt,
});
const LiveEditsRequest = Schema.Struct({ workspaceRoot: Schema.String });
const LiveEditRow = Schema.Struct({ payload: Schema.String });

function liveEditStats(payload: string): FileChangeLineStats | null {
  try {
    const item: unknown = JSON.parse(payload);
    return typeof item === "object" && item !== null
      ? fileChangeLineStats(item as Parameters<typeof fileChangeLineStats>[0])
      : null;
  } catch {
    return null;
  }
}

export class ProjectTurnActivity extends Context.Service<
  ProjectTurnActivity,
  {
    /**
     * Turns in the last seven days whose checkpoint changed files, across the
     * live threads of the active projects rooted at `workspaceRoot`. None when
     * there are none, or when the projection cannot be read.
     */
    readonly weekly: (
      workspaceRoot: string,
    ) => Effect.Effect<Option.Option<TurnWeeklyActivityResult>>;
  }
>()("t3/orchestration-v2/ProjectTurnActivity") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Only a run's own ready checkpoint is a turn's diff: baselines have no run,
  // and a rolled-back turn's checkpoint turns stale. Joining the file list
  // drops checkpoints that changed nothing. A subagent's thread that works in
  // its parent's checkout is skipped: the parent's checkpoint, captured on the
  // same working tree, already holds its edits.
  const selectWeekly = SqlSchema.findOne({
    Request: WeeklyRequest,
    Result: WeeklyRow,
    execute: ({ workspaceRoot, since }) => sql`
      SELECT
        COUNT(DISTINCT checkpoints.checkpoint_id) AS "turns",
        COALESCE(SUM(json_extract(files.value, '$.additions')), 0) AS "linesAdded",
        COALESCE(SUM(json_extract(files.value, '$.deletions')), 0) AS "linesRemoved"
      FROM projection_projects AS projects
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.project_id = projects.project_id
      INNER JOIN orchestration_v2_projection_checkpoints AS checkpoints
        ON checkpoints.thread_id = threads.thread_id
      INNER JOIN json_each(checkpoints.payload_json, '$.files') AS files
      LEFT JOIN orchestration_v2_projection_threads AS parents
        ON json_extract(threads.payload_json, '$.lineage.relationshipToParent') = 'subagent'
        AND parents.thread_id = json_extract(threads.payload_json, '$.lineage.parentThreadId')
      WHERE projects.workspace_root = ${workspaceRoot}
        AND projects.deleted_at IS NULL
        AND threads.deleted_at IS NULL
        AND checkpoints.run_id IS NOT NULL
        AND checkpoints.status = 'ready'
        AND checkpoints.captured_at >= ${since}
        AND (
          parents.thread_id IS NULL
          OR COALESCE(json_extract(threads.payload_json, '$.worktreePath'), '')
            != COALESCE(json_extract(parents.payload_json, '$.worktreePath'), '')
        )
    `,
  });

  // A working run has no checkpoint yet: its edits so far, the subagents'
  // threads included, count until the checkpoint replaces them.
  const selectLiveEdits = SqlSchema.findAll({
    Request: LiveEditsRequest,
    Result: LiveEditRow,
    execute: ({ workspaceRoot }) => sql`
      SELECT items.payload_json AS "payload"
      FROM projection_projects AS projects
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.project_id = projects.project_id
      INNER JOIN orchestration_v2_projection_runs AS runs
        ON runs.thread_id = threads.thread_id
      INNER JOIN orchestration_v2_projection_turn_items AS items
        ON items.thread_id = runs.thread_id AND items.run_id = runs.run_id
      WHERE projects.workspace_root = ${workspaceRoot}
        AND projects.deleted_at IS NULL
        AND threads.deleted_at IS NULL
        AND runs.status IN ('running', 'waiting')
        AND items.type = 'file_change'
    `,
  });

  const weekly = Effect.fn("ProjectTurnActivity.weekly")(function* (workspaceRoot: string) {
    const since = DateTime.formatIso(DateTime.subtractDuration(yield* DateTime.now, WEEK));
    // The card is a glance: an unreadable projection shows no activity rather than an error.
    const read = Effect.gen(function* () {
      const week = yield* selectWeekly({ workspaceRoot, since });
      const live = (yield* selectLiveEdits({ workspaceRoot })).flatMap((row) => {
        const lines = liveEditStats(row.payload);
        return lines === null ? [] : [lines];
      });
      return {
        turns: week.turns,
        linesAdded: live.reduce((total, lines) => total + lines.additions, week.linesAdded),
        linesRemoved: live.reduce((total, lines) => total + lines.deletions, week.linesRemoved),
      } satisfies TurnWeeklyActivityResult;
    });
    const activity = yield* sql.withTransaction(read).pipe(
      NodeSqliteClient.readOnly,
      Effect.asSome,
      Effect.catch((cause) =>
        Effect.logWarning("Code Atlas weekly turn activity read failed", { cause }).pipe(
          Effect.as(Option.none<TurnWeeklyActivityResult>()),
        ),
      ),
    );
    return Option.filter(
      activity,
      (week) => week.turns > 0 || week.linesAdded > 0 || week.linesRemoved > 0,
    );
  });

  return ProjectTurnActivity.of({ weekly });
});

export const layer = Layer.effect(ProjectTurnActivity, make);
