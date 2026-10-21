import { ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { fileChangeLineStats } from "./AtlasFileChangeStats.ts";

const now = DateTime.makeUnsafe(Date.UTC(2026, 9, 21));
const edit = (fields: {
  readonly diffStr?: string;
  readonly oldStr?: string;
  readonly newStr?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly status?: "completed" | "failed";
}) => ({
  id: TurnItemId.make("edit-1"),
  type: "file_change" as const,
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: fields.status ?? ("completed" as const),
  title: null,
  startedAt: now,
  completedAt: now,
  updatedAt: now,
  fileName: "src/main.ts",
  ...fields,
});

describe("fileChangeLineStats", () => {
  it("prefers the counts the provider reported", () => {
    expect(fileChangeLineStats(edit({ additions: 4, diffStr: "+a\n+b" }))).toEqual({
      additions: 4,
      deletions: 0,
    });
  });

  it("counts a unified diff without its file headers", () => {
    expect(
      fileChangeLineStats(
        edit({ diffStr: "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n+more" }),
      ),
    ).toEqual({ additions: 2, deletions: 1 });
  });

  it("counts Claude Code's structured patch, edit and new file results", () => {
    const patch = JSON.stringify({
      filePath: "/x.ts",
      oldString: "a",
      newString: "b",
      structuredPatch: [{ lines: [" keep", "-a", "+b", "+c"] }],
    });
    expect(fileChangeLineStats(edit({ diffStr: patch }))).toEqual({ additions: 2, deletions: 1 });
    const replaced = JSON.stringify({
      filePath: "/x.ts",
      oldString: "same\nold\nsame",
      newString: "same\nnew\nnewer\nsame",
    });
    expect(fileChangeLineStats(edit({ diffStr: replaced }))).toEqual({
      additions: 2,
      deletions: 1,
    });
    const created = JSON.stringify({
      type: "create",
      filePath: "/x.ts",
      content: "one\ntwo\nthree\n",
      structuredPatch: [],
    });
    expect(fileChangeLineStats(edit({ diffStr: created }))).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it("knows nothing about a failed edit or an unreadable result", () => {
    expect(fileChangeLineStats(edit({ status: "failed", diffStr: "+a" }))).toBeNull();
    expect(
      fileChangeLineStats(edit({ diffStr: "File created successfully at: /x.ts" })),
    ).toBeNull();
  });
});
