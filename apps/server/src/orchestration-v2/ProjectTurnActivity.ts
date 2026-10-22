/**
 * Code Atlas: a project's week with its agents: the lines its turns changed
 * (from each turn's checkpoint diff, or from the agents' own edits when a turn
 * has none: a project without git, a run still working), the files changed
 * and read, commands run, threads worked on and the agents' working time.
 * Unlike git history, this needs no repository, no commit and no author email.
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

// A null root reads every project (the Usage page's Code view).
const WeeklyRequest = Schema.Struct({
  workspaceRoot: Schema.NullOr(Schema.String),
  since: Schema.String,
});
const CheckpointRow = Schema.Struct({
  checkpointId: Schema.String,
  root: Schema.String,
  title: Schema.String,
  at: Schema.String,
  runId: Schema.String,
  // A subagent's thread working in its parent's checkout: the parent's
  // checkpoint already holds its edits.
  shared: NonNegativeInt,
  files: Schema.String,
});
const EditRow = Schema.Struct({
  runId: Schema.String,
  root: Schema.String,
  title: Schema.String,
  at: Schema.String,
  payload: Schema.String,
});
const CountsRow = Schema.Struct({
  commands: NonNegativeInt,
  filesRead: NonNegativeInt,
  threads: NonNegativeInt,
  agentSeconds: Schema.Number,
});

interface CheckpointFile {
  readonly path?: unknown;
  readonly additions?: unknown;
  readonly deletions?: unknown;
}

function checkpointFiles(json: string): ReadonlyArray<CheckpointFile> {
  try {
    const files: unknown = JSON.parse(json);
    return Array.isArray(files) ? (files as ReadonlyArray<CheckpointFile>) : [];
  } catch {
    return [];
  }
}

function editOf(
  payload: string,
): { readonly path: string; readonly lines: FileChangeLineStats | null } | null {
  try {
    const item: unknown = JSON.parse(payload);
    if (typeof item !== "object" || item === null) return null;
    const fileName = (item as { readonly fileName?: unknown }).fileName;
    return {
      path: typeof fileName === "string" ? fileName : "",
      lines: fileChangeLineStats(item as Parameters<typeof fileChangeLineStats>[0]),
    };
  } catch {
    return null;
  }
}

/** A path inside the project, relative to its root like checkpoint paths. */
function projectPath(workspaceRoot: string, path: string): string {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}

const nonNegative = (value: number) => Math.max(0, Math.round(value));

const localZone = DateTime.zoneMakeLocal();
const periodUnit = (days: number) => (days === 1 ? "hour" : "day");

function periodKey(start: DateTime.DateTime, days: number): string {
  return days === 1 ? DateTime.formatIso(start) : DateTime.formatIsoDate(start);
}

/**
 * The window's periods, oldest first and all present: local days, or hours
 * over a single day. The server's clock is the user's, as on the Usage page.
 */
export function activityPeriods(
  since: DateTime.DateTime,
  now: DateTime.DateTime,
  days: number,
): ReadonlyArray<string> {
  const periods: string[] = [];
  let cursor = DateTime.startOf(DateTime.setZone(since, localZone), periodUnit(days));
  while (DateTime.isLessThanOrEqualTo(cursor, now)) {
    periods.push(periodKey(cursor, days));
    cursor = DateTime.add(cursor, days === 1 ? { hours: 1 } : { days: 1 });
  }
  return periods;
}

export function activityPeriodOf(at: string, days: number): string | null {
  return Option.match(DateTime.make(at), {
    onNone: () => null,
    onSome: (time) =>
      periodKey(DateTime.startOf(DateTime.setZone(time, localZone), periodUnit(days)), days),
  });
}

export class ProjectTurnActivity extends Context.Service<
  ProjectTurnActivity,
  {
    /**
     * Turns in the last `days` days (seven by default) whose checkpoint
     * changed files, across the live threads of the active projects rooted at
     * `workspaceRoot`. Every project when it is null, then also split by
     * project and by period. None when there are none, or when the projection
     * cannot be read.
     */
    readonly weekly: (
      workspaceRoot: string | null,
      days?: number,
    ) => Effect.Effect<Option.Option<TurnWeeklyActivityResult>>;
  }
>()("t3/orchestration-v2/ProjectTurnActivity") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Only a run's own ready checkpoint is a turn's diff: baselines have no run,
  // and a rolled-back turn's checkpoint turns stale.
  const selectCheckpoints = SqlSchema.findAll({
    Request: WeeklyRequest,
    Result: CheckpointRow,
    execute: ({ workspaceRoot, since }) => sql`
      SELECT
        checkpoints.checkpoint_id AS "checkpointId",
        projects.workspace_root AS "root",
        projects.title AS "title",
        checkpoints.captured_at AS "at",
        checkpoints.run_id AS "runId",
        CASE WHEN parents.thread_id IS NOT NULL
          AND COALESCE(json_extract(threads.payload_json, '$.worktreePath'), '')
            = COALESCE(json_extract(parents.payload_json, '$.worktreePath'), '')
          THEN 1 ELSE 0 END AS "shared",
        COALESCE(json_extract(checkpoints.payload_json, '$.files'), '[]') AS "files"
      FROM projection_projects AS projects
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.project_id = projects.project_id
      INNER JOIN orchestration_v2_projection_checkpoints AS checkpoints
        ON checkpoints.thread_id = threads.thread_id
      LEFT JOIN orchestration_v2_projection_threads AS parents
        ON json_extract(threads.payload_json, '$.lineage.relationshipToParent') = 'subagent'
        AND parents.thread_id = json_extract(threads.payload_json, '$.lineage.parentThreadId')
      WHERE (${workspaceRoot} IS NULL OR projects.workspace_root = ${workspaceRoot})
        AND projects.deleted_at IS NULL
        AND threads.deleted_at IS NULL
        AND checkpoints.run_id IS NOT NULL
        AND checkpoints.status = 'ready'
        AND checkpoints.captured_at >= ${since}
    `,
  });

  // The agents' own file edits: what a turn changed when it has no checkpoint
  // diff (a project without git, or a run still working).
  const selectEdits = SqlSchema.findAll({
    Request: WeeklyRequest,
    Result: EditRow,
    execute: ({ workspaceRoot, since }) => sql`
      SELECT items.run_id AS "runId", projects.workspace_root AS "root",
        projects.title AS "title", items.updated_at AS "at", items.payload_json AS "payload"
      FROM projection_projects AS projects
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.project_id = projects.project_id
      INNER JOIN orchestration_v2_projection_turn_items AS items
        ON items.thread_id = threads.thread_id
      WHERE (${workspaceRoot} IS NULL OR projects.workspace_root = ${workspaceRoot})
        AND projects.deleted_at IS NULL
        AND threads.deleted_at IS NULL
        AND items.type = 'file_change'
        AND items.run_id IS NOT NULL
        AND items.updated_at >= ${since}
    `,
  });

  // Commands run and files read (subagents included); threads worked on and
  // the agents' working time (top-level runs only: a subagent works inside
  // its parent's run).
  const selectCounts = SqlSchema.findOne({
    Request: WeeklyRequest,
    Result: CountsRow,
    execute: ({ workspaceRoot, since }) => sql`
      WITH project_threads AS (
        SELECT threads.thread_id,
          json_extract(threads.payload_json, '$.lineage.relationshipToParent') AS relationship
        FROM projection_projects AS projects
        INNER JOIN orchestration_v2_projection_threads AS threads
          ON threads.project_id = projects.project_id
        WHERE (${workspaceRoot} IS NULL OR projects.workspace_root = ${workspaceRoot})
          AND projects.deleted_at IS NULL
          AND threads.deleted_at IS NULL
      )
      SELECT
        (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items AS items
          WHERE items.thread_id IN (SELECT thread_id FROM project_threads)
            AND items.type = 'command_execution' AND items.updated_at >= ${since}) AS "commands",
        (SELECT COUNT(DISTINCT json_extract(items.payload_json, '$.title'))
          FROM orchestration_v2_projection_turn_items AS items
          WHERE items.thread_id IN (SELECT thread_id FROM project_threads)
            AND items.type = 'dynamic_tool' AND items.updated_at >= ${since}
            AND json_extract(items.payload_json, '$.title') LIKE 'Read %') AS "filesRead",
        (SELECT COUNT(DISTINCT runs.thread_id) FROM orchestration_v2_projection_runs AS runs
          WHERE runs.thread_id IN (
              SELECT thread_id FROM project_threads WHERE relationship IS NOT 'subagent')
            AND json_extract(runs.payload_json, '$.startedAt') >= ${since}) AS "threads",
        (SELECT COALESCE(SUM(MAX(0,
            julianday(COALESCE(runs.completed_at, ${since}))
            - julianday(json_extract(runs.payload_json, '$.startedAt'))) * 86400), 0)
          FROM orchestration_v2_projection_runs AS runs
          WHERE runs.thread_id IN (
              SELECT thread_id FROM project_threads WHERE relationship IS NOT 'subagent')
            AND runs.completed_at IS NOT NULL
            AND json_extract(runs.payload_json, '$.startedAt') >= ${since}) AS "agentSeconds"
    `,
  });

  const weekly = Effect.fn("ProjectTurnActivity.weekly")(function* (
    workspaceRoot: string | null,
    days = 7,
  ) {
    const now = yield* DateTime.now;
    const sinceTime = DateTime.subtractDuration(now, Duration.days(days));
    const since = DateTime.formatIso(sinceTime);
    const detailed = workspaceRoot === null;
    // The card is a glance: an unreadable projection shows no activity rather than an error.
    const read = Effect.gen(function* () {
      const request = { workspaceRoot, since };
      const checkpoints = yield* selectCheckpoints(request);
      const edits = yield* selectEdits(request);
      const counts = yield* selectCounts(request);
      const files = new Set<string>();
      const turns = new Set<string>();
      // Runs whose checkpoint recorded their diff: their edits are in it.
      const diffedRuns = new Set<string>();
      let linesAdded = 0;
      let linesRemoved = 0;
      const projects = new Map<
        string,
        { title: string; turns: Set<string>; files: Set<string>; added: number; removed: number }
      >();
      const periods = new Map(
        activityPeriods(sinceTime, now, days).map((start) => [start, { added: 0, removed: 0 }]),
      );
      const record = (
        row: { readonly root: string; readonly title: string; readonly at: string },
        turn: string,
        paths: ReadonlyArray<string>,
        added: number,
        removed: number,
      ) => {
        turns.add(turn);
        for (const path of paths) files.add(`${row.root}\0${path}`);
        linesAdded += added;
        linesRemoved += removed;
        if (!detailed) return;
        const project = projects.get(row.root) ?? {
          title: row.title,
          turns: new Set<string>(),
          files: new Set<string>(),
          added: 0,
          removed: 0,
        };
        project.turns.add(turn);
        for (const path of paths) project.files.add(path);
        project.added += added;
        project.removed += removed;
        projects.set(row.root, project);
        const periodStart = activityPeriodOf(row.at, days);
        const period = periodStart === null ? undefined : periods.get(periodStart);
        if (period !== undefined) {
          period.added += added;
          period.removed += removed;
        }
      };
      for (const row of checkpoints) {
        const changed = checkpointFiles(row.files);
        if (changed.length === 0) continue;
        diffedRuns.add(row.runId);
        if (row.shared === 1) continue;
        record(
          row,
          `checkpoint:${row.checkpointId}`,
          changed.flatMap((file) => (typeof file.path === "string" ? [file.path] : [])),
          changed.reduce(
            (sum, file) => sum + (typeof file.additions === "number" ? file.additions : 0),
            0,
          ),
          changed.reduce(
            (sum, file) => sum + (typeof file.deletions === "number" ? file.deletions : 0),
            0,
          ),
        );
      }
      for (const row of edits) {
        if (diffedRuns.has(row.runId)) continue;
        const edit = editOf(row.payload);
        if (edit === null || edit.lines === null) continue;
        record(
          row,
          `run:${row.runId}`,
          edit.path === "" ? [] : [projectPath(row.root, edit.path)],
          edit.lines.additions,
          edit.lines.deletions,
        );
      }
      return {
        turns: turns.size,
        linesAdded,
        linesRemoved,
        filesChanged: files.size,
        filesRead: counts.filesRead,
        commands: counts.commands,
        threads: counts.threads,
        agentSeconds: nonNegative(counts.agentSeconds),
        ...(detailed
          ? {
              projects: Array.from(projects, ([root, project]) => ({
                workspaceRoot: root,
                title: project.title,
                turns: project.turns.size,
                linesAdded: project.added,
                linesRemoved: project.removed,
                filesChanged: project.files.size,
              })).toSorted(
                (a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved),
              ),
              periods: Array.from(periods, ([start, period]) => ({
                start,
                linesAdded: period.added,
                linesRemoved: period.removed,
              })),
            }
          : {}),
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
      (week) =>
        week.turns > 0 ||
        week.linesAdded > 0 ||
        week.linesRemoved > 0 ||
        (week.commands ?? 0) > 0 ||
        (week.threads ?? 0) > 0,
    );
  });

  return ProjectTurnActivity.of({ weekly });
});

export const layer = Layer.effect(ProjectTurnActivity, make);
