import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { withoutAttachmentOnlyPrompt } from "./attachmentOnlyPrompt";

describe("withoutAttachmentOnlyPrompt", () => {
  it("hides the bootstrap line of an attachment-only message", () => {
    expect(withoutAttachmentOnlyPrompt(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT)).toBe("");
  });

  it("keeps the chips that follow it", () => {
    expect(
      withoutAttachmentOnlyPrompt(`${ATTACHMENT_ONLY_BOOTSTRAP_PROMPT}\n@[image](ctx-1)`),
    ).toBe("@[image](ctx-1)");
  });

  it("leaves typed text alone", () => {
    expect(withoutAttachmentOnlyPrompt("Look at this")).toBe("Look at this");
  });
});
