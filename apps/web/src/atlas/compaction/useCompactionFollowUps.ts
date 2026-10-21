import { useState } from "react";

import type { ChatMessage } from "~/types";

import { type CompactionFollowUps, deriveCompactionFollowUps } from "./compactionMessages";

type Input = Parameters<typeof deriveCompactionFollowUps>[0];

interface Derived {
  readonly followUps: CompactionFollowUps;
  /** The thread's anchored messages plus the follow-ups shown as sent. */
  readonly anchoredMessages: ReadonlyArray<ChatMessage>;
}

function sameInput(left: Input, right: Input): boolean {
  return (
    left.projection === right.projection &&
    left.visibleTurnItems === right.visibleTurnItems &&
    left.optimisticMessages === right.optimisticMessages &&
    left.isCompacting === right.isCompacting &&
    left.editingRunId === right.editingRunId
  );
}

/**
 * The follow-ups keep their identity until their inputs change: the timeline
 * re-derives (and sets state) whenever its anchored messages change identity,
 * so a fresh array on every render would re-render forever.
 */
export function useCompactionFollowUps(
  input: Input,
  anchoredMessages: ReadonlyArray<ChatMessage>,
): Derived {
  const [cache, setCache] = useState<{
    readonly input: Input;
    readonly anchored: ReadonlyArray<ChatMessage>;
    readonly value: Derived;
  } | null>(null);
  if (cache !== null && cache.anchored === anchoredMessages && sameInput(cache.input, input)) {
    return cache.value;
  }
  const followUps = deriveCompactionFollowUps(input);
  const value: Derived = {
    followUps,
    anchoredMessages:
      followUps.messages.length === 0
        ? anchoredMessages
        : [...anchoredMessages, ...followUps.messages],
  };
  setCache({ input, anchored: anchoredMessages, value });
  return value;
}
