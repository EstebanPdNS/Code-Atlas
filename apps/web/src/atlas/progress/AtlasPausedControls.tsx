import { PauseIcon, PlayIcon, SquareIcon } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

/**
 * Code Atlas: the composer's quiet task button (attach and the microphone
 * share its style): ghost, icon only, with a label and a tooltip.
 */
export function AtlasTaskButton(props: {
  readonly label: string;
  readonly tooltip: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            onPointerDown={keepComposerFocus}
            onClick={props.onClick}
            aria-label={props.label}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

/** ⏸ while a task runs: pausing interrupts it and keeps it resumable. */
export function AtlasPauseButton(props: {
  readonly disabled: boolean;
  readonly onPause: () => void;
}) {
  return (
    <AtlasTaskButton
      label="Pause task"
      tooltip="Pause"
      disabled={props.disabled}
      onClick={props.onPause}
    >
      <PauseIcon className="fill-current" />
    </AtlasTaskButton>
  );
}

/**
 * Code Atlas: a paused task (an interrupted run that can continue). ⏸ turns
 * into ▶ to resume, and Stop slides in beside it to end the task for good.
 * Typing a new message and sending it starts a new action instead, as in Codex.
 */
export function AtlasPausedControls(props: {
  readonly disabled: boolean;
  readonly onResume: () => void;
  readonly onStop: () => void;
}) {
  return (
    <div data-atlas-paused-controls className="flex items-center">
      <AtlasTaskButton
        label="Resume task"
        tooltip="Resume where it left off"
        disabled={props.disabled}
        onClick={props.onResume}
      >
        <PlayIcon className="fill-current" />
      </AtlasTaskButton>
      <div data-atlas-stop-reveal>
        <div className="min-w-0 overflow-hidden ps-2">
          <AtlasTaskButton
            label="Stop task"
            tooltip="Stop the task"
            disabled={props.disabled}
            onClick={props.onStop}
          >
            <SquareIcon className="size-3.5! fill-current" />
          </AtlasTaskButton>
        </div>
      </div>
    </div>
  );
}
