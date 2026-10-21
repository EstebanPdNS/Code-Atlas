import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleEllipsisIcon,
  ListChecksIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ComposerTaskStep } from "~/components/chat/ComposerTasksBadge";
import { cn } from "~/lib/utils";

import {
  ATLAS_PLAN_FOCUS_LIMIT,
  ATLAS_PLAN_FOLD_THRESHOLD,
  atlasPlanFocus,
  formatAtlasElapsed,
  formatAtlasTokens,
} from "./claudeProgress";

function AtlasPlanStepIcon(props: { readonly status: ComposerTaskStep["status"] }) {
  // Keyed by status, so a step that completes remounts its icon and the check pops in.
  return props.status === "completed" ? (
    <CircleCheckIcon
      key="completed"
      aria-label="Completed"
      data-atlas-plan-check
      className="mt-0.5 size-4 shrink-0 text-success"
    />
  ) : props.status === "inProgress" ? (
    <CircleEllipsisIcon
      key="inProgress"
      aria-label="In progress"
      className="mt-0.5 size-4 shrink-0 text-primary"
    />
  ) : (
    <CircleDashedIcon
      key="pending"
      aria-label="Pending"
      className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
    />
  );
}

/**
 * The agent's plan as a card, every step with its status, like Claude Code.
 * A long plan folds to the steps being worked on; the header unfolds it, and
 * unfolded it scrolls inside the card instead of covering the conversation.
 */
function AtlasPlanCard(props: { readonly steps: readonly ComposerTaskStep[] }) {
  const foldable = props.steps.length > ATLAS_PLAN_FOCUS_LIMIT;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = !foldable || (userExpanded ?? props.steps.length <= ATLAS_PLAN_FOLD_THRESHOLD);
  const focus = new Set(atlasPlanFocus(props.steps));
  const completed = props.steps.filter((step) => step.status === "completed").length;
  const occurrences = new Map<string, number>();
  return (
    <section
      aria-label="Plan"
      data-atlas-plan-card
      data-expanded={expanded ? "" : undefined}
      className="rounded-xl border border-border bg-card text-sm"
    >
      {foldable ? (
        <button
          type="button"
          onClick={() => setUserExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full cursor-pointer items-center gap-2 rounded-t-xl px-4 pt-2.5 pb-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ListChecksIcon aria-hidden className="size-3.5" />
          <span>Tasks</span>
          <span className="tabular-nums">
            {completed}/{props.steps.length}
          </span>
          <ChevronDownIcon aria-hidden data-atlas-plan-chevron className="ms-auto size-3.5" />
        </button>
      ) : null}
      <ul
        data-atlas-plan-list
        className={cn("flex flex-col px-4 pb-3", foldable ? "pt-1" : "pt-3")}
      >
        {props.steps.map((step, index) => {
          const occurrence = occurrences.get(step.step) ?? 0;
          occurrences.set(step.step, occurrence + 1);
          const shown = expanded || focus.has(index);
          return (
            <li
              key={`${step.step}:${occurrence}`}
              data-atlas-plan-step
              data-shown={shown ? "" : undefined}
              aria-hidden={shown ? undefined : true}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex items-start gap-2.5 py-0.75">
                  <AtlasPlanStepIcon status={step.status} />
                  <span
                    className={cn(
                      "min-w-0 wrap-anywhere transition-colors duration-300",
                      step.status === "completed" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {step.step}
                  </span>
                </div>
              </div>
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
  const metrics = [
    Number.isFinite(started) ? formatAtlasElapsed(now - started) : null,
    props.tokens !== null && props.tokens > 0 ? formatAtlasTokens(props.tokens) : null,
  ].filter((part): part is string => part !== null);
  return (
    <p
      data-atlas-status-line
      className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground"
    >
      <span aria-hidden data-atlas-status-dots className="flex items-center gap-1">
        <span />
        <span />
        <span />
      </span>
      <span className="tabular-nums">
        {metrics.length > 0 ? `${metrics.join(" · ")} · ` : null}
        {/* Only the activity is live: a per-second clock would be read out every second. */}
        <span role="status">{props.activity}</span>
      </span>
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
      {showPlan ? (
        // A new plan (new step texts) starts folded or unfolded afresh.
        <AtlasPlanCard
          key={props.steps!.map((step) => step.step).join("\n")}
          steps={props.steps!}
        />
      ) : null}
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
