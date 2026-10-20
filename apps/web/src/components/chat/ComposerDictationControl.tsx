import { MicIcon } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

import {
  readPreferredInputDeviceId,
  useInputDevices,
  writePreferredInputDeviceId,
} from "~/atlas/dictationInputDevice";

import type { ComposerDictation } from "~/dictation/useComposerDictation";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerDictationActivity } from "./ComposerDictationActivity";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

/**
 * Dictation in the composer footer. Idle it is a mic button that starts
 * dictation, or opens Dictation settings when no environment can transcribe.
 * Starting grows the same control in place: the button stays put and becomes
 * stop, while cancel, the waveform, and the timer unfold to its left inside a
 * pill. Ending folds them back. The unfold is a one-shot grid transition; the
 * only per-frame work is the waveform while the microphone is live.
 */
export function ComposerDictationControl(props: {
  readonly dictation: ComposerDictation;
  readonly disabled: boolean;
  readonly shortcutLabel: string | null;
}) {
  const { dictation } = props;
  const phase = dictation.state.phase;
  const active = phase === "preparing" || phase === "recording" || phase === "transcribing";
  const label = dictation.environmentId === null ? "Set up dictation" : "Dictate";
  // Code Atlas: right-click the mic to choose which microphone dictation uses.
  const micRef = useRef<HTMLSpanElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preferredDevice, setPreferredDevice] = useState(readPreferredInputDeviceId);
  const devices = useInputDevices(pickerOpen);

  return (
    <div
      role="group"
      aria-label="Dictation"
      data-active={active ? "" : undefined}
      className="group flex h-8 items-center"
    >
      <div
        className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-data-active:grid-cols-[1fr] motion-reduce:transition-none"
        inert={!active}
      >
        <div className="min-w-0 overflow-hidden">
          <ComposerDictationActivity
            phase={phase}
            level={dictation.level}
            onCancel={dictation.cancel}
          />
        </div>
      </div>
      {active ? (
        <button
          type="button"
          disabled={phase !== "recording"}
          onPointerDown={keepComposerFocus}
          onClick={dictation.stop}
          aria-label={phase === "recording" ? "Stop and insert dictation" : "Transcribing"}
          className="mr-0.5 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground transition-[opacity,scale] duration-200 ease-out starting:scale-50 starting:opacity-0 disabled:opacity-45 motion-reduce:transition-none"
        >
          <span className="size-2.5 rounded-xs bg-current" />
        </button>
      ) : (
        <span
          ref={micRef}
          className="inline-flex"
          onContextMenu={(event) => {
            event.preventDefault();
            setPickerOpen(true);
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.disabled}
                  onPointerDown={keepComposerFocus}
                  onClick={dictation.start}
                  aria-label={label}
                />
              }
            >
              <MicIcon />
            </TooltipTrigger>
            <TooltipPopup>
              {props.shortcutLabel && dictation.environmentId !== null
                ? `${label} (hold ${props.shortcutLabel}) · right-click to pick a microphone`
                : label}
            </TooltipPopup>
          </Tooltip>
          <Menu open={pickerOpen} onOpenChange={setPickerOpen}>
            <MenuPopup anchor={micRef} side="top" align="end">
              <MenuGroup>
                <MenuGroupLabel>Microphone</MenuGroupLabel>
                <MenuRadioGroup
                  value={preferredDevice ?? "default"}
                  onValueChange={(value) => {
                    const next = value === "default" ? null : String(value);
                    writePreferredInputDeviceId(next);
                    setPreferredDevice(next);
                  }}
                >
                  <MenuRadioItem value="default">System default</MenuRadioItem>
                  {devices.map((device) => (
                    <MenuRadioItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </span>
      )}
    </div>
  );
}
