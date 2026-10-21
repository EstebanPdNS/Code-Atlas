import type { ServerProviderUsageWindow, UsageProviderKind } from "@t3tools/contracts";
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import {
  formatEquivalentUsd,
  formatRatio,
  subscriptionMonthlyUsd,
  tokenEfficiency,
  weeklyLimitWindow,
  weeklyWindowStartMs,
} from "./tokenEfficiency";

const WEEK_MINS = 7 * 24 * 60;

function day(date: string, byProvider: Partial<Record<UsageProviderKind, number>>): DailyTotals {
  const entries = Object.entries(byProvider) as [UsageProviderKind, number][];
  return {
    day: date,
    costUsd: 0,
    totalTokens: entries.reduce((sum, [, tokens]) => sum + tokens, 0),
    byProvider: new Map(
      entries.map(([provider, tokens]) => [provider, { costUsd: 0, totalTokens: tokens }]),
    ),
  };
}

function weekly(usedPercent: number, resetsAt?: string): ServerProviderUsageWindow {
  return {
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    usedPercent,
    windowDurationMins: WEEK_MINS,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

describe("subscriptionMonthlyUsd", () => {
  it("switches Codex from $200 to $100 on 2026-10-29, local time", () => {
    expect(subscriptionMonthlyUsd("codex", new Date(2026, 9, 28, 23, 59))).toBe(200);
    expect(subscriptionMonthlyUsd("codex", new Date(2026, 9, 29, 0, 0))).toBe(100);
    expect(subscriptionMonthlyUsd("codex", new Date(2027, 0, 1))).toBe(100);
  });

  it("keeps Claude Code at $100", () => {
    expect(subscriptionMonthlyUsd("claude", new Date(2026, 9, 21))).toBe(100);
    expect(subscriptionMonthlyUsd("claude", new Date(2026, 10, 1))).toBe(100);
  });
});

describe("weeklyLimitWindow", () => {
  it("prefers the account-wide weekly window over a model-specific one", () => {
    const fable = { ...weekly(0), id: "seven_day_fable", label: "Weekly · Fable" };
    const session = { ...weekly(73), id: "five_hour", kind: "session" as const, label: "Session" };
    expect(weeklyLimitWindow([session, fable, weekly(25)])?.usedPercent).toBe(25);
    expect(weeklyLimitWindow([session, fable])?.id).toBe("seven_day_fable");
    expect(weeklyLimitWindow([session])).toBeUndefined();
  });
});

describe("weeklyWindowStartMs", () => {
  const now = Date.parse("2026-10-21T08:00:00Z");

  it("is the reset minus the window length", () => {
    expect(weeklyWindowStartMs(weekly(20, "2026-10-27T05:00:00Z"), now)).toBe(
      Date.parse("2026-10-20T05:00:00Z"),
    );
  });

  it("falls back to the past seven days without a reset time", () => {
    expect(weeklyWindowStartMs(weekly(20), now)).toBe(Date.parse("2026-10-14T08:00:00Z"));
  });
});

describe("tokenEfficiency", () => {
  const now = new Date("2026-10-21T08:00:00Z");
  const daily = [
    day("2026-10-15", { claude: 999_000_000, codex: 999_000_000 }),
    day("2026-10-16", { claude: 400_000_000 }),
    day("2026-10-20", { claude: 910_000_000, codex: 100_000_000 }),
    day("2026-10-21", { codex: 64_400_000 }),
  ];

  it("divides each window's tokens by price × weekly allowance used and compares them", () => {
    const result = tokenEfficiency({
      daily,
      timeZone: "UTC",
      now,
      weeklyWindows: {
        // Opened 2026-10-16 and 2026-10-20: earlier days stay out.
        claude: weekly(25, "2026-10-23T09:00:00Z"),
        codex: weekly(20, "2026-10-27T05:00:00Z"),
      },
    });
    expect(result?.rows).toEqual([
      {
        provider: "claude",
        weeklyTokens: 1_310_000_000,
        equivalentUsd: 25,
        tokensPerDollar: 52_400_000,
      },
      {
        provider: "codex",
        weeklyTokens: 164_400_000,
        equivalentUsd: 40,
        tokensPerDollar: 4_110_000,
      },
    ]);
    expect(result?.lead?.provider).toBe("claude");
    expect(result?.lead?.ratio).toBeCloseTo(12.75, 2);
  });

  it("uses the Codex price in effect on the given day", () => {
    const result = tokenEfficiency({
      daily: [day("2026-10-29", { codex: 40_000_000 })],
      timeZone: "UTC",
      now: new Date(2026, 9, 29, 12),
      weeklyWindows: { codex: weekly(20) },
    });
    expect(result?.rows[0]?.equivalentUsd).toBe(20);
    expect(result?.rows[0]?.tokensPerDollar).toBe(2_000_000);
  });

  it("shows a provider without a weekly limit as missing and drops the comparison", () => {
    const result = tokenEfficiency({
      daily,
      timeZone: "UTC",
      now,
      weeklyWindows: { claude: weekly(25, "2026-10-23T09:00:00Z") },
    });
    expect(result?.rows.map((row) => [row.provider, row.tokensPerDollar])).toEqual([
      ["claude", 52_400_000],
      ["codex", null],
    ]);
    expect(result?.lead).toBeNull();
  });

  it("has no figure when no allowance is used yet", () => {
    expect(
      tokenEfficiency({
        daily,
        timeZone: "UTC",
        now,
        weeklyWindows: { claude: weekly(0), codex: weekly(0) },
      }),
    ).toBeNull();
  });

  it("is null without weekly limits", () => {
    expect(tokenEfficiency({ daily, timeZone: "UTC", now, weeklyWindows: {} })).toBeNull();
    expect(tokenEfficiency({ daily: [], timeZone: "UTC", now, weeklyWindows: {} })).toBeNull();
  });

  it("leaves out a provider with neither a limit nor tokens this week", () => {
    const result = tokenEfficiency({
      daily: [day("2026-10-20", { claude: 10_000_000 })],
      timeZone: "UTC",
      now,
      weeklyWindows: { claude: weekly(10, "2026-10-23T09:00:00Z") },
    });
    expect(result?.rows.map((row) => row.provider)).toEqual(["claude"]);
  });
});

describe("formatting", () => {
  it("formats the lead ratio", () => {
    expect(formatRatio(12.75)).toBe("12.8×");
    expect(formatRatio(1.5)).toBe("1.5×");
    expect(formatRatio(2)).toBe("2×");
    expect(formatRatio(140.4)).toBe("140×");
  });

  it("formats subscription equivalents", () => {
    expect(formatEquivalentUsd(25)).toBe("$25");
    expect(formatEquivalentUsd(12.5)).toBe("$12.50");
  });
});
