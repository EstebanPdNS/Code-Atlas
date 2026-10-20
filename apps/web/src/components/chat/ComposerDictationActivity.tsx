import type { VoiceInputPhase } from "@t3tools/client-runtime/voice-input";
import { useEffect, useRef } from "react";

import type { DictationLevel } from "~/dictation/dictationLevel";
import { WAVEFORM_REST_SCALE, driveScrollingWaveform } from "~/dictation/dictationWaveform";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";

// Code Atlas: a longer, scrolling trace (see driveScrollingWaveform).
const BAR_COUNT = 22;
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => index);

/**
 * Bars that follow the microphone while it is live. They rest as dots while
 * transcribing, while idle, and under reduced motion.
 */
function DictationWaveform(props: { readonly level: DictationLevel; readonly live: boolean }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const animate = props.live && !reduceMotion;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const bars = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    if (animate) return driveScrollingWaveform(bars, props.level);
    for (const bar of bars) bar.style.transform = `scaleY(${WAVEFORM_REST_SCALE})`;
    return undefined;
  }, [animate, props.level]);

  return (
    <span ref={containerRef} className="flex h-4 items-center gap-0.5" aria-hidden="true">
      {BARS.map((index) => (
        <span
          key={index}
          className={cn(
            "h-4 w-0.5 rounded-full bg-muted-foreground",
            animate && "will-change-transform",
          )}
          style={{ transform: `scaleY(${WAVEFORM_REST_SCALE})` }}
        />
      ))}
    </span>
  );
}

/**
 * What the dictation control reveals beside its buttons: only the live trace,
 * like Claude's voice input. It stays mounted while idle (resting, no timer) so
 * the control can fold it away smoothly; transcribing dims it to resting dots.
 * Escape cancels (see useDictationHoldShortcut).
 */
export function ComposerDictationActivity(props: {
  readonly phase: VoiceInputPhase;
  readonly level: DictationLevel;
}) {
  // Capture starts while the session is still being set up, so the trace reacts from the first word.
  const listening = props.phase === "recording" || props.phase === "preparing";
  return (
    <span
      className={cn(
        "flex items-center pr-2 pl-1 transition-opacity duration-150",
        !listening && "opacity-45",
      )}
    >
      <DictationWaveform level={props.level} live={listening} />
    </span>
  );
}
