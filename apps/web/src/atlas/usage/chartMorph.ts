interface Point {
  readonly x: number;
  readonly y: number;
}

interface CurveSegment {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

// Enough samples that a 90-day curve keeps its peaks (one every 4 of 960 units).
const SAMPLES = 240;

/**
 * Code Atlas: a smooth curve redrawn as a fixed number of straight samples.
 * CSS can only transition `d` between paths with the same commands, so every
 * period (24 hours, 7, 30 or 90 days) yields the same shape of path and the
 * chart morphs between periods instead of jumping.
 */
export function morphablePath(segments: readonly CurveSegment[], width: number): string {
  if (segments.length === 0) return "";
  let path = "";
  let index = 0;
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const x = (sample / SAMPLES) * width;
    while (index < segments.length - 1 && (segments[index]?.to.x ?? 0) < x) index += 1;
    const segment = segments[index];
    if (segment === undefined) continue;
    const span = segment.to.x - segment.from.x;
    // The control points sit at thirds of the segment, so x is linear in t.
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (x - segment.from.x) / span));
    const u = 1 - t;
    const y =
      u * u * u * segment.from.y +
      3 * u * u * t * segment.c1.y +
      3 * u * t * t * segment.c2.y +
      t * t * t * segment.to.y;
    path += `${sample === 0 ? "M" : " L"}${x.toFixed(1)},${y.toFixed(2)}`;
  }
  return path;
}
