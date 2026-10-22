import { useId, type SVGProps } from "react";

import { CODEX_GRADIENT_STOPS } from "./providerColors";

/**
 * Code Atlas: the Codex app's mark (a blue-to-violet tile with a prompt) for
 * places that name Codex the app, where the OpenAI knot would read as ChatGPT.
 */
export function CodexMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  const gradientId = useId();
  return (
    <svg {...props} viewBox="0 0 32 32" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={CODEX_GRADIENT_STOPS[0]} />
          <stop offset="1" stopColor={CODEX_GRADIENT_STOPS[1]} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M9.5 11.5 14 16l-4.5 4.5M16.5 21h6"
        fill="none"
        stroke="var(--color-zinc-25)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
