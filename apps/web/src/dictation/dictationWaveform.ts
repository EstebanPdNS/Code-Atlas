import type { DictationLevel } from "./dictationLevel";

/** Smallest bar scale; at the indicator's height a resting bar reads as a dot. */
export const WAVEFORM_REST_SCALE = 0.14;

// Levels below the gate are room noise; above it the remaining range is stretched to 0..1.
const NOISE_GATE = 0.18;
// Time constants for easing a bar toward its target: quick to rise, softer to fall.
const RISE_MS = 55;
const FALL_MS = 140;
// Below this distance from its target a bar counts as settled.
const SETTLE_EPSILON = 0.002;

/**
 * Animates the indicator's bars from the live microphone level.
 *
 * Each level push (about 25 a second) sets new targets: a bell-shaped envelope,
 * a ripple that delays outer bars by reading older levels, and a slow per-bar
 * variation so the shape never looks stamped. Bars then ease toward their
 * targets on animation frames, independent of refresh rate, and the frame loop
 * stops as soon as every bar settles, so silence and the transcribing phase
 * cost nothing. Only `transform` is written, so the browser never lays out or
 * repaints the composer. Returns a function that stops driving the bars.
 */
export function driveDictationWaveform(
  bars: ReadonlyArray<HTMLElement>,
  level: DictationLevel,
): () => void {
  const count = bars.length;
  const center = (count - 1) / 2;
  const envelope = bars.map((_, index) => {
    const distance = Math.abs(index - center) / Math.max(1, center);
    return 0.4 + 0.6 * Math.cos((distance * Math.PI) / 2) ** 1.5;
  });
  // Distinct, fixed rates so neighbouring bars drift apart instead of moving in lockstep.
  const rates = bars.map((_, index) => 0.55 + ((index * 0.37) % 0.5));
  const history = new Float32Array(Math.ceil(center) + 1);
  const targets = new Float32Array(count).fill(WAVEFORM_REST_SCALE);
  const values = new Float32Array(count).fill(WAVEFORM_REST_SCALE);
  const written = new Float32Array(count).fill(-1);
  let pushes = 0;
  let frame: number | null = null;
  let lastTime = 0;

  const write = () => {
    for (let index = 0; index < count; index++) {
      const value = values[index]!;
      if (Math.abs(value - written[index]!) < 0.001) continue;
      written[index] = value;
      bars[index]!.style.transform = `scaleY(${value.toFixed(3)})`;
    }
  };

  const step = (time: number) => {
    const elapsed = Math.min(64, time - lastTime);
    lastTime = time;
    let moving = false;
    for (let index = 0; index < count; index++) {
      const value = values[index]!;
      const target = targets[index]!;
      const tau = target > value ? RISE_MS : FALL_MS;
      const next = value + (target - value) * (1 - Math.exp(-elapsed / tau));
      values[index] = Math.abs(target - next) < SETTLE_EPSILON ? target : next;
      if (values[index] !== target) moving = true;
    }
    write();
    frame = moving ? requestAnimationFrame(step) : null;
  };

  const onLevel = (raw: number) => {
    const gated = Math.max(0, (raw - NOISE_GATE) / (1 - NOISE_GATE));
    // Square root lifts quiet speech so normal talking fills most of the height.
    const loudness = Math.sqrt(Math.min(1, gated));
    // An exact 0 means capture stopped, and no further pushes will age the ripple out.
    if (raw <= 0) history.fill(0);
    else history.copyWithin(1, 0);
    history[0] = loudness;
    pushes += 1;
    for (let index = 0; index < count; index++) {
      const delayed = history[Math.round(Math.abs(index - center))]!;
      const variation = 0.78 + 0.22 * Math.sin(pushes * 0.45 * rates[index]! + index * 1.7);
      targets[index] = Math.max(
        WAVEFORM_REST_SCALE,
        Math.min(1, delayed * envelope[index]! * variation),
      );
    }
    if (frame === null) {
      lastTime = performance.now();
      frame = requestAnimationFrame(step);
    }
  };

  write();
  const unsubscribe = level.subscribe(onLevel);
  return () => {
    unsubscribe();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
}

/**
 * Code Atlas: a scrolling level history, like a voice memo. Every level push
 * (about 25 a second) enters at the right edge and older readings slide left,
 * so speech reads as a moving trace; silence rests as a row of dots. Only
 * `transform` is written, once per push, with no frame loop of its own.
 */
export function driveScrollingWaveform(
  bars: ReadonlyArray<HTMLElement>,
  level: DictationLevel,
): () => void {
  const count = bars.length;
  const values = new Float32Array(count).fill(WAVEFORM_REST_SCALE);
  const written = new Float32Array(count).fill(-1);
  const write = () => {
    for (let index = 0; index < count; index++) {
      const value = values[index]!;
      if (Math.abs(value - written[index]!) < 0.001) continue;
      written[index] = value;
      bars[index]!.style.transform = `scaleY(${value.toFixed(3)})`;
    }
  };
  // A slowly adapting floor and ceiling: auto gain keeps speech loud, so bars
  // follow syllables relative to the recent range rather than absolute level.
  let floor = 0;
  let ceiling = 0.35;
  const onLevel = (raw: number) => {
    const gated = Math.max(0, (raw - NOISE_GATE) / (1 - NOISE_GATE));
    ceiling = Math.max(gated, ceiling * 0.985, 0.35);
    floor = gated < floor ? gated : floor + (gated - floor) * 0.02;
    const span = Math.max(0.2, ceiling - floor);
    const shaped = gated <= 0 ? 0 : Math.min(1, Math.max(0, (gated - floor) / span) ** 1.3);
    values.copyWithin(0, 1);
    values[count - 1] = Math.max(WAVEFORM_REST_SCALE, shaped);
    write();
  };
  write();
  const unsubscribe = level.subscribe(onLevel);
  return unsubscribe;
}
