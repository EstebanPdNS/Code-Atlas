import {
  type SourceControlDiscoveryInput,
  type SourceControlDiscoveryResult,
  type VcsDiscoveryItem,
  type VcsDriverKind,
  type VcsWeeklyActivityResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ProjectTurnActivity from "../orchestration-v2/ProjectTurnActivity.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { detailFromCause, firstNonEmptyLine } from "@t3tools/source-control-core/server/discovery";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";

interface DiscoveryProbe {
  readonly label: string;
  readonly executable?: string;
  readonly versionArgs?: ReadonlyArray<string>;
  readonly implemented: boolean;
  readonly installHint: string;
}

type VcsProbe = DiscoveryProbe & {
  readonly kind: VcsDriverKind;
  readonly executable: string;
  readonly versionArgs: ReadonlyArray<string>;
};

interface DiscoveryProbeResult<Kind extends string> {
  readonly kind: Kind;
  readonly label: string;
  readonly executable?: string;
  readonly implemented: boolean;
  readonly status: "available" | "missing";
  readonly version: Option.Option<string>;
  readonly installHint: string;
  readonly detail: Option.Option<string>;
}

const VCS_PROBES: ReadonlyArray<VcsProbe> = [
  {
    kind: "git",
    label: "Git",
    executable: "git",
    versionArgs: ["--version"],
    implemented: true,
    installHint: "Install Git from https://git-scm.com/downloads or with your package manager.",
  },
  {
    kind: "jj",
    label: "Jujutsu",
    executable: "jj",
    versionArgs: ["--version"],
    implemented: false,
    installHint: "Install Jujutsu with `brew install jj` or from https://github.com/jj-vcs/jj.",
  },
];

const WEEKLY_COMMIT_MARKER = "@@atlas-commit";
/** Code Atlas: the card is a glance, so a repository is read at most once a minute. */
const WEEKLY_ACTIVITY_CACHE_MS = 60_000;

/**
 * Sums `git log --shortstat` output written with
 * `--format=tformat:<marker> %ae`: one marker line per commit with its author
 * email, then a summary such as
 * " 3 files changed, 10 insertions(+), 2 deletions(-)". Either count is
 * omitted when it is zero. Only `author`'s commits count.
 */
export function parseWeeklyShortstat(stdout: string, author: string): VcsWeeklyActivityResult {
  const authorEmail = author.trim().toLowerCase();
  let counting = false;
  let commits = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of stdout.split("\n")) {
    if (line === WEEKLY_COMMIT_MARKER || line.startsWith(`${WEEKLY_COMMIT_MARKER} `)) {
      counting = line.slice(WEEKLY_COMMIT_MARKER.length).trim().toLowerCase() === authorEmail;
      if (counting) commits += 1;
      continue;
    }
    if (!counting) continue;
    linesAdded += Number(/(\d+) insertions?\(\+\)/.exec(line)?.[1] ?? 0);
    linesRemoved += Number(/(\d+) deletions?\(-\)/.exec(line)?.[1] ?? 0);
  }
  return { commits, linesAdded, linesRemoved };
}

export class SourceControlDiscovery extends Context.Service<
  SourceControlDiscovery,
  {
    readonly discover: Effect.Effect<SourceControlDiscoveryResult>;
    /**
     * Code Atlas: `discover`, plus `activityCwd`'s commits this week when it
     * names a repository, and its project's turn diffs this week.
     */
    readonly discoverFor: (
      input: SourceControlDiscoveryInput,
    ) => Effect.Effect<SourceControlDiscoveryResult>;
  }
>()("t3/sourceControl/SourceControlDiscovery") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const process = yield* VcsProcess.VcsProcess;
  const sourceControlProviders = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const turnActivity = yield* ProjectTurnActivity.ProjectTurnActivity;

  const probe = <Kind extends VcsDriverKind>(
    input: DiscoveryProbe & { readonly kind: Kind },
  ): Effect.Effect<DiscoveryProbeResult<Kind>> => {
    const executable = input.executable;
    const versionArgs = input.versionArgs;

    if (!executable || !versionArgs) {
      return Effect.succeed({
        kind: input.kind,
        label: input.label,
        implemented: input.implemented,
        status: "missing" as const,
        version: Option.none<string>(),
        installHint: input.installHint,
        detail: Option.some(input.installHint),
      } satisfies DiscoveryProbeResult<Kind>);
    }

    return process
      .run({
        operation: "source-control.discovery.probe",
        command: executable,
        args: versionArgs,
        cwd: config.cwd,
        timeoutMs: 5_000,
        maxOutputBytes: 8_000,
        appendTruncationMarker: true,
      })
      .pipe(
        Effect.map(
          (result) =>
            ({
              kind: input.kind,
              label: input.label,
              executable,
              implemented: input.implemented,
              status: "available" as const,
              version: Option.orElse(firstNonEmptyLine(result.stdout), () =>
                firstNonEmptyLine(result.stderr),
              ),
              installHint: input.installHint,
              detail: Option.none<string>(),
            }) satisfies DiscoveryProbeResult<Kind>,
        ),
        Effect.catch((cause) =>
          Effect.succeed({
            kind: input.kind,
            label: input.label,
            executable,
            implemented: input.implemented,
            status: "missing" as const,
            version: Option.none<string>(),
            installHint: input.installHint,
            detail: detailFromCause(cause),
          } satisfies DiscoveryProbeResult<Kind>),
        ),
      );
  };

  const discover = Effect.all({
    versionControlSystems: Effect.all(
      VCS_PROBES.map((entry) => probe(entry)) as ReadonlyArray<Effect.Effect<VcsDiscoveryItem>>,
      { concurrency: "unbounded" },
    ),
    sourceControlProviders: sourceControlProviders.discover,
  });

  const git = (cwd: string, operation: string, args: ReadonlyArray<string>) =>
    process.run({ operation, command: "git", args, cwd, timeoutMs: 10_000 });

  // Only the repository's configured author counts, so a fork's upstream work
  // is not "this week". Outside a repository, without a configured author, or
  // when git fails, there is none. Code Atlas: both git calls run at once and
  // each repository's answer is reused for a minute.
  const weeklyActivityCache = new Map<
    string,
    { readonly at: number; readonly value: Option.Option<VcsWeeklyActivityResult> }
  >();
  const readWeeklyActivity = (cwd: string): Effect.Effect<Option.Option<VcsWeeklyActivityResult>> =>
    Effect.all(
      [
        git(cwd, "source-control.discovery.weekly-author", ["config", "user.email"]).pipe(
          Effect.map((result) => result.stdout.trim()),
        ),
        git(cwd, "source-control.discovery.weekly-activity", [
          "log",
          "--branches",
          "--no-merges",
          "--since=7.days",
          "--shortstat",
          `--format=tformat:${WEEKLY_COMMIT_MARKER} %ae`,
        ]),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([author, log]) =>
        author === ""
          ? Option.none<VcsWeeklyActivityResult>()
          : Option.some(parseWeeklyShortstat(log.stdout, author)),
      ),
      Effect.orElseSucceed(() => Option.none<VcsWeeklyActivityResult>()),
    );
  const weeklyActivity = Effect.fn("SourceControlDiscovery.weeklyActivity")(function* (
    cwd: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const cached = weeklyActivityCache.get(cwd);
    if (cached !== undefined && now >= cached.at && now - cached.at < WEEKLY_ACTIVITY_CACHE_MS) {
      return cached.value;
    }
    const value = yield* readWeeklyActivity(cwd);
    for (const [key, entry] of weeklyActivityCache) {
      if (now - entry.at >= WEEKLY_ACTIVITY_CACHE_MS) weeklyActivityCache.delete(key);
    }
    weeklyActivityCache.set(cwd, { at: now, value });
    return value;
  });

  return SourceControlDiscovery.of({
    discover,
    discoverFor: (input) =>
      input.activityAll === true
        ? Effect.all([discover, turnActivity.weekly(null, input.activityDays ?? 7)], {
            concurrency: "unbounded",
          }).pipe(
            Effect.map(([result, turns]) => ({
              ...result,
              ...(Option.isSome(turns) ? { turnActivity: turns.value } : {}),
            })),
          )
        : input.activityCwd === undefined
          ? discover
          : Effect.all(
              [discover, weeklyActivity(input.activityCwd), turnActivity.weekly(input.activityCwd)],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.map(([result, activity, turns]) => ({
                ...result,
                ...(Option.isSome(activity) ? { weeklyActivity: activity.value } : {}),
                ...(Option.isSome(turns) ? { turnActivity: turns.value } : {}),
              })),
            ),
  });
});

export const layer = Layer.effect(SourceControlDiscovery, make);
