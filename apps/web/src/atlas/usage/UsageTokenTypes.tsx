import { formatPercent } from "@t3tools/shared/usageFormat";

import type { ShareSegment } from "../../components/usage/UsageShareBar";
import { tokenTypeShares } from "./tokenTypeShares";

/**
 * Code Atlas: tokens by type as one row per type (value, share, bar), in the
 * row style of Token efficiency per dollar beside it. The rows spread over the
 * grid row's height so the column has no empty block under it.
 */
export function UsageTokenTypes({
  label,
  segments,
  format,
}: {
  readonly label: string;
  readonly segments: readonly ShareSegment[];
  readonly format: (value: number) => string;
}) {
  const rows = tokenTypeShares(segments);
  if (rows.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-sm font-medium text-foreground">{label}</h3>
      <div className="flex flex-1 flex-col justify-between gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: row.color }}
                />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-foreground">{format(row.value)}</span>
                <span className="ml-2 text-muted-foreground">{formatPercent(row.share)}</span>
              </span>
            </div>
            <span aria-hidden className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <span
                data-atlas-bar
                className="block h-full rounded-full"
                style={{
                  width: `max(0.5rem, ${row.share * 100}%)`,
                  backgroundColor: row.color,
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
