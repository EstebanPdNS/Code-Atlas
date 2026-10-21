import type { ReactNode, SVGProps } from "react";

/**
 * Code Atlas control icons for the composer, the goal bar, the paused task
 * controls and the status line: one family drawn on Lucide's 24-unit grid
 * with Lucide's stroke (2, round caps and joins), so they sit beside the
 * composer's Lucide mic as one set. Geometry adapted from Lucide (ISC,
 * https://lucide.dev/license); the return glyph follows the Claude app's.
 *
 * Straight strokes sit on x ≡ 0.75 (mod 1.5): drawn at 16px that centers
 * them on a device pixel at 1x and on a pixel pair at 2x, so their edges stay
 * crisp instead of smearing across three pixels.
 */
type AtlasIconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function AtlasIcon(props: AtlasIconProps & { readonly children: ReactNode }) {
  const { children, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** ⏎ send, the Claude app's return: a short top stroke, a tight corner, a 45° head. */
export function AtlasReturnIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="M12.75 5.25h5.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4.5" />
      <path d="M9 9.75 4.5 14.25 9 18.75" />
    </AtlasIcon>
  );
}

export function AtlasPaperclipIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
    </AtlasIcon>
  );
}

/** ⏸ as two rounded strokes, the weight of the mic's stem. */
export function AtlasPauseIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="M8.25 4.5v15" />
      <path d="M15.75 4.5v15" />
    </AtlasIcon>
  );
}

/** ▶ outlined; placed between its box center and its centroid so it looks centered. */
export function AtlasPlayIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="M6.75 6Q6.75 4.5 8.04 5.26L18.21 11.24Q19.5 12 18.21 12.76L8.04 18.74Q6.75 19.5 6.75 18Z" />
    </AtlasIcon>
  );
}

export function AtlasStopIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <rect x="5.25" y="5.25" width="13.5" height="13.5" rx="2.25" />
    </AtlasIcon>
  );
}

export function AtlasTrashIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="M3.75 6.75h16.5" />
      <path d="M18.75 6.75V18a2.25 2.25 0 0 1-2.25 2.25h-9A2.25 2.25 0 0 1 5.25 18V6.75" />
      <path d="M9.75 6.75v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5" />
      <path d="M9.75 11.25v4.5" />
      <path d="M14.25 11.25v4.5" />
    </AtlasIcon>
  );
}

/** Open the goal: two diagonal arrows out to the corners. */
export function AtlasExpandIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <path d="M14.25 3.75h6v6" />
      <path d="M9.75 20.25h-6v-6" />
      <path d="M20.25 3.75 14.25 9.75" />
      <path d="M3.75 20.25 9.75 14.25" />
    </AtlasIcon>
  );
}

/** The goal: two rings and a center dot with even air between them. */
export function AtlasTargetIcon(props: AtlasIconProps) {
  return (
    <AtlasIcon {...props}>
      <circle cx="12" cy="12" r="9.75" />
      <circle cx="12" cy="12" r="5.25" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </AtlasIcon>
  );
}
