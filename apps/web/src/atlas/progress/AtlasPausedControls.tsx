import { PlayIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

/** Claude Code's stop glyph: a ring around a small rounded square. */
export function StopCircleGlyph(props: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={props.className} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.75" y="5.75" width="4.5" height="4.5" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Code Atlas: a paused task (an interrupted run that can continue) keeps the
 * stop glyph the user pressed and offers Resume beside it. Typing a new
 * message and sending it starts a new action instead, as in Codex.
 */
export function AtlasPausedControls(props: {
  readonly disabled: boolean;
  readonly onResume: () => void;
  readonly onStop: () => void;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={props.disabled}
              onPointerDown={keepComposerFocus}
              onClick={props.onStop}
              aria-label="Stop task"
            />
          }
        >
          <StopCircleGlyph className="size-4" />
        </TooltipTrigger>
        <TooltipPopup>Stop the task</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={props.disabled}
              onPointerDown={keepComposerFocus}
              onClick={props.onResume}
              aria-label="Resume task"
              data-atlas-pop-in
            />
          }
        >
          <PlayIcon className="fill-current" />
        </TooltipTrigger>
        <TooltipPopup>Resume where it left off</TooltipPopup>
      </Tooltip>
    </>
  );
}
