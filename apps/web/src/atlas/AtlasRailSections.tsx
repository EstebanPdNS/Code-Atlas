import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import { formatResetsIn, limitsNotice, providersWithLimits } from "@t3tools/shared/usageLimits";
import { SquareTerminalIcon, WorkflowIcon } from "lucide-react";

import { ThreadDetailsSection } from "~/components/chat/ThreadDetailsSection";
import { useNowMinute } from "~/hooks/useNowMinute";
import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { formatProviderDriverKindLabel } from "~/providerModels";
import { useEnvironmentProviders } from "~/state/environments";
import { useKnownTerminalSessions } from "~/state/terminalSessions";

import type { AtlasUsageEntry } from "./atlasIntro";

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

/** Installed agents and each one's weekly usage, for the terminal (session lives in the Usage card). */
export function useAtlasAgentSummary(environmentId: EnvironmentId | null): {
  readonly agents: readonly string[];
  readonly usage: readonly AtlasUsageEntry[];
} {
  const providers = useAgentProviders(environmentId);
  const agents = [...new Set(providers.map(providerLabel))];
  const usage = providersWithLimits(providers).map((provider) => {
    const windows = provider.usageLimits?.windows ?? [];
    const weekly = windows.find((window) => window.kind === "weekly") ?? windows[0];
    return { label: providerLabel(provider), percent: weekly?.usedPercent ?? null };
  });
  return { agents, usage };
}

function Meter({ percent, className }: { readonly percent: number; readonly className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

/** "Context": how full the active provider thread's context window is. */
export function AtlasContextSection({
  contextWindow,
}: {
  readonly contextWindow: ContextWindowSnapshot | null;
}) {
  if (contextWindow === null || contextWindow.maxTokens == null) {
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
  const percent = Math.round(contextWindow.usedPercentage ?? 0);
  const rows = [
    { label: "Input", value: contextWindow.inputTokens, tone: "bg-primary" },
    { label: "Cached", value: contextWindow.cachedInputTokens, tone: "bg-info" },
    { label: "Output", value: contextWindow.outputTokens, tone: "bg-success" },
  ].flatMap((row) =>
    typeof row.value === "number" && row.value > 0 ? [{ ...row, value: row.value }] : [],
  );
  return (
    <ThreadDetailsSection headingId="atlas-context-heading" title="Context">
      <div className="px-1.5 pb-1">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium tabular-nums">{percent}% used</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatContextWindowTokens(contextWindow.usedTokens)} /{" "}
            {formatContextWindowTokens(contextWindow.maxTokens ?? null)}
          </span>
        </div>
        <Meter percent={percent} className="mt-2" />
        {rows.length > 0 ? (
          <dl className="mt-3 grid gap-1.5 text-xs">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span aria-hidden className={cn("size-2 rounded-xs", row.tone)} />
                <dt className="flex-1 text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">{formatContextWindowTokens(row.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

/** "Usage": subscription windows (session, weekly) for Claude Code and Codex. */
export function AtlasUsageSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const providers = providersWithLimits(useAgentProviders(environmentId));
  // useNowMinute is a UTC ISO minute without a zone suffix.
  const now = Date.parse(`${useNowMinute()}Z`);
  if (providers.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="atlas-usage-heading" title="Usage">
      <div className="grid gap-3 px-1.5 pb-1">
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
                    <Meter percent={window.usedPercent} />
                    {resets ? (
                      <span className="text-2xs text-muted-foreground">{resets}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
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
