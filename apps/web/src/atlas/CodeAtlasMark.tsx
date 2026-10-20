import { useId } from "react";

import { cn } from "~/lib/utils";

/** The folded-map-and-brackets glyph from the Code Atlas icon (48-unit grid). */
export function CodeAtlasGlyph({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="18"
          y1="6"
          x2="30"
          y2="42"
        >
          <stop stopColor="var(--atlas-glyph-0)" />
          <stop offset="0.34" stopColor="var(--atlas-glyph-1)" />
          <stop offset="0.72" stopColor="var(--atlas-glyph-2)" />
          <stop offset="1" stopColor="var(--atlas-glyph-3)" />
        </linearGradient>
      </defs>
      <g
        stroke={`url(#${gradientId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 11 17 6 31 11 43 6v31l-12 5-14-5-12 5V11Z" />
        <path d="M17 6v9m0 17v5M31 11v5m0 17v9" />
        <path d="m21 19-5 5 5 5m6-10 5 5-5 5" />
      </g>
    </svg>
  );
}

/** "code atlas." lockup used in the sidebar header, like the handbook site. */
export function CodeAtlasWordmark({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "lg";
}) {
  return (
    <span
      data-atlas-wordmark={size}
      className={cn(
        "inline-flex min-w-0 items-center",
        size === "lg" ? "gap-2" : "gap-1.5",
        className,
      )}
    >
      <CodeAtlasGlyph className={cn("shrink-0", size === "lg" ? "size-[1.15em]" : "size-4")} />
      <span
        className={cn(
          "truncate font-mono font-bold tracking-tight",
          size === "lg" ? undefined : "text-sm",
        )}
      >
        code atlas<span className="text-primary">.</span>
      </span>
    </span>
  );
}
