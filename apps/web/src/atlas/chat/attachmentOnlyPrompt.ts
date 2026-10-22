import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";

/**
 * Code Atlas: a message sent with only attachments carries a bootstrap line
 * so the agent has something to answer; the conversation shows just the
 * attachments, as they were sent.
 */
export function withoutAttachmentOnlyPrompt(text: string): string {
  return text.includes(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT)
    ? text.replace(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, "").trim()
    : text;
}
