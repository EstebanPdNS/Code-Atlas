import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { DailyTotals } from "@t3tools/shared/usageMerge";

/** The subscriptions compared on the Usage page, by usage provider kind. */
export type SubscriptionProvider = "claude" | "codex";

export const SUBSCRIPTION_PROVIDERS: readonly SubscriptionProvider[] = ["claude", "codex"];

interface PriceStep {
  /** Local calendar day (YYYY-MM-DD) the price starts on; null for the first price. */
  readonly fromDay: string | null;
  readonly monthlyUsd: number;
}

/**
 * Monthly subscription prices, oldest first. A step applies from its local
 * calendar day on, so a price change switches over without a release.
 */
export const SUBSCRIPTION_PRICE_SCHEDULE: Record<SubscriptionProvider, readonly PriceStep[]> = {
  claude: [{ fromDay: null, monthlyUsd: 100 }],
  codex: [
    { fromDay: null, monthlyUsd: 200 },
    { fromDay: "2026-10-29", monthlyUsd: 100 },
  ],
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function subscriptionMonthlyUsd(provider: SubscriptionProvider, now: Date): number {
  const today = localDay(now);
  let price = 0;
  for (const step of SUBSCRIPTION_PRICE_SCHEDULE[provider]) {
    if (step.fromDay === null || step.fromDay <= today) price = step.monthlyUsd;
  }
  return price;
}

/** The account-wide weekly window; model-specific ones ("Weekly · Fable") only as a fallback. */
export function weeklyLimitWindow(
  windows: readonly ServerProviderUsageWindow[],
): ServerProviderUsageWindow | undefined {
  const weekly = windows.filter((window) => window.kind === "weekly");
  return weekly.find((window) => window.label === "Weekly") ?? weekly[0];
}

/** When the current weekly window opened: its reset minus its length, else the past 7 days. */
export function weeklyWindowStartMs(window: ServerProviderUsageWindow, nowMs: number): number {
  const lengthMs =
    window.windowDurationMins === undefined ? WEEK_MS : window.windowDurationMins * 60_000;
  const resetsAtMs = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  const startMs = resetsAtMs - lengthMs;
  return Number.isFinite(startMs) && startMs <= nowMs ? startMs : nowMs - WEEK_MS;
}

function dayInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/**
 * A provider's processed tokens from the calendar day its weekly window opened
 * on. Usage is bucketed by day, so the opening day counts whole.
 */
export function tokensSince(
  daily: readonly DailyTotals[],
  provider: SubscriptionProvider,
  startMs: number,
  timeZone: string,
): number {
  const startDay = dayInZone(startMs, timeZone);
  return daily.reduce(
    (sum, entry) =>
      entry.day >= startDay ? sum + (entry.byProvider.get(provider)?.totalTokens ?? 0) : sum,
    0,
  );
}

export interface ProviderEfficiency {
  readonly provider: SubscriptionProvider;
  readonly weeklyTokens: number;
  /** Monthly price × weekly allowance used; null without a weekly limit. */
  readonly equivalentUsd: number | null;
  readonly tokensPerDollar: number | null;
}

export interface TokenEfficiency {
  /** Most tokens per dollar first; providers without a figure last. */
  readonly rows: readonly ProviderEfficiency[];
  /** How many times more tokens per dollar the first row gets than the second. */
  readonly lead: { readonly provider: SubscriptionProvider; readonly ratio: number } | null;
}

/**
 * Tokens per subscription dollar for each provider in its current weekly
 * window. A provider counts when it has a weekly limit or tokens this week;
 * null when no provider has a figure to compare.
 */
export function tokenEfficiency({
  daily,
  timeZone,
  weeklyWindows,
  now,
}: {
  readonly daily: readonly DailyTotals[];
  readonly timeZone: string;
  readonly weeklyWindows: Partial<Record<SubscriptionProvider, ServerProviderUsageWindow>>;
  readonly now: Date;
}): TokenEfficiency | null {
  const nowMs = now.getTime();
  const rows = SUBSCRIPTION_PROVIDERS.flatMap((provider): ProviderEfficiency[] => {
    const window = weeklyWindows[provider];
    const startMs = window === undefined ? nowMs - WEEK_MS : weeklyWindowStartMs(window, nowMs);
    const weeklyTokens = tokensSince(daily, provider, startMs, timeZone);
    if (window === undefined && weeklyTokens === 0) return [];
    const equivalentUsd =
      window === undefined
        ? null
        : (subscriptionMonthlyUsd(provider, now) * window.usedPercent) / 100;
    const tokensPerDollar =
      equivalentUsd === null || equivalentUsd <= 0 ? null : weeklyTokens / equivalentUsd;
    return [{ provider, weeklyTokens, equivalentUsd, tokensPerDollar }];
  });
  if (rows.every((row) => row.tokensPerDollar === null)) return null;

  const sorted = rows.toSorted(
    (left, right) => (right.tokensPerDollar ?? -1) - (left.tokensPerDollar ?? -1),
  );
  const [first, second] = sorted;
  const best = first?.tokensPerDollar ?? null;
  const next = second?.tokensPerDollar ?? null;
  const lead =
    first !== undefined && best !== null && next !== null && next > 0
      ? { provider: first.provider, ratio: best / next }
      : null;
  return { rows: sorted, lead };
}

/** "12.8×", "1.05×", "140×". */
export function formatRatio(ratio: number): string {
  const digits = ratio >= 100 ? 0 : ratio >= 10 ? 1 : 2;
  return `${ratio
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "")}×`;
}

/** Whole dollars without cents ("$25"), otherwise to the cent ("$12.50"). */
export function formatEquivalentUsd(value: number): string {
  const cents = Math.round(value * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
