import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { formatResetsIn } from "@t3tools/shared/usageLimits";

import { useNowMinute } from "../../hooks/useNowMinute";
import { environmentPresentations } from "../../state/presentation";
import { atlasProviderFill } from "../../atlas/brand/providerColors";
import { barColor } from "./UsageLimits";

const PROVIDER_ORDER: ReadonlyArray<{ readonly driver: string; readonly label: string }> = [
  { driver: "codex", label: "Codex" },
  { driver: "claudeAgent", label: "Claude Code" },
];

interface LimitCell {
  readonly id: string;
  readonly driver: ServerProvider["driver"];
  readonly title: string;
  readonly window: ServerProviderUsageWindow;
}

/** Session and weekly windows (including model-specific weekly ones), Codex first. */
function limitCells(providers: readonly ServerProvider[]): LimitCell[] {
  return PROVIDER_ORDER.flatMap(({ driver, label }) => {
    const provider = providers.find(
      (candidate) =>
        candidate.driver === driver && (candidate.usageLimits?.windows.length ?? 0) > 0,
    );
    if (provider === undefined) return [];
    return (provider.usageLimits?.windows ?? [])
      .filter((window) => window.kind === "session" || window.kind === "weekly")
      .toSorted((left, right) => Number(left.kind === "weekly") - Number(right.kind === "weekly"))
      .map((window) => ({
        id: `${driver}:${window.id}`,
        driver: provider.driver,
        title: `${label} · ${window.label}`,
        window,
      }));
  });
}

/**
 * Code Atlas: the current subscription limits on the Tokens view, before the
 * breakdown, in the same style as Totals.
 */
export function UsageTokenLimits() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // useNowMinute is a UTC ISO minute without a zone suffix.
  const now = Date.parse(`${useNowMinute()}Z`);
  const providers = [...presentations.values()].flatMap(
    (presentation) => presentation.serverConfig?.providers ?? [],
  );
  const cells = limitCells(providers);
  if (cells.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Limits</h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-4">
        {cells.map((cell) => {
          const used = Math.round(cell.window.usedPercent);
          const resets = formatResetsIn(cell.window, now);
          return (
            <div key={cell.id} className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-xs text-muted-foreground">{cell.title}</span>
              <span className="text-base font-medium text-foreground tabular-nums">
                {used}% used
              </span>
              <span aria-hidden className="h-1 overflow-hidden rounded-full bg-foreground/10">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, used))}%`,
                    background: atlasProviderFill(cell.driver) ?? barColor(cell.driver),
                  }}
                />
              </span>
              {resets ? (
                <span className="text-2xs text-muted-foreground tabular-nums">{resets}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
