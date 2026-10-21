import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { formatTokens, makeWindow } from "@t3tools/shared/usageFormat";
import { TrendingUpIcon } from "lucide-react";
import { useState } from "react";

import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import { PROVIDER_PRESENTATION } from "../../components/usage/usageProviders";
import { useNowMinute } from "../../hooks/useNowMinute";
import { environmentPresentations } from "../../state/presentation";
import { useUsage } from "../../state/usage";
import {
  SUBSCRIPTION_PROVIDERS,
  formatEquivalentUsd,
  formatRatio,
  tokenEfficiency,
  weeklyLimitWindow,
  type SubscriptionProvider,
} from "./tokenEfficiency";
import { usageProviderFill } from "./usageProviderPaint";

const SHORT_LABEL: Record<SubscriptionProvider, string> = { claude: "Claude", codex: "Codex" };

/** Eight days, so the day the oldest possible weekly window opened on is always covered. */
const makeWeekWindow = () => makeWindow(8);

/**
 * Code Atlas: tokens per subscription dollar on the Tokens view, from each
 * provider's current weekly window and the weekly limit the Limits section
 * shows. It reads its own week of usage, whatever range the page shows.
 */
export function UsageTokenEfficiency() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // useNowMinute is a UTC ISO minute without a zone suffix.
  const now = new Date(`${useNowMinute()}Z`);
  const today = now.toDateString();
  const [week, setWeek] = useState(() => ({ today, input: makeWeekWindow() }));
  if (week.today !== today) setWeek({ today, input: makeWeekWindow() });
  const { shown, selectedEnvironments } = useUsage(week.input);
  if (shown === null || selectedEnvironments.every((environment) => environment.summary === null)) {
    return null;
  }

  const providers = [...presentations.values()].flatMap(
    (presentation) => presentation.serverConfig?.providers ?? [],
  );
  const weeklyWindows: Partial<Record<SubscriptionProvider, ServerProviderUsageWindow>> = {};
  for (const provider of SUBSCRIPTION_PROVIDERS) {
    const driver = PROVIDER_PRESENTATION[provider].driverKind;
    const limits = providers.find(
      (candidate) =>
        candidate.driver === driver && (candidate.usageLimits?.windows.length ?? 0) > 0,
    )?.usageLimits;
    const window = limits === undefined ? undefined : weeklyLimitWindow(limits.windows);
    if (window !== undefined) weeklyWindows[provider] = window;
  }
  const efficiency = tokenEfficiency({
    daily: shown.merged.daily,
    timeZone: week.input.timeZone,
    weeklyWindows,
    now,
  });
  if (efficiency === null) return null;

  const peak = Math.max(...efficiency.rows.map((row) => row.tokensPerDollar ?? 0));
  const equivalents = SUBSCRIPTION_PROVIDERS.flatMap((provider) => {
    const usd = efficiency.rows.find((row) => row.provider === provider)?.equivalentUsd ?? null;
    return usd === null ? [] : [`${SHORT_LABEL[provider]} ${formatEquivalentUsd(usd)} equivalent`];
  });

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-sm font-medium text-foreground">Token efficiency per dollar</h3>
      <div className="flex flex-col gap-3">
        {efficiency.rows.map((row) => {
          const presentation = PROVIDER_PRESENTATION[row.provider];
          const value = row.tokensPerDollar;
          return (
            <div key={row.provider} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <ProviderInstanceIcon
                    driverKind={presentation.driverKind}
                    displayName={presentation.label}
                    iconClassName="size-3.5"
                  />
                  <span className="truncate">{presentation.label}</span>
                </span>
                <span className="shrink-0 text-foreground tabular-nums">
                  {value === null ? "—" : `${formatTokens(value)} tokens / $`}
                </span>
              </div>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-foreground/10">
                {value !== null && value > 0 && peak > 0 ? (
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `max(0.5rem, ${(value / peak) * 100}%)`,
                      background: usageProviderFill(row.provider),
                    }}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {efficiency.lead === null ? null : (
        <p className="flex items-center gap-1.5 text-sm text-foreground">
          <TrendingUpIcon aria-hidden className="size-4 shrink-0 text-success" />
          <span className="font-medium tabular-nums">
            {formatRatio(efficiency.lead.ratio)} more tokens per dollar
          </span>
          <span className="text-muted-foreground">
            with {PROVIDER_PRESENTATION[efficiency.lead.provider].label}
          </span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {equivalents.length > 0
          ? `Subscription price × weekly allowance used: ${equivalents.join(", ")}. `
          : null}
        Not actual spending or API pricing. Tokens from each provider&apos;s current weekly window,
        counted from the day it opened, whatever range is selected.
      </p>
    </div>
  );
}
