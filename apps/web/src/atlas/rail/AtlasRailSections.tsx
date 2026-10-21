import type {
  EnvironmentId,
  SourceControlDiscoveryResult,
  OrchestrationV2PendingBackgroundTask,
  ServerProvider,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatProviderDriverKindLabel } from "~/providerModels";
import { useEnvironmentProviders } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useKnownTerminalSessions } from "~/state/terminalSessions";

import type { AtlasGitHubAccount, AtlasTerminalMeta } from "../intro/atlasIntro";
import { atlasProviderFill } from "../brand/providerColors";

const AGENT_DRIVERS = new Set(["claudeAgent", "codex"]);
const NO_PROVIDERS: readonly ServerProvider[] = [];

function providerLabel(provider: ServerProvider): string {
  if (provider.driver === "claudeAgent") return "Claude Code";
  if (provider.driver === "codex") return "Codex";
  return provider.displayName ?? formatProviderDriverKindLabel(provider.driver);
}

function useAgentProviders(environmentId: EnvironmentId | null): readonly ServerProvider[] {
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    environmentId === null
      ? [...providersByEnvironment.values()][0]
      : providersByEnvironment.get(environmentId);
  // Claude Code first, then Codex, like the handbook's agent line.
  return (providers ?? NO_PROVIDERS)
    .filter(
      (provider) => provider.enabled && provider.installed && AGENT_DRIVERS.has(provider.driver),
    )
    .toSorted(
      (left, right) =>
        Number(right.driver === "claudeAgent") - Number(left.driver === "claudeAgent"),
    );
}

// The owner's two GitHub accounts: ports live on EstebanPdN, apps on EstebanPdNS.
const ATLAS_GITHUB_ACCOUNTS = ["EstebanPdN", "EstebanPdNS"];

function toAtlasGitHubAccounts(
  discovery: SourceControlDiscoveryResult | null | undefined,
): readonly AtlasGitHubAccount[] {
  const github = discovery?.sourceControlProviders.find((item) => item.kind === "github");
  const signedIn = new Set(
    (github?.auth.accounts ?? [])
      .filter((entry) => entry.authenticated)
      .map((entry) => entry.account.toLowerCase()),
  );
  return ATLAS_GITHUB_ACCOUNTS.map((account) => ({
    account,
    connected: signedIn.has(account.toLowerCase()),
  }));
}

/**
 * Everything the terminal shows below the logo: installed agents and each
 * one's weekly usage (session lives in the Usage card), lines committed in the
 * project this week, and the GitHub accounts' sign-in state.
 */
export function useAtlasTerminalSummary(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): Omit<AtlasTerminalMeta, "projectName"> {
  // One discovery call answers both the GitHub sign-in state and this week's commits.
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: cwd === null ? {} : { activityCwd: cwd },
        }),
  );
  const providers = useAgentProviders(environmentId);
  const agents = [...new Set(providers.map(providerLabel))];
  const usage = providersWithLimits(providers).map((provider) => {
    const windows = provider.usageLimits?.windows ?? [];
    const weekly = windows.find((window) => window.kind === "weekly") ?? windows[0];
    return { label: providerLabel(provider), percent: weekly?.usedPercent ?? null };
  });
  return {
    agents,
    usage,
    week: discovery.data?.weeklyActivity ?? null,
    github: toAtlasGitHubAccounts(discovery.data),
  };
}

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

// Fixed colors for the breakdown, in the order rows appear (Claude's /context: messages,
// system tools, system prompt, then smaller rows); the reserve and free space stay neutral.
const CONTEXT_ROW_TONES = [
  "bg-info",
  "bg-primary",
  "bg-success",
  "bg-warning",
  "bg-muted-foreground/80",
  "bg-muted-foreground/60",
  "bg-muted-foreground/45",
];

interface ContextRow {
  readonly name: string;
  readonly tokens: number;
  readonly kind: "used" | "free" | "buffer" | "deferred";
}

/** The provider's own categories, or what every provider reports: input, cache, output. */
function contextRows(contextWindow: ContextWindowSnapshot, maxTokens: number): ContextRow[] {
  if (contextWindow.contextCategories && contextWindow.contextCategories.length > 0) {
    // Like Claude Code's /context: what fills the window first, deferred tools last.
    return contextWindow.contextCategories
      .filter((row) => row.tokens > 0 || row.kind === "free")
      .toSorted(
        (left, right) => Number(left.kind === "deferred") - Number(right.kind === "deferred"),
      );
  }
  const cached = contextWindow.cachedInputTokens ?? 0;
  const input = Math.max(0, (contextWindow.inputTokens ?? 0) - cached);
  const rows: ContextRow[] = [
    { name: "Input", tokens: input, kind: "used" },
    { name: "Cached input", tokens: cached, kind: "used" },
    { name: "Output", tokens: contextWindow.outputTokens ?? 0, kind: "used" },
    { name: "Reasoning", tokens: contextWindow.reasoningOutputTokens ?? 0, kind: "used" },
  ];
  return [
    ...rows.filter((row) => row.tokens > 0),
    { name: "Free space", tokens: Math.max(0, maxTokens - contextWindow.usedTokens), kind: "free" },
  ];
}

// Claude Code's own /context colors for its categories.
const CLAUDE_CATEGORY_COLORS: Readonly<Record<string, string>> = {
  Messages: "#5b8def",
  "System tools": "#d97757",
  "System prompt": "#3fb37f",
  Skills: "#d6a33a",
  "Memory files": "#e0679a",
  "MCP tools": "#9b7be0",
  "Custom agents": "#3fb7b0",
};

function contextRowTone(row: ContextRow, usedIndex: number): string {
  if (row.kind === "free") return "bg-foreground/10";
  if (row.kind === "buffer") return "bg-muted-foreground/30";
  if (row.kind === "deferred") return "bg-muted-foreground/20";
  if (CLAUDE_CATEGORY_COLORS[row.name] !== undefined) return "";
  return CONTEXT_ROW_TONES[Math.min(usedIndex, CONTEXT_ROW_TONES.length - 1)]!;
}

function withContextTones(rows: readonly ContextRow[]) {
  const usedRows = rows.filter((row) => row.kind === "used");
  return rows.map((row) => ({
    ...row,
    tone: contextRowTone(row, usedRows.indexOf(row)),
    color: row.kind === "used" ? (CLAUDE_CATEGORY_COLORS[row.name] ?? null) : null,
  }));
}

/** "Memory files 2 ›": the loaded CLAUDE.md / AGENTS.md files, unfolded on click. */
function ContextMemoryFiles(props: {
  readonly files: NonNullable<ContextWindowSnapshot["contextMemoryFiles"]>;
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
      {open ? (
        <ul className="mt-1.5 grid gap-1 ps-5">
          {props.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-muted-foreground">
              <Tooltip>
                <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                  {file.path.split("/").slice(-2).join("/")}
                </TooltipTrigger>
                <TooltipPopup>{file.path}</TooltipPopup>
              </Tooltip>
              <span className="tabular-nums">{formatContextWindowTokens(file.tokens)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatShare(tokens: number, maxTokens: number): string {
  return `${((tokens / maxTokens) * 100).toFixed(1)}%`;
}

/** "Context": how full the context window is, row by row like Claude Code's /context. */
export function AtlasContextSection({
  contextWindow,
}: {
  readonly contextWindow: ContextWindowSnapshot | null;
}) {
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
  const maxTokens = contextWindow.maxTokens;
  const percent = Math.round(contextWindow.usedPercentage ?? 0);
  const rows = withContextTones(contextRows(contextWindow, maxTokens));
  const barRows = rows.filter((row) => row.kind === "used" || row.kind === "buffer");
  const untilCompact =
    contextWindow.autoCompactThreshold != null
      ? Math.max(0, contextWindow.autoCompactThreshold - contextWindow.usedTokens)
      : null;
  return (
    <ThreadDetailsSection headingId="atlas-context-heading" title="Context">
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
        <dl className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
          {rows.map((row) => (
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
              <dt className="min-w-0 flex-1 truncate text-muted-foreground">{row.name}</dt>
              <dd className="w-14 text-right text-muted-foreground tabular-nums">
                {formatContextWindowTokens(row.tokens)}
              </dd>
              <dd className="w-12 text-right tabular-nums">
                {row.kind === "deferred" ? "—" : formatShare(row.tokens, maxTokens)}
              </dd>
            </div>
          ))}
        </dl>
        {contextWindow.contextMemoryFiles && contextWindow.contextMemoryFiles.length > 0 ? (
          <ContextMemoryFiles files={contextWindow.contextMemoryFiles} />
        ) : null}
        {untilCompact !== null ? (
          <p className="mt-3 text-xs text-muted-foreground tabular-nums">
            {formatContextWindowTokens(untilCompact)} until auto-compact
          </p>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

/** "Usage": subscription windows (session, weekly) for Claude Code and Codex. */
export function AtlasUsageSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  // Codex first, then Claude Code.
  const providers = providersWithLimits(useAgentProviders(environmentId)).toSorted(
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
        aria-label="Open usage statistics"
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
              <span className="text-sm font-medium">{providerLabel(provider)}</span>
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
            <span
              data-atlas-activity
              aria-label="Running"
              className="inline-grid grid-cols-2 gap-0.5"
            >
              <span className="size-1 rounded-full bg-primary" />
              <span className="size-1 rounded-full bg-primary" />
              <span className="col-span-2 mx-auto size-1 rounded-full bg-primary" />
            </span>
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
