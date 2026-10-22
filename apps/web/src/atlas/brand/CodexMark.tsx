import { useId, type SVGProps } from "react";

// The Codex app icon's colors: lavender at the top, a deep blue at the bottom.
const CODEX_CLOUD_STOPS = ["#b3a8fd", "#7a9cfc", "#3a47ff"] as const;
const CODEX_PROMPT_COLOR = "#ffffff";

/**
 * Code Atlas: the Codex app's mark (a blue-to-violet cloud with a prompt) on
 * a transparent background, for places that name Codex the app, where the
 * OpenAI knot would read as ChatGPT.
 */
export function CodexMark(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId();
  return (
    <svg {...props} viewBox="2 2 28 28">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="3" x2="0" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={CODEX_CLOUD_STOPS[0]} />
          <stop offset="0.5" stopColor={CODEX_CLOUD_STOPS[1]} />
          <stop offset="1" stopColor={CODEX_CLOUD_STOPS[2]} />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <circle cx="16" cy="16" r="9.4" />
        <circle cx="12.91" cy="9.38" r="5.8" />
        <circle cx="19.25" cy="9.46" r="5.8" />
        <circle cx="23.14" cy="14.46" r="5.8" />
        <circle cx="21.65" cy="20.62" r="5.8" />
        <circle cx="15.91" cy="23.3" r="5.8" />
        <circle cx="10.24" cy="20.48" r="5.8" />
        <circle cx="8.9" cy="14.29" r="5.8" />
      </g>
      <path
        d="M9.6 12.1 12.4 16.2l-2.8 3.9M16.7 19.9h5.9"
        fill="none"
        stroke={CODEX_PROMPT_COLOR}
        strokeWidth="1.95"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
