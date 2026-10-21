import type {
  EnvironmentId,
  OrchestrationV2ConversationMessage,
  OrchestrationV2ProviderGoal,
  OrchestrationV2Run,
  ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import {
  AtlasExpandIcon,
  AtlasPauseIcon,
  AtlasPlayIcon,
  AtlasTargetIcon,
  AtlasTrashIcon,
} from "~/atlas/brand/atlasIcons";
import { AtlasTaskButton } from "~/atlas/progress/AtlasPausedControls";
import { ComposerSurface } from "~/components/chat/ComposerSurface";
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
import { isMacPlatform } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  type AtlasGoalProvider,
  type AtlasGoalStep,
  atlasGoalClearSteps,
  atlasGoalElapsedSeconds,
  atlasGoalSavePlan,
  atlasGoalToggleSteps,
  formatGoalElapsed,
  presentAtlasGoal,
} from "./goalPresentation";

export type AtlasGoalSendCommand = (
  text: string,
  failureMessage: string,
  options?: { readonly queue?: boolean; readonly restart?: boolean },
) => Promise<void>;

/** The goal's total time; it ticks only while the goal is being worked on. */
function GoalElapsed(props: {
  readonly goal: OrchestrationV2ProviderGoal;
  readonly working: boolean;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "id" | "role" | "text">
  >;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "userMessageId" | "startedAt" | "completedAt">
  >;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [props.working]);
  const seconds = atlasGoalElapsedSeconds({
    goal: props.goal,
    messages: props.messages,
    runs: props.runs,
    nowMs: now,
  });
  if (seconds <= 0) return null;
  return <span className="tabular-nums">{formatGoalElapsed(seconds)}</span>;
}

/**
 * Code Atlas: the thread goal as one row above the composer, like Codex's:
 * the status and objective, the total time, then Clear, Pause or Resume, and
 * Open (the full editor). It wears the composer's own surface.
 */
export function AtlasGoalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly working: boolean;
  readonly provider: AtlasGoalProvider;
  readonly sendCommand: AtlasGoalSendCommand;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "id" | "role" | "text">
  >;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "userMessageId" | "startedAt" | "completedAt">
  >;
  /** Agents without native goal pause pause and resume the running task. */
  readonly taskResumable: boolean;
  readonly onPauseTask: () => void;
  readonly onResumeTask: () => void;
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
    taskResumable: props.taskResumable,
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
            step.restart ? { restart: true } : undefined,
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

  const toggle = () => {
    if (presentation.toggle === null) return;
    if (!nativeControls) {
      if (presentation.toggle === "pause") props.onPauseTask();
      else props.onResumeTask();
      return;
    }
    void run(
      atlasGoalToggleSteps(presentation.toggle, { working: props.working }),
      presentation.toggle === "pause" ? "Could not pause the goal" : "Could not resume the goal",
    );
  };

  return (
    <ComposerSurface.Shell data-atlas-rise>
      <ComposerSurface.Host>
        <section
          aria-label="Goal"
          data-atlas-goal-card
          className="relative z-10 flex min-h-10 items-center gap-2 py-1 ps-3.5 pe-2 text-sm"
        >
          <AtlasTargetIcon
            className={
              props.goal.status === "active" && props.working
                ? "size-4 shrink-0 text-primary"
                : "size-4 shrink-0 text-muted-foreground"
            }
          />
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-md px-0.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className="shrink-0 font-medium">{presentation.title}</span>
            <span className="min-w-0 truncate text-muted-foreground hover:text-foreground">
              {presentation.objective}
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            {presentation.metrics === null ? null : (
              <span className="tabular-nums">{presentation.metrics}</span>
            )}
            <GoalElapsed
              goal={props.goal}
              working={props.working}
              messages={props.messages}
              runs={props.runs}
            />
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {presentation.canClear ? (
              <AtlasTaskButton
                label="Clear goal"
                tooltip="Clear goal"
                disabled={disabled}
                onClick={() =>
                  void run(
                    atlasGoalClearSteps(props.provider, { working: props.working }),
                    "Could not clear the goal",
                  )
                }
              >
                <AtlasTrashIcon />
              </AtlasTaskButton>
            ) : null}
            {presentation.toggle === null ? null : (
              <AtlasTaskButton
                label={presentation.toggle === "pause" ? "Pause goal" : "Resume goal"}
                tooltip={presentation.toggle === "pause" ? "Pause goal" : "Resume goal"}
                disabled={disabled}
                onClick={toggle}
              >
                {presentation.toggle === "pause" ? <AtlasPauseIcon /> : <AtlasPlayIcon />}
              </AtlasTaskButton>
            )}
            <AtlasTaskButton
              label="Open goal"
              tooltip="Open goal"
              disabled={false}
              onClick={() => setEditorOpen(true)}
            >
              <AtlasExpandIcon />
            </AtlasTaskButton>
          </div>
        </section>
      </ComposerSurface.Host>
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        {editorOpen ? (
          <AtlasGoalEditor
            goal={props.goal}
            objective={presentation.objective}
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
    </ComposerSurface.Shell>
  );
}

/** The goal in a large editor, like Codex's: edit the objective, then Save. */
function AtlasGoalEditor(props: {
  readonly goal: OrchestrationV2ProviderGoal;
  readonly objective: string;
  readonly status: string;
  readonly working: boolean;
  readonly provider: AtlasGoalProvider;
  readonly disabled: boolean;
  readonly onSave: (steps: ReadonlyArray<AtlasGoalStep>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.objective);
  const plan = atlasGoalSavePlan(props.goal, draft, {
    working: props.working,
    provider: props.provider,
  });
  const unchanged = draft.trim() === props.objective;
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
