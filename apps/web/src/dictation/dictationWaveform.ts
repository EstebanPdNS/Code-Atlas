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

// Code Atlas: one new sample per step; between steps the row slides one bar left.
const SCROLL_STEP_MS = 70;
// Resting bars are round dots: 3px wide on a 16px-tall bar.
export const SCROLL_REST_SCALE = 3 / 16;
// Each sample moves this far toward the new level, so bars rise and fall smoothly.
const LEVEL_SMOOTHING = 0.45;
// Bars this close to the left edge shrink as they leave, like Claude's voice input.
const EDGE_SHRINK_BARS = 6;

/**
 * Code Atlas: a scrolling level history, like Claude's voice input. The row
 * slides left continuously, a new sample enters at the right edge every step,
 * and the dots shrink as they reach the left edge, so the trace moves
 * through pauses too. Levels are scaled against an adapting noise floor and
 * peak, so any microphone shows each syllable as a bar while silence rests as
 * dots. Runs on animation frames only while the microphone is live, and only
 * writes `transform`.
 *
 * `row` holds the bars and is translated; `bars` has one more bar than fits, so
 * the slide never shows a gap at the right edge.
 */
export function driveScrollingWaveform(
  row: HTMLElement,
  bars: ReadonlyArray<HTMLElement>,
  level: DictationLevel,
): () => void {
  const count = bars.length;
  const values = new Float32Array(count).fill(SCROLL_REST_SCALE);
  const pitch = count > 1 ? bars[1]!.offsetLeft - bars[0]!.offsetLeft : (bars[0]?.offsetWidth ?? 0);
  let floor = 1;
  let peak = 0;
  let smoothed = 0;
  let lastStep = performance.now();
  let frame = 0;

  const sample = () => {
    const raw = level.read();
    // The floor follows the quietest recent level (room noise); the peak the loudest speech.
    floor = raw < floor ? raw : floor + (raw - floor) * 0.01;
    peak = Math.max(raw, peak * 0.99, floor + 0.08);
    const relative = (raw - floor) / Math.max(0.08, peak - floor);
    const shaped = raw <= 0 ? 0 : Math.min(1, Math.max(0, relative) ** 1.2);
    smoothed += (shaped - smoothed) * LEVEL_SMOOTHING;
    values.copyWithin(0, 1);
    values[count - 1] = Math.max(SCROLL_REST_SCALE, smoothed);
  };

  const draw = (now: number) => {
    // A hidden tab pauses animation frames; resume from now instead of replaying
    // every missed step in one frame.
    if (now - lastStep > 10 * SCROLL_STEP_MS) lastStep = now - SCROLL_STEP_MS;
    while (now - lastStep >= SCROLL_STEP_MS) {
      sample();
      lastStep += SCROLL_STEP_MS;
    }
    const phase = (now - lastStep) / SCROLL_STEP_MS;
    row.style.transform = `translateX(${(-phase * pitch).toFixed(2)}px)`;
    for (let index = 0; index < count; index++) {
      const edge = Math.min(1, Math.max(0, (index - phase) / EDGE_SHRINK_BARS));
      const size = 0.15 + 0.85 * edge;
      bars[index]!.style.transform =
        `scale(${size.toFixed(3)}, ${(values[index]! * size).toFixed(3)})`;
    }
    frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    row.style.transform = "";
    for (const bar of bars) bar.style.transform = `scaleY(${SCROLL_REST_SCALE})`;
  };
}
