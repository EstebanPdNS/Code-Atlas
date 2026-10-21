import type { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { heldQueuedRunIds, pausedTaskKey } from "./pausedTask";

const run = (id: string) => id as RunId;

describe("heldQueuedRunIds", () => {
  it("keeps only queued runs the queue is holding", () => {
    expect(
      heldQueuedRunIds([
        { id: run("a"), status: "queued", queueHeld: true },
        { id: run("b"), status: "queued" },
        { id: run("c"), status: "interrupted", queueHeld: true },
        { id: run("d"), status: "queued", queueHeld: true },
      ]),
    ).toEqual(["a", "d"]);
  });
});

describe("pausedTaskKey", () => {
  it("is null when nothing is paused", () => {
    expect(pausedTaskKey({ threadKey: "t", resumableRunId: null, heldRunIds: [] })).toBeNull();
  });

  it("differs between two held-queue pauses on the same thread", () => {
    const first = pausedTaskKey({ threadKey: "t", resumableRunId: null, heldRunIds: [run("a")] });
    const second = pausedTaskKey({ threadKey: "t", resumableRunId: null, heldRunIds: [run("b")] });
    expect(first).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("changes when a held queue follows the same interrupted run", () => {
    const interrupted = pausedTaskKey({ threadKey: "t", resumableRunId: run("r"), heldRunIds: [] });
    const withQueue = pausedTaskKey({
      threadKey: "t",
      resumableRunId: run("r"),
      heldRunIds: [run("a")],
    });
    expect(interrupted).not.toBe(withQueue);
  });
});
