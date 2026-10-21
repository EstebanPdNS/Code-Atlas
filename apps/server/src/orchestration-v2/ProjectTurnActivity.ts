/**
 * Code Atlas: the lines a project's turns changed this week, summed from the
 * checkpoint each turn captures. Unlike git history, this needs no repository,
 * no commit and no matching author email.
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

const WEEK = Duration.days(7);

const WeeklyRequest = Schema.Struct({ workspaceRoot: Schema.String, since: Schema.String });
const WeeklyRow = Schema.Struct({
  turns: NonNegativeInt,
  linesAdded: NonNegativeInt,
  linesRemoved: NonNegativeInt,
});

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
  // drops checkpoints that changed nothing.
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
      WHERE projects.workspace_root = ${workspaceRoot}
        AND projects.deleted_at IS NULL
        AND threads.deleted_at IS NULL
        AND checkpoints.run_id IS NOT NULL
        AND checkpoints.status = 'ready'
        AND checkpoints.captured_at >= ${since}
    `,
  });

  const weekly = Effect.fn("ProjectTurnActivity.weekly")(function* (workspaceRoot: string) {
    const since = DateTime.formatIso(DateTime.subtractDuration(yield* DateTime.now, WEEK));
    // The card is a glance: an unreadable projection shows no activity rather than an error.
    const activity = yield* sql.withTransaction(selectWeekly({ workspaceRoot, since })).pipe(
      NodeSqliteClient.readOnly,
      Effect.asSome,
      Effect.catch((cause) =>
        Effect.logWarning("Code Atlas weekly turn activity read failed", { cause }).pipe(
          Effect.as(Option.none<TurnWeeklyActivityResult>()),
        ),
      ),
    );
    return Option.filter(activity, (week) => week.turns > 0);
  });

  return ProjectTurnActivity.of({ weekly });
});

export const layer = Layer.effect(ProjectTurnActivity, make);
