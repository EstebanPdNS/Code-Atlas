import { PlayIcon, SquareIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

/**
 * Code Atlas: a paused task (an interrupted run that can continue) offers
 * Stop and Resume before the microphone and send buttons.
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
          <SquareIcon className="fill-current" />
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
