import type { RunId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleEllipsisIcon,
  FileDiffIcon,
  ListChecksIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { AtlasFold } from "~/atlas/brand/AtlasFold";
import { atlasProvider } from "~/atlas/brand/providerColors";
import { ChangedFilesTree } from "~/components/chat/ChangedFilesTree";
import type { ComposerTaskStep } from "~/components/chat/ComposerTasksBadge";
import { cn } from "~/lib/utils";
import type { TurnDiffFileChange } from "~/types";

import {
  ATLAS_PLAN_FOCUS_LIMIT,
  ATLAS_PLAN_FOLD_THRESHOLD,
  atlasPlanFocus,
  formatAtlasChangedFiles,
  formatAtlasElapsed,
  formatAtlasLines,
  formatAtlasTokens,
} from "./claudeProgress";
import type { AtlasLineStats } from "./runLines";

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
  // A new plan (new step texts) starts folded or unfolded afresh. The card
  // stays mounted, so a step the agent adds slides in and the rest stay put.
  const planText = props.steps.map((step) => step.step).join("\n");
  const [shownPlanText, setShownPlanText] = useState(planText);
  if (planText !== shownPlanText) {
    setShownPlanText(planText);
    setUserExpanded(null);
  }
  // Set once the card's entrance ends: from then on new steps slide in and
  // completed steps pop their check (see [data-settled] in atlas.css).
  const [settled, setSettled] = useState(false);
  const expanded = !foldable || (userExpanded ?? props.steps.length <= ATLAS_PLAN_FOLD_THRESHOLD);
  const focus = new Set(atlasPlanFocus(props.steps));
  const completed = props.steps.filter((step) => step.status === "completed").length;
  const occurrences = new Map<string, number>();
  return (
    <section
      aria-label="Plan"
      data-atlas-plan-card
      data-atlas-rise
      data-settled={settled ? "" : undefined}
      data-expanded={expanded ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setSettled(true);
      }}
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
                    data-atlas-plan-text
                    className={cn(
                      "min-w-0 wrap-anywhere",
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

/** "+40 −12" in the diff colors. */
function AtlasLines(props: { readonly lines: AtlasLineStats | null }) {
  const formatted = props.lines === null ? null : formatAtlasLines(props.lines);
  if (formatted === null) return null;
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`${props.lines!.additions} lines added, ${props.lines!.deletions} removed`}
    >
      <span aria-hidden className="text-diff-addition">
        {formatted.added}
      </span>
      <span aria-hidden className="text-diff-deletion">
        {formatted.removed}
      </span>
    </span>
  );
}

/** "• • 1m 8s · 37.0k tokens · +40 −12 · Thinking" at the top of the progress stack. */
function AtlasStatusLine(props: {
  readonly provider: string | null;
  readonly startedAt: string | null;
  readonly tokens: number | null;
  readonly lines: AtlasLineStats | null;
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
      data-atlas-rise
      className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground"
    >
      <span
        aria-hidden
        data-atlas-status-dots
        data-atlas-provider={
          props.provider ? (atlasProvider(props.provider) ?? undefined) : undefined
        }
        className="flex items-center gap-1"
      >
        <span />
        <span />
        <span />
      </span>
      <span className="tabular-nums">
        {metrics.length > 0 ? `${metrics.join(" · ")} · ` : null}
        {props.lines !== null && formatAtlasLines(props.lines) !== null ? (
          <>
            <AtlasLines lines={props.lines} />
            {" · "}
          </>
        ) : null}
        {/* Only the activity is live: a per-second clock would be read out every second. */}
        <span role="status">{props.activity}</span>
      </span>
    </p>
  );
}

export interface AtlasRunChangedFiles {
  readonly runId: RunId;
  readonly files: ReadonlyArray<TurnDiffFileChange>;
  readonly resolvedTheme: "light" | "dark";
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}

/**
 * After a run, like Codex: "3 files changed +40 −12" in the status line's
 * place, which unfolds below to the files with their own counts (the
 * timeline's changed-files tree).
 */
function AtlasChangedFilesRow(
  props: AtlasRunChangedFiles & { readonly lines: AtlasLineStats | null },
) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Changed files" data-atlas-changed-files data-atlas-rise>
      <div
        data-atlas-status-line
        className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronDownIcon
            aria-hidden
            data-atlas-plan-chevron
            className={cn("size-3.5 shrink-0", expanded ? "" : "-rotate-90")}
          />
          <span>{formatAtlasChangedFiles(props.files.length)}</span>
          <AtlasLines lines={props.lines} />
        </button>
        <button
          type="button"
          onClick={() => props.onOpenTurnDiff(props.runId, props.files[0]?.path)}
          className="ms-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <FileDiffIcon aria-hidden className="size-3.5" />
          Review
        </button>
      </div>
      <AtlasFold open={expanded}>
        <div className="mt-2 max-h-[min(40vh,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card py-1 text-sm">
          <ChangedFilesTree
            runId={props.runId}
            files={props.files}
            allDirectoriesExpanded
            resolvedTheme={props.resolvedTheme}
            onOpenTurnDiff={props.onOpenTurnDiff}
          />
        </div>
      </AtlasFold>
    </section>
  );
}

/**
 * Code Atlas "Claude Code" progress style, shown above the composer: the
 * status line (after the run, the files it changed) on top, then the plan
 * card, then the goal right on the composer.
 */
export function AtlasClaudeProgress(props: {
  readonly working: boolean;
  /** The thread's provider driver: the status dots take its colors. */
  readonly provider: string | null;
  readonly startedAt: string | null;
  readonly tokens: number | null;
  readonly activity: string;
  readonly steps: readonly ComposerTaskStep[] | null;
  readonly lines: AtlasLineStats | null;
  readonly changedFiles: AtlasRunChangedFiles | null;
  readonly goal: ReactNode;
}) {
  const showPlan = props.steps !== null && props.steps.length > 0;
  const showChangedFiles =
    !props.working && props.changedFiles !== null && props.changedFiles.files.length > 0;
  if (!showPlan && !props.working && !showChangedFiles && props.goal === null) return null;
  return (
    <div data-atlas-claude-progress className="mb-3 flex flex-col gap-3">
      {props.working ? (
        <AtlasStatusLine
          provider={props.provider}
          startedAt={props.startedAt}
          tokens={props.tokens}
          lines={props.lines}
          activity={props.activity}
        />
      ) : showChangedFiles ? (
        <AtlasChangedFilesRow
          key={props.changedFiles!.runId}
          {...props.changedFiles!}
          lines={props.lines}
        />
      ) : null}
      {showPlan ? <AtlasPlanCard steps={props.steps!} /> : null}
      {props.goal}
    </div>
  );
}
