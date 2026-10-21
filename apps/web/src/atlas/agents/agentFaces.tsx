/**
 * Code Atlas agent faces: pastel geometric shapes with a small cartoon face,
 * one per subagent (see agentPersona). The shapes, expressions and colors were
 * generated with Codex as 32×32 vector art, so they stay crisp at any size.
 */
import type { AgentPersona } from "./agentPersona";

const AGENT_SHAPES = {
  circle: "M 30 16 A 14 14 0 1 1 2 16 A 14 14 0 1 1 30 16 Z",
  roundedSquare: "M 9 2 H 23 Q 30 2 30 9 V 23 Q 30 30 23 30 H 9 Q 2 30 2 23 V 9 Q 2 2 9 2 Z",
  triangle:
    "M 14.712 3.986 Q 16 1.5 17.288 3.986 L 29.212 27.014 Q 30.5 29.5 27.7 29.5 L 4.3 29.5 Q 1.5 29.5 2.788 27.014 Z",
  star: "M 15.067 2.421 Q 16 1 16.933 2.421 L 20.816 8.337 Q 21.173 8.881 21.8 9.052 L 28.626 10.917 Q 30.266 11.365 29.202 12.691 L 24.776 18.212 Q 24.369 18.719 24.4 19.369 L 24.736 26.437 Q 24.817 28.135 23.227 27.534 L 16.608 25.03 Q 16 24.8 15.392 25.03 L 8.773 27.534 Q 7.183 28.135 7.264 26.437 L 7.6 19.369 Q 7.631 18.719 7.224 18.212 L 2.798 12.691 Q 1.734 11.365 3.374 10.917 L 10.2 9.052 Q 10.827 8.881 11.184 8.337 Z",
  hexagon:
    "M 8.356 3.743 Q 9 2.5 10.4 2.5 L 21.6 2.5 Q 23 2.5 23.644 3.743 L 29.356 14.757 Q 30 16 29.356 17.243 L 23.644 28.257 Q 23 29.5 21.6 29.5 L 10.4 29.5 Q 9 29.5 8.356 28.257 L 2.644 17.243 Q 2 16 2.644 14.757 Z",
  diamond:
    "M 14.232 2.768 Q 16 1 17.768 2.768 L 29.232 14.232 Q 31 16 29.232 17.768 L 17.768 29.232 Q 16 31 14.232 29.232 L 2.768 17.768 Q 1 16 2.768 14.232 Z",
} as const;

// Faces sit a little larger on the roomy shapes, like app mascots; the
// triangle and star keep them at size so they stay inside the outline.
const FACE_SCALE: Readonly<Record<keyof typeof AGENT_SHAPES, number>> = {
  circle: 1.25,
  roundedSquare: 1.25,
  triangle: 1,
  star: 1,
  hexagon: 1.25,
  diamond: 1.25,
};

const AGENT_FACES = {
  happy: (
    <>
      <path
        d="M 9.8 17.8 Q 12 13.8 14.2 17.8 M 17.8 17.8 Q 20 13.8 22.2 17.8 M 13.6 21 Q 16 23 18.4 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  wink: (
    <>
      <path
        d="M 10.3 15.6 L 12.6 17.5 L 10.3 19.2 M 14 21 Q 16.3 22.7 18.6 20.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="17.4" r="1.4" fill="currentColor" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="17.5" r="1.55" fill="currentColor" />
      <circle cx="20" cy="17.5" r="1.55" fill="currentColor" />
    </>
  ),
  sleepy: (
    <>
      <path
        d="M 9.8 17 Q 12 20 14.2 17 M 17.8 17 Q 20 20 22.2 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  surprised: (
    <>
      <circle cx="12" cy="16.8" r="1.5" fill="currentColor" />
      <circle cx="20" cy="16.8" r="1.5" fill="currentColor" />
      <ellipse cx="16" cy="21" rx="1.35" ry="1.7" fill="currentColor" />
    </>
  ),
  determined: (
    <>
      <path
        d="M 10.1 14.6 L 13.6 15.7 M 18.4 15.7 L 21.9 14.6 M 14.4 21.5 H 17.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="18.1" r="1.25" fill="currentColor" />
      <circle cx="20" cy="18.1" r="1.25" fill="currentColor" />
    </>
  ),
  smug: (
    <>
      <path
        d="M 10.5 15.6 L 13 17.5 L 10.5 19.4 M 21.5 15.6 L 19 17.5 L 21.5 19.4 M 14.3 21.3 Q 16.6 22.3 18.7 20.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  shy: (
    <>
      <circle cx="12" cy="18" r="1.05" fill="currentColor" />
      <circle cx="20" cy="18" r="1.05" fill="currentColor" />
      <path
        d="M 14.5 21 Q 16 22.4 17.5 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
} as const;

export const AGENT_SHAPE_NAMES = Object.keys(AGENT_SHAPES) as Array<keyof typeof AGENT_SHAPES>;
export const AGENT_FACE_NAMES = Object.keys(AGENT_FACES) as Array<keyof typeof AGENT_FACES>;
export const AGENT_FACE_COLORS = [
  "#f2b8d0",
  "#add8f5",
  "#f4e3a1",
  "#c9b8ed",
  "#b8dfc5",
  "#f5c39f",
  "#efaba6",
  "#a8deda",
] as const;

/**
 * One agent's face. Decorative: the agent's name always sits beside it.
 * `fresh` (an agent that is about to start or running) pops the face in, so
 * finished agents do not pop again every time their row remounts.
 */
export function AgentFaceIcon(props: {
  readonly persona: AgentPersona;
  readonly fresh?: boolean;
  readonly className?: string;
}) {
  const scale = FACE_SCALE[props.persona.shape];
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      data-atlas-agent-face
      data-fresh={props.fresh ? "" : undefined}
      className={props.className}
      style={{ color: "#1f1f24" }}
    >
      <path d={AGENT_SHAPES[props.persona.shape]} fill={props.persona.color} />
      <g transform={`translate(16 18) scale(${scale}) translate(-16 -18)`}>
        {AGENT_FACES[props.persona.face]}
      </g>
    </svg>
  );
}
