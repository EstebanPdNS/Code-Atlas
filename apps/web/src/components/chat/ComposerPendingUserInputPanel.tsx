import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import ChatMarkdown from "../ChatMarkdown";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled?: boolean;
  respondingRequestIds: RuntimeRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  cwd,
  threadRef,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      cwd={cwd}
      threadRef={threadRef}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  cwd,
  threadRef,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}) {
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  // The auto-advance timer fires after the render that armed it.
  const advance = useStableCallback(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  // The active question keys the shortcut listener, so it must keep its identity across renders.
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  // Read here, before the hooks below, so the compiler can keep `activeQuestion` cached.
  const draftSelectedOptions = activeQuestion?.options.map(
    (option) =>
      !customAnswerActive && progress.selectedOptionValues.includes(option.value ?? option.label),
  );
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  // The optimistic pick is dropped once the draft confirms it or the question moves on.
  if (
    optimisticSingleSelect &&
    activeQuestion &&
    !activeQuestion.multiSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive &&
        progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // A delayed answer only advances its own question, while permission remains granted.
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const handleOptionSelection = (questionId: string, optionValue: string) => {
    if (disabled || isResponding) return;
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  const selectOptionFromShortcut = useEffectEvent(handleOptionSelection);

  useEffect(() => {
    if (!activeQuestion || responseDisabled || isCollapsed) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      selectOptionFromShortcut(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isCollapsed, responseDisabled]);

  if (!activeQuestion) {
    return null;
  }

  // Code Atlas: questions read like Claude Code's prompt cards: the question
  // on a header strip, the options below it, then Skip (Esc) and the
  // composer's Next or Submit (⌘↩) in a footer.
  const dismiss = () => onDismiss(prompt.requestId);
  const canSubmit = progress.canAdvance && !responseDisabled;
  return (
    <Collapsible
      data-atlas-question
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      <AtlasQuestionKeys
        enabled={!isCollapsed}
        onEscape={prompt.dismissible && !isResponding ? dismiss : null}
        onSubmit={canSubmit ? onAdvance : null}
      />
      <div data-atlas-question-head>
        <div className="min-w-0 flex-1">
          {isCollapsed ? (
            <span className="block truncate">{activeQuestion.question}</span>
          ) : (
            <ChatMarkdown text={activeQuestion.question} cwd={cwd} threadRef={threadRef} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {prompt.questions.length > 1 ? (
            <span className="text-3xs font-medium text-muted-foreground tabular-nums">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          <CollapsibleTrigger
            render={<button type="button" data-atlas-question-toggle />}
            title={
              isCollapsed
                ? "Show the question and its options"
                : "Hide the question and its options"
            }
            aria-label={isCollapsed ? "Show options" : "Hide options"}
            data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
          >
            <ComposerBanner.ToggleIcon expanded={!isCollapsed} />
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <div data-atlas-question-body className="wrap-anywhere">
            {activeQuestion.header && activeQuestion.header !== activeQuestion.question ? (
              <p data-atlas-question-title>{activeQuestion.header}</p>
            ) : null}
            <div className="space-y-0.5">
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const isOptimisticallySelected =
                  optimisticSingleSelect?.questionId === activeQuestion.id &&
                  optimisticSingleSelect.optionValue === optionValue;
                const isSelected =
                  isOptimisticallySelected || draftSelectedOptions?.[index] === true;
                const shortcutKey = index < 9 ? index + 1 : null;
                return (
                  <button
                    key={`${activeQuestion.id}:${optionValue}`}
                    type="button"
                    data-atlas-question-option
                    data-selected={isSelected ? "" : undefined}
                    disabled={disabled || isResponding}
                    onClick={() => {
                      handleOptionSelection(activeQuestion.id, optionValue);
                    }}
                    className={cn(
                      "group flex w-full items-center gap-3 text-left outline-none",
                      (disabled || isResponding) && "cursor-not-allowed opacity-50",
                      !disabled && !isResponding && "cursor-pointer",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{option.label}</span>
                      {option.description && option.description !== option.label ? (
                        <span className="text-secondary-label text-xs">{option.description}</span>
                      ) : null}
                    </div>
                    {isSelected ? (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    ) : shortcutKey !== null ? (
                      <kbd data-atlas-keycap>{shortcutKey}</kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </ComposerBanner.Scroll>
        <div data-atlas-question-foot>
          <span className="min-w-0 truncate text-muted-foreground">
            {activeQuestion.multiSelect ? "Select one or more" : "Or type your own answer below"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {prompt.dismissible ? (
              <button
                type="button"
                data-atlas-question-skip
                data-pending-user-input-dismiss
                aria-label="Skip: dismiss the question without answering"
                disabled={isResponding}
                onClick={dismiss}
              >
                Skip <kbd data-atlas-keycap>Esc</kbd>
              </button>
            ) : null}
            <button
              type="button"
              data-atlas-question-submit
              disabled={!canSubmit}
              onClick={onAdvance}
            >
              {isResponding ? "Submitting…" : progress.isLastQuestion ? "Submit" : "Next"}
              <kbd data-atlas-keycap>⌘↩</kbd>
            </button>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
});

/**
 * Code Atlas: Esc skips and ⌘↩ submits from anywhere but a text field, where
 * those keys keep their usual meaning (the composer sends on ↩ itself).
 */
function AtlasQuestionKeys(props: {
  readonly enabled: boolean;
  readonly onEscape: (() => void) | null;
  readonly onSubmit: (() => void) | null;
}) {
  const onEscape = useEffectEvent(() => props.onEscape?.());
  const onSubmit = useEffectEvent(() => props.onSubmit?.());
  const hasEscape = props.onEscape !== null;
  const hasSubmit = props.onSubmit !== null;
  useEffect(() => {
    if (!props.enabled || (!hasEscape && !hasSubmit)) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement &&
          target.closest('[contenteditable]:not([contenteditable="false"])'))
      ) {
        return;
      }
      if (event.key === "Escape" && hasEscape) {
        event.preventDefault();
        onEscape();
      } else if (event.key === "Enter" && event.metaKey && hasSubmit) {
        event.preventDefault();
        onSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [props.enabled, hasEscape, hasSubmit]);
  return null;
}
