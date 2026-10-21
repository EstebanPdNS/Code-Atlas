import type { EnvironmentId, OrchestrationV2ProviderGoal, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { Maximize2Icon, PauseIcon, PlayIcon, TargetIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Kbd } from "~/components/ui/kbd";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isMacPlatform } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  type AtlasGoalProvider,
  type AtlasGoalStep,
  atlasGoalClearSteps,
  atlasGoalSavePlan,
  atlasGoalToggleSteps,
  presentAtlasGoal,
} from "./goalPresentation";

export type AtlasGoalSendCommand = (
  text: string,
  failureMessage: string,
  options?: { readonly queue?: boolean },
) => Promise<void>;

function GoalAction(props: {
  readonly label: string;
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
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Code Atlas: the thread goal as a card above the composer, like Codex's
 * goal: its status line, the objective (in full in the editor), and Open,
 * Pause or Resume, and Clear.
 */
export function AtlasGoalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly working: boolean;
  readonly provider: AtlasGoalProvider;
  readonly sendCommand: AtlasGoalSendCommand;
}) {
  const updateGoal = useAtomCommand(orchestrationEnvironment.updateGoal);
  const canOperate = useAtomValue(
    orchestrationEnvironment.updateGoal.permissionAtom(props.environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const presentation = presentAtlasGoal(props.goal, {
    working: props.working,
    provider: props.provider,
  });
  const nativeControls = props.provider === "codex";
  const disabled = busy || (nativeControls && !canOperate);

  const run = async (steps: ReadonlyArray<AtlasGoalStep>, failureTitle: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      for (const step of steps) {
        if (step.type === "command") {
          await props.sendCommand(
            step.text,
            failureTitle,
            step.queue ? { queue: true } : undefined,
          );
          continue;
        }
        const result = await updateGoal({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, action: step.action },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: failureTitle,
              description: error instanceof Error ? error.message : undefined,
            });
          }
          return false;
        }
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Goal"
      data-atlas-goal-card
      className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card py-1 ps-3 pe-1.5 text-sm"
    >
      <TargetIcon
        aria-hidden
        className={
          props.goal.status === "active" && props.working
            ? "size-4 shrink-0 text-primary"
            : "size-4 shrink-0 text-muted-foreground"
        }
      />
      <span className="shrink-0 font-medium">{presentation.title}</span>
      {presentation.usage === null ? null : (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {presentation.usage}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditorOpen(true)}
        className="min-w-0 flex-1 cursor-pointer truncate rounded-md px-1 text-start text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {presentation.objective}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <GoalAction label="Open goal" disabled={false} onClick={() => setEditorOpen(true)}>
          <Maximize2Icon className="size-3.5" />
        </GoalAction>
        {presentation.toggle === null ? null : (
          <GoalAction
            label={presentation.toggle === "pause" ? "Pause goal" : "Resume goal"}
            disabled={disabled}
            onClick={() =>
              void run(
                atlasGoalToggleSteps(presentation.toggle!, { working: props.working }),
                presentation.toggle === "pause"
                  ? "Could not pause the goal"
                  : "Could not resume the goal",
              )
            }
          >
            {presentation.toggle === "pause" ? (
              <PauseIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </GoalAction>
        )}
        {presentation.canClear ? (
          <GoalAction
            label="Clear goal"
            disabled={disabled}
            onClick={() =>
              void run(atlasGoalClearSteps(props.provider), "Could not clear the goal")
            }
          >
            <XIcon className="size-3.5" />
          </GoalAction>
        ) : null}
      </div>
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        {editorOpen ? (
          <AtlasGoalEditor
            goal={props.goal}
            status={presentation.status}
            working={props.working}
            provider={props.provider}
            disabled={disabled}
            onSave={async (steps) => {
              if (await run(steps, "Could not save the goal")) setEditorOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

/** The goal in a large editor, like Codex's: edit the objective, then Save. */
function AtlasGoalEditor(props: {
  readonly goal: OrchestrationV2ProviderGoal;
  readonly status: string;
  readonly working: boolean;
  readonly provider: AtlasGoalProvider;
  readonly disabled: boolean;
  readonly onSave: (steps: ReadonlyArray<AtlasGoalStep>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.goal.objective);
  const plan = atlasGoalSavePlan(props.goal, draft, {
    working: props.working,
    provider: props.provider,
  });
  const unchanged = draft.trim() === props.goal.objective.trim();
  const canSave = !props.disabled && !unchanged && draft.trim().length > 0;
  const save = () => {
    if (canSave) void props.onSave(plan.steps);
  };
  return (
    <DialogPopup bottomStickOnMobile={false} className="h-[min(44rem,calc(100dvh-2rem))] max-w-4xl">
      <DialogHeader>
        <DialogTitle>Edit goal</DialogTitle>
        <DialogDescription>{props.status}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 pb-4">
        <textarea
          autoFocus
          aria-label="Goal objective"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none wrap-anywhere focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 focus-visible:ring-inset dark:bg-input/32"
        />
        <p className="text-xs text-muted-foreground">{plan.note}</p>
      </div>
      <DialogFooter>
        <span className="me-auto hidden items-center gap-1 self-center text-xs text-muted-foreground sm:flex">
          <Kbd>{isMacPlatform(navigator.platform) ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>↵</Kbd>
          to save
        </span>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button disabled={!canSave} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}
