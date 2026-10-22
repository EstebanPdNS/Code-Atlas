import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import { formatDayShort, formatHourShort, formatTokens } from "@t3tools/shared/usageFormat";
import { useRef, useState } from "react";

import { niceScale, smoothCurve } from "~/components/usage/UsageProviderChart";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";

import { formatAtlasCount } from "../intro/atlasIntro";
import { morphablePath } from "./chartMorph";

type Activity = NonNullable<SourceControlDiscoveryResult["turnActivity"]>;
type Period = NonNullable<Activity["periods"]>[number];

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
const MIDDLE = VIEW_HEIGHT / 2;
const PLOT_INSET = 8;
const SHOWN_PROJECTS = 6;

function agentTime(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 60) return "—";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${formatAtlasCount(hours)}h ${minutes % 60}m` : `${minutes}m`;
}

const count = (value: number | undefined) => (value === undefined ? "—" : formatAtlasCount(value));

function dimmed(loading: boolean) {
  return cn("transition-opacity", loading && "opacity-40 delay-150");
}

/**
 * Code Atlas: the Usage page's Code view. What the agents wrote across every
 * project over the chosen period: lines added and removed, by day (or hour)
 * and by project, then files, turns, commands, threads and working time.
 */
export function UsageCodeView({
  windowDays,
  hour12,
}: {
  readonly windowDays: 1 | 7 | 30 | 90;
  readonly hour12: boolean;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: { activityAll: true, activityDays: windowDays },
        }),
  );
  // The last period stays on screen, dimmed, until the new one arrives, so
  // the chart can morph from it.
  const [kept, setKept] = useState<SourceControlDiscoveryResult | null>(null);
  if (discovery.data !== null && discovery.data !== kept) setKept(discovery.data);
  const data = discovery.data ?? kept;
  const loading = discovery.data === null;
  const activity = data?.turnActivity;

  if (data === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (activity === undefined) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No agent work in this period yet.
      </p>
    );
  }

  const projects = activity.projects ?? [];
  const busiest = projects.reduce(
    (peak, project) => Math.max(peak, project.linesAdded + project.linesRemoved),
    0,
  );
  const hourly = windowDays === 1;

  return (
    <div aria-busy={loading} className="flex flex-col gap-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={cn("flex flex-col gap-1", dimmed(loading))}>
            <span className="flex flex-wrap items-baseline gap-x-3 text-4xl font-semibold tabular-nums">
              <span className="text-success">+{formatAtlasCount(activity.linesAdded)}</span>
              <span className="text-destructive">−{formatAtlasCount(activity.linesRemoved)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              lines · {formatAtlasCount(activity.turns)} {activity.turns === 1 ? "turn" : "turns"}
            </span>
          </div>

          {projects.slice(0, SHOWN_PROJECTS).map((project) => {
            const changed = project.linesAdded + project.linesRemoved;
            return (
              <div
                key={project.workspaceRoot}
                className={cn("flex flex-col gap-1", dimmed(loading))}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-sm text-foreground">{project.title}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    <span className="text-success">+{formatAtlasCount(project.linesAdded)}</span>{" "}
                    <span className="text-destructive">
                      −{formatAtlasCount(project.linesRemoved)}
                    </span>
                  </span>
                </div>
                <span aria-hidden className="flex h-1 overflow-hidden rounded-full bg-foreground/8">
                  <span
                    data-atlas-bar
                    className="flex h-full"
                    style={{ width: `${busiest === 0 ? 0 : (changed / busiest) * 100}%` }}
                  >
                    <span
                      className="block h-full bg-success"
                      style={{
                        width: `${changed === 0 ? 0 : (project.linesAdded / changed) * 100}%`,
                      }}
                    />
                    <span className="block h-full flex-1 bg-destructive" />
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatAtlasCount(project.filesChanged)}{" "}
                  {project.filesChanged === 1 ? "file" : "files"} ·{" "}
                  {formatAtlasCount(project.turns)} {project.turns === 1 ? "turn" : "turns"}
                </span>
              </div>
            );
          })}
          {projects.length > SHOWN_PROJECTS ? (
            <span className="text-xs text-muted-foreground">
              and {projects.length - SHOWN_PROJECTS} more{" "}
              {projects.length - SHOWN_PROJECTS === 1 ? "project" : "projects"}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:[--usage-chart-height:16rem] xl:[--usage-chart-height:18rem]">
          <h2 className="text-sm font-medium text-foreground">
            {hourly ? "Hourly" : "Daily"} lines changed
          </h2>
          <UsageCodeChart periods={activity.periods ?? []} hourly={hourly} hour12={hour12} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Totals</h2>
        <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-6", dimmed(loading))}>
          {[
            { label: "Files changed", value: count(activity.filesChanged) },
            { label: "Files read", value: count(activity.filesRead) },
            { label: "Turns", value: count(activity.turns) },
            { label: "Commands", value: count(activity.commands) },
            { label: "Threads", value: count(activity.threads) },
            { label: "Agent time", value: agentTime(activity.agentSeconds) },
          ].map((metric) => (
            <div key={metric.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{metric.label}</dt>
              <dd className="text-base font-medium text-foreground tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** Lines added above the middle line, removed below it, one point per period. */
function UsageCodeChart({
  periods,
  hourly,
  hour12,
}: {
  readonly periods: readonly Period[];
  readonly hourly: boolean;
  readonly hour12: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const peak = periods.reduce(
    (max, period) => Math.max(max, period.linesAdded, period.linesRemoved),
    0,
  );
  const scale = niceScale(peak, 2);
  const offset = (value: number) =>
    scale.max === 0 ? 0 : (value / scale.max) * (MIDDLE - PLOT_INSET);
  const stepX = periods.length < 2 ? 0 : VIEW_WIDTH / (periods.length - 1);
  const curve = (pick: (period: Period) => number, sign: 1 | -1) =>
    morphablePath(
      smoothCurve(
        periods.map((period, index) => ({
          x: index * stepX,
          y: MIDDLE - sign * offset(pick(period)),
        })),
      ),
      VIEW_WIDTH,
    );
  const added = curve((period) => period.linesAdded, 1);
  const removed = curve((period) => period.linesRemoved, -1);
  const area = (line: string) =>
    line === "" ? "" : `${line} L${VIEW_WIDTH},${MIDDLE} L0,${MIDDLE} Z`;
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const label = (period: Period | undefined) =>
    period === undefined
      ? ""
      : hourly
        ? formatHourShort(period.start, timeZone, hour12)
        : formatDayShort(period.start);
  const ticks = scale.ticks.filter((tick) => tick > 0);
  const hovered = hoverIndex === null ? undefined : periods[hoverIndex];
  const series = [
    { line: added, className: "text-success" },
    { line: removed, className: "text-destructive" },
  ];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div
          key={`${hourly}:${periods.length}:${scale.max}`}
          data-atlas-chart-axis
          className="relative h-[var(--usage-chart-height,14rem)] w-14 shrink-0"
        >
          {[
            ...ticks.map((tick) => ({ y: MIDDLE - offset(tick), text: `+${formatTokens(tick)}` })),
            { y: MIDDLE, text: "0" },
            ...ticks.map((tick) => ({ y: MIDDLE + offset(tick), text: `−${formatTokens(tick)}` })),
          ].map((tick) => (
            <span
              key={`${tick.y}`}
              className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
              style={{ top: `${(tick.y / VIEW_HEIGHT) * 100}%` }}
            >
              {tick.text}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          className="relative h-[var(--usage-chart-height,14rem)] flex-1"
          onMouseMove={(event) => {
            const bounds = plotRef.current?.getBoundingClientRect();
            if (bounds === undefined || bounds.width === 0 || periods.length === 0) return;
            const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            setHoverIndex(Math.round(fraction * (periods.length - 1)));
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${hourly ? "Hourly" : "Daily"} lines added and removed`}
          >
            {ticks
              .flatMap((tick) => [MIDDLE - offset(tick), MIDDLE + offset(tick)])
              .concat(MIDDLE)
              .map((y) => (
                <line
                  key={y}
                  x1={0}
                  x2={VIEW_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-border"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {series.map(({ line, className }) => (
              <g key={className} className={className}>
                <path
                  d={area(line)}
                  data-atlas-chart-path
                  style={{ d: `path("${area(line)}")` }}
                  fill="currentColor"
                  fillOpacity={0.12}
                />
                <path
                  d={line}
                  data-atlas-chart-path
                  style={{ d: `path("${line}")` }}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
            {hoverIndex === null ? null : (
              <line
                x1={hoverIndex * stepX}
                x2={hoverIndex * stepX}
                y1={PLOT_INSET}
                y2={VIEW_HEIGHT - PLOT_INSET}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {hovered === undefined || hoverIndex === null ? null : (
            <div
              className="surface-glass pointer-events-none absolute top-2 z-10 min-w-32 rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={
                hoverIndex / Math.max(1, periods.length - 1) > 0.5
                  ? {
                      right: `calc(${100 - (hoverIndex / Math.max(1, periods.length - 1)) * 100}% + 12px)`,
                    }
                  : {
                      left: `calc(${(hoverIndex / Math.max(1, periods.length - 1)) * 100}% + 12px)`,
                    }
              }
            >
              <div className="mb-1 text-muted-foreground">{label(hovered)}</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Added</span>
                <span className="text-success tabular-nums">
                  +{formatAtlasCount(hovered.linesAdded)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Removed</span>
                <span className="text-destructive tabular-nums">
                  −{formatAtlasCount(hovered.linesRemoved)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        key={`${hourly}:${periods.length}`}
        data-atlas-chart-axis
        className="flex justify-between pl-16 text-3xs text-muted-foreground uppercase"
      >
        <span>{label(periods[0])}</span>
        <span>{label(periods[Math.floor(periods.length / 2)])}</span>
        <span>{label(periods[periods.length - 1])}</span>
      </div>
    </div>
  );
}
