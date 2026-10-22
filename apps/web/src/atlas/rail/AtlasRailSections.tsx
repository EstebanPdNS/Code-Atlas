import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  ThreadId,
} from "@t3tools/contracts";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import { formatResetsIn, limitsNotice, providersWithLimits } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, SquareTerminalIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";

import { ThreadDetailsSection } from "~/components/chat/ThreadDetailsSection";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
} from "~/components/usage/usagePagePreferences";
import { useNowMinute } from "~/hooks/useNowMinute";
import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useKnownTerminalSessions } from "~/state/terminalSessions";

import { AtlasActivityDots } from "../brand/ActivityDots";
import { AtlasFold } from "../brand/AtlasFold";
import { atlasProviderLabel, useAtlasAgentProviders } from "../brand/agentProviders";
import { UsageProviderIcon } from "../usage/UsageProviderIcon";
import { atlasProviderFill } from "../brand/providerColors";
import {
  contextRows,
  formatContextRowTokens,
  formatContextShare,
  withContextTones,
} from "./contextBreakdown";

function Meter({
  percent,
  className,
  fill = null,
}: {
  readonly percent: number;
  readonly className?: string;
  /** A provider's own bar color (see atlasProviderFill). */
  readonly fill?: string | null;
}) {
  const width = `${Math.min(100, Math.max(0, percent))}%`;
  return (
    <span
      aria-hidden
      className={cn("block h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          fill === null &&
            (percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-primary"),
        )}
        style={fill === null ? { width } : { width, background: fill }}
      />
    </span>
  );
}

/** "Memory files 2 ›": the loaded CLAUDE.md / AGENTS.md files, unfolded on click. */
function ContextMemoryFiles(props: {
  readonly files: NonNullable<ContextWindowSnapshot["contextMemoryFiles"]>;
  readonly estimated: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronRightIcon
          aria-hidden
          data-atlas-disclosure
          data-open={open ? "" : undefined}
          className="size-3.5"
        />
        <span className="flex-1 text-left">Memory files</span>
        <span className="tabular-nums">{props.files.length}</span>
      </button>
      <AtlasFold open={open}>
        <ul className="mt-1.5 grid gap-1 ps-5">
          {props.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-muted-foreground">
              <Tooltip>
                <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                  {file.path.split("/").slice(-2).join("/")}
                </TooltipTrigger>
                <TooltipPopup>{file.path}</TooltipPopup>
              </Tooltip>
              <span className="tabular-nums">
                {formatContextRowTokens({ tokens: file.tokens, estimated: props.estimated })}
              </span>
            </li>
          ))}
        </ul>
      </AtlasFold>
    </div>
  );
}

const CONTEXT_CARD_OPEN_KEY = "codeAtlas.contextCard.open";

function readContextCardOpen(): boolean {
  try {
    return window.localStorage.getItem(CONTEXT_CARD_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function saveContextCardOpen(open: boolean) {
  try {
    window.localStorage.setItem(CONTEXT_CARD_OPEN_KEY, String(open));
  } catch {
    // Blocked storage keeps the choice for this page only.
  }
}

/** A row name that lists what the row holds (skills, memory files) on hover or click. */
function ContextRowList(props: {
  readonly name: string;
  readonly items: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly tokens: number;
    readonly estimated: boolean;
  }>;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={
          <button
            type="button"
            className="max-w-full cursor-pointer truncate rounded-sm text-left underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        {props.name}
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" width="sm" padding="compact">
        <ul className="grid max-h-72 gap-1 overflow-y-auto text-xs">
          {props.items.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatContextRowTokens(item)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}

/** "Context": how full the context window is, row by row like Claude Code's /context. */
export function AtlasContextSection({
  contextWindow,
  onCompactContext,
  compactDisabled = false,
}: {
  readonly contextWindow: ContextWindowSnapshot | null;
  /** Runs the thread's /compact. */
  readonly onCompactContext?: (() => void) | undefined;
  readonly compactDisabled?: boolean | undefined;
}) {
  const [open, setOpen] = useState(readContextCardOpen);
  if (contextWindow === null || contextWindow.maxTokens == null || contextWindow.maxTokens <= 0) {
    return (
      <ThreadDetailsSection headingId="atlas-context-heading" title="Context">
        <div className="px-1.5 pb-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium tabular-nums">0% used</span>
            <span className="text-xs text-muted-foreground">nothing sent yet</span>
          </div>
          <Meter percent={0} className="mt-2" />
        </div>
      </ThreadDetailsSection>
    );
  }
  const toggleOpen = () => {
    setOpen(!open);
    saveContextCardOpen(!open);
  };
  const maxTokens = contextWindow.maxTokens;
  const percent = Math.round(contextWindow.usedPercentage ?? 0);
  const rows = withContextTones(contextRows(contextWindow, maxTokens));
  const barRows = rows.filter((row) => row.kind === "used" || row.kind === "buffer");
  const estimated = contextWindow.contextEstimated === true;
  const memoryFiles = (contextWindow.contextMemoryFiles ?? []).map((file) => ({
    key: file.path,
    label: file.path.split("/").slice(-2).join("/"),
    tokens: file.tokens,
    estimated,
  }));
  const skills = (contextWindow.contextSkills ?? []).map((skill) => ({
    key: skill.name,
    label: skill.name,
    tokens: skill.tokens,
    estimated,
  }));
  const rowLists: Readonly<Record<string, typeof skills>> = {
    Skills: skills,
    "Memory files": memoryFiles,
  };
  const untilCompact =
    contextWindow.autoCompactThreshold != null
      ? Math.max(0, contextWindow.autoCompactThreshold - contextWindow.usedTokens)
      : null;
  return (
    <ThreadDetailsSection
      headingId="atlas-context-heading"
      title="Context"
      actions={
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={open ? "Hide context breakdown" : "Show context breakdown"}
          aria-expanded={open}
          onClick={toggleOpen}
          data-atlas-press
        >
          <ChevronRightIcon aria-hidden data-atlas-disclosure data-open={open ? "" : undefined} />
        </Button>
      }
    >
      <div className="px-1.5 pb-1">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium tabular-nums">{percent}% used</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatContextWindowTokens(contextWindow.usedTokens)} /{" "}
            {formatContextWindowTokens(maxTokens)}
          </span>
        </div>
        <div
          aria-hidden
          className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-foreground/10"
        >
          {barRows.map((row) => (
            <span
              key={row.name}
              className={cn("h-full", row.tone)}
              style={{
                width: `${Math.min(100, (row.tokens / maxTokens) * 100)}%`,
                ...(row.color === null ? {} : { background: row.color }),
              }}
            />
          ))}
        </div>
        <AtlasFold open={open}>
          <dl className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
            {rows.map((row) => {
              const list = row.kind === "used" ? rowLists[row.name] : undefined;
              return (
                <div
                  key={row.name}
                  className={cn(
                    "flex items-center gap-2",
                    row.kind === "deferred" && "mt-1 text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-2.5 shrink-0 rounded-xs", row.tone)}
                    style={row.color === null ? undefined : { background: row.color }}
                  />
                  <dt className="min-w-0 flex-1 truncate text-muted-foreground">
                    {list !== undefined && list.length > 0 ? (
                      <ContextRowList name={row.name} items={list} />
                    ) : (
                      row.name
                    )}
                  </dt>
                  <dd className="w-14 text-right text-muted-foreground tabular-nums">
                    {formatContextRowTokens(row)}
                  </dd>
                  <dd className="w-12 text-right tabular-nums">
                    {row.kind === "deferred" ? "—" : formatContextShare(row.tokens, maxTokens)}
                  </dd>
                </div>
              );
            })}
          </dl>
          {contextWindow.contextMemoryFiles && contextWindow.contextMemoryFiles.length > 0 ? (
            <ContextMemoryFiles files={contextWindow.contextMemoryFiles} estimated={estimated} />
          ) : null}
        </AtlasFold>
        {untilCompact !== null || onCompactContext !== undefined ? (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {untilCompact !== null
                ? `${formatContextWindowTokens(untilCompact)} until auto-compact`
                : null}
            </span>
            {onCompactContext !== undefined ? (
              <Button
                size="compact"
                variant="outline"
                disabled={compactDisabled}
                onClick={onCompactContext}
              >
                Compact session
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

/** "Usage": subscription windows (session, weekly) for Claude Code and Codex. */
export function AtlasUsageSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  // Codex first, then Claude Code.
  const providers = providersWithLimits(useAtlasAgentProviders(environmentId)).toSorted(
    (left, right) => Number(right.driver === "codex") - Number(left.driver === "codex"),
  );
  // Clicking the card opens the usage statistics on the Tokens view.
  const openUsage = () => {
    saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "tokens" });
    void navigate({ to: "/usage" });
  };
  // useNowMinute is a UTC ISO minute without a zone suffix.
  const now = Date.parse(`${useNowMinute()}Z`);
  if (providers.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="atlas-usage-heading" title="Usage">
      <button
        type="button"
        onClick={openUsage}
        className="grid w-full cursor-pointer gap-3 rounded-lg px-1.5 pb-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden"
      >
        {providers.map((provider) => {
          const limits = provider.usageLimits;
          const notice = limits ? limitsNotice(limits) : null;
          const windows = (limits?.windows ?? []).filter(
            (window) => window.kind === "session" || window.kind === "weekly",
          );
          return (
            <div key={provider.instanceId} className="grid gap-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <UsageProviderIcon
                  driverKind={provider.driver}
                  displayName={atlasProviderLabel(provider)}
                  iconClassName="size-4"
                />
                {atlasProviderLabel(provider)}
              </span>
              {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
              {windows.map((window) => {
                const resets = formatResetsIn(window, now);
                return (
                  <div key={window.id} className="grid gap-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">{window.label}</span>
                      <span className="tabular-nums">{Math.round(window.usedPercent)}%</span>
                    </div>
                    <Meter percent={window.usedPercent} fill={atlasProviderFill(provider.driver)} />
                    {resets ? (
                      <span className="text-2xs text-muted-foreground">{resets}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* The figures are the button's name; this adds where it leads. */}
        <span className="sr-only">Open usage statistics</span>
      </button>
    </ThreadDetailsSection>
  );
}

/** "Background tasks": agent background work and the thread's terminals. */
export function AtlasBackgroundSection({
  environmentId,
  threadId,
  backgroundTasks,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly backgroundTasks: readonly OrchestrationV2PendingBackgroundTask[];
}) {
  const terminals = useKnownTerminalSessions({ environmentId, threadId }) ?? [];
  const work = presentPendingBackgroundWork(backgroundTasks);
  const running = terminals.filter((session) => session.state.hasRunningSubprocess);
  const finished = terminals.length - running.length;
  if ((work?.items.length ?? 0) === 0 && terminals.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="atlas-background-heading" title="Background tasks">
      <ul className="grid gap-1 px-1.5 pb-1 text-sm">
        {work?.items.map((item) => (
          <li key={item.taskId} className="flex min-w-0 items-center gap-2">
            <WorkflowIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <AtlasActivityDots label="Running" />
          </li>
        ))}
        {running.map((session) => (
          <li key={session.target.terminalId} className="flex min-w-0 items-center gap-2">
            <SquareTerminalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {session.state.summary?.label ?? session.target.terminalId}
            </span>
            <span className="text-2xs text-primary">running</span>
          </li>
        ))}
        {finished > 0 ? (
          <li className="text-xs text-muted-foreground">
            {finished} {finished === 1 ? "terminal" : "terminals"} idle
          </li>
        ) : null}
      </ul>
    </ThreadDetailsSection>
  );
}
