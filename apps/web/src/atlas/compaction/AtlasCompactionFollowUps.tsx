import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";

import type { EditQueuedRunRequest } from "~/components/chat/QueuedRunsControl";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import type { CompactionFollowUp } from "./compactionMessages";

export interface AtlasCompactionFollowUps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly byMessageId: ReadonlyMap<string, CompactionFollowUp>;
  readonly onEdit: (request: EditQueuedRunRequest) => void;
}

/**
 * Edit and Remove on a message sent while the thread compacts, for as long as
 * the agent has not received it. Renders nothing for any other message.
 */
export function AtlasCompactionFollowUpActions({
  followUps: ctx,
  messageId,
}: {
  readonly followUps: AtlasCompactionFollowUps | null;
  readonly messageId: string;
}) {
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const [busy, setBusy] = useState(false);
  const followUp = ctx?.byMessageId.get(messageId);
  if (ctx === null || followUp === undefined) return null;
  const { runId } = followUp;
  const disabled = runId === null || busy;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label="Edit message"
              disabled={disabled}
              onClick={() => {
                if (runId !== null) {
                  ctx.onEdit({
                    runId,
                    messageId: followUp.messageId,
                    text: followUp.text,
                    attachments: followUp.attachments,
                  });
                }
              }}
            />
          }
        >
          <PencilIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Edit before the agent receives it</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label="Remove message"
              disabled={disabled}
              onClick={async () => {
                if (runId === null) return;
                setBusy(true);
                await cancel({
                  environmentId: ctx.environmentId,
                  input: { threadId: ctx.threadId, runId },
                });
                setBusy(false);
              }}
            />
          }
        >
          <XIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Remove before the agent receives it</TooltipPopup>
      </Tooltip>
    </>
  );
}
