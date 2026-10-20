import { CircleCheckIcon, CircleDashedIcon, CircleEllipsisIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ComposerTaskStep } from "~/components/chat/ComposerTasksBadge";
import { cn } from "~/lib/utils";

import { formatAtlasElapsed, formatAtlasTokens } from "./claudeProgress";

/** The agent's plan as a card, every step with its status, like Claude Code. */
function AtlasPlanCard(props: { readonly steps: readonly ComposerTaskStep[] }) {
  const occurrences = new Map<string, number>();
  return (
    <section
      aria-label="Plan"
      data-atlas-plan-card
      className="rounded-xl border border-border bg-card px-4 py-3 text-sm"
    >
      <ul className="flex flex-col gap-1.5">
        {props.steps.map((step) => {
          const occurrence = occurrences.get(step.step) ?? 0;
          occurrences.set(step.step, occurrence + 1);
          return (
            <li key={`${step.step}:${occurrence}`} className="flex items-start gap-2.5">
              {step.status === "completed" ? (
                <CircleCheckIcon
                  aria-label="Completed"
                  className="mt-0.5 size-4 shrink-0 text-success"
                />
              ) : step.status === "inProgress" ? (
                <CircleEllipsisIcon
                  aria-label="In progress"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
              ) : (
                <CircleDashedIcon
                  aria-label="Pending"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                />
              )}
              <span
                className={cn(
                  "min-w-0 wrap-anywhere",
                  step.status === "completed" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.step}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "• • 1m 8s · 37.0k tokens · Thinking" under the running turn. */
function AtlasStatusLine(props: {
  readonly startedAt: string | null;
  readonly tokens: number | null;
  readonly activity: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = props.startedAt === null ? Number.NaN : Date.parse(props.startedAt);
  const parts = [
    Number.isFinite(started) ? formatAtlasElapsed(now - started) : null,
    props.tokens !== null && props.tokens > 0 ? formatAtlasTokens(props.tokens) : null,
    props.activity,
  ].filter((part): part is string => part !== null);
  return (
    <p
      role="status"
      data-atlas-status-line
      className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground"
    >
      <span aria-hidden data-atlas-status-dots className="flex items-center gap-1">
        <span />
        <span />
        <span />
      </span>
      <span className="tabular-nums">{parts.join(" · ")}</span>
    </p>
  );
}

/** Code Atlas "Claude Code" progress style, shown above the composer. */
export function AtlasClaudeProgress(props: {
  readonly working: boolean;
  readonly startedAt: string | null;
  readonly tokens: number | null;
  readonly activity: string;
  readonly steps: readonly ComposerTaskStep[] | null;
}) {
  const showPlan = props.steps !== null && props.steps.length > 0;
  if (!showPlan && !props.working) return null;
  return (
    <div data-atlas-claude-progress className="mb-3 flex flex-col gap-3">
      {showPlan ? <AtlasPlanCard steps={props.steps!} /> : null}
      {props.working ? (
        <AtlasStatusLine
          startedAt={props.startedAt}
          tokens={props.tokens}
          activity={props.activity}
        />
      ) : null}
    </div>
  );
}
