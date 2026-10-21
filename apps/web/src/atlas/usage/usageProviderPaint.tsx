import type { UsageProviderKind } from "@t3tools/contracts";
import { useId } from "react";

import { PROVIDER_PRESENTATION } from "../../components/usage/usageProviders";
import { atlasProviderFill, atlasProviderGradient } from "../brand/providerColors";

/**
 * Code Atlas: a provider's CSS background on the Usage page (legend dots,
 * breakdown and limit bars), with the Codex gradient where it has one.
 */
export function usageProviderFill(provider: UsageProviderKind): string {
  return atlasProviderFill(provider) ?? PROVIDER_PRESENTATION[provider].color;
}

/** An id for the chart's gradients; `useId` output carries characters `url(#…)` rejects. */
export function useUsageChartPaintId(): string {
  return `usage-chart-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** SVG fill or stroke for a provider's chart series. */
export function usageChartPaint(paintId: string, provider: UsageProviderKind): string {
  return atlasProviderGradient(provider) === null
    ? PROVIDER_PRESENTATION[provider].color
    : `url(#${paintId}-${provider})`;
}

/** Horizontal gradients across the plot for the providers `usageChartPaint` points at. */
export function UsageChartGradients({
  paintId,
  providers,
  width,
}: {
  readonly paintId: string;
  readonly providers: readonly UsageProviderKind[];
  readonly width: number;
}) {
  return (
    <defs>
      {providers.map((provider) => {
        const stops = atlasProviderGradient(provider);
        if (stops === null) return null;
        return (
          <linearGradient
            key={provider}
            id={`${paintId}-${provider}`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={width}
            y2={0}
          >
            <stop offset={0} stopColor={stops[0]} />
            <stop offset={1} stopColor={stops[1]} />
          </linearGradient>
        );
      })}
    </defs>
  );
}
