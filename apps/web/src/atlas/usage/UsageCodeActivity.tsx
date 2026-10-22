import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { cn } from "~/lib/utils";

import { formatAtlasCount, toAtlasWeekActivity } from "../intro/atlasIntro";

function agentTime(seconds: number | null): string {
  if (seconds === null || seconds < 60) return "—";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

const count = (value: number | null) => (value === null ? "—" : formatAtlasCount(value));

/**
 * Code Atlas: what the agents did across every project this week (the
 * terminal's This week, summed): lines added and removed, then files,
 * turns, commands, threads and working time.
 */
export function UsageCodeActivity({ compact = false }: { readonly compact?: boolean }) {
  const environmentId = usePrimaryEnvironmentId();
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: { activityAll: true } }),
  );
  const week = toAtlasWeekActivity(discovery.data);
  const changed = week === null ? 0 : week.linesAdded + week.linesRemoved;
  const addedShare = week === null || changed === 0 ? 0 : week.linesAdded / changed;
  const metrics = [
    { label: "Files changed", value: count(week?.filesChanged ?? null) },
    { label: "Files read", value: count(week?.filesRead ?? null) },
    { label: "Turns", value: count(week?.turns ?? null) },
    { label: "Commands", value: count(week?.commands ?? null) },
    { label: "Threads", value: count(week?.threads ?? null) },
    { label: "Agent time", value: agentTime(week?.agentSeconds ?? null) },
  ];

  return (
    <div data-atlas-code-activity className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-sm font-medium text-foreground">Code this week</h3>
      {week === null ? (
        <p className="text-xs text-muted-foreground">
          {discovery.data === undefined ? "Loading…" : "No agent work this week yet."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="flex items-baseline gap-3 tabular-nums">
              <span className="text-xl font-semibold text-success">
                +{formatAtlasCount(week.linesAdded)}
              </span>
              <span className="text-xl font-semibold text-destructive">
                −{formatAtlasCount(week.linesRemoved)}
              </span>
              <span className="text-xs text-muted-foreground">lines</span>
            </p>
            <span aria-hidden className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
              {changed > 0 ? (
                <>
                  <span
                    data-atlas-bar
                    className="block h-full bg-success"
                    style={{ width: `${addedShare * 100}%` }}
                  />
                  <span data-atlas-bar className="block h-full flex-1 bg-destructive" />
                </>
              ) : null}
            </span>
          </div>
          <dl
            className={cn(
              "grid gap-x-6 gap-y-3 pt-1",
              compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
            )}
          >
            {metrics.map((metric) => (
              <div key={metric.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                <dd className="text-base font-medium text-foreground tabular-nums">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
