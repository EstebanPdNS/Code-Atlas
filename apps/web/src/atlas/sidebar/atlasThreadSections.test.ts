import { describe, expect, it } from "vite-plus/test";

import { isAtlasThreadRunning, resolveAtlasThreadPlacement } from "./atlasThreadSections";

const base = {
  pinned: false,
  running: false,
  isUnread: false,
  isWoke: false,
  snoozed: false,
} as const;

describe("resolveAtlasThreadPlacement", () => {
  it("keeps pinned threads pinned whatever their status", () => {
    expect(resolveAtlasThreadPlacement({ ...base, pinned: true, status: "approval" })).toBe(
      "pinned",
    );
    expect(
      resolveAtlasThreadPlacement({ ...base, pinned: true, status: "working", running: true }),
    ).toBe("pinned");
  });

  it("separates running agents from threads that need the user", () => {
    expect(resolveAtlasThreadPlacement({ ...base, status: "working", running: true })).toBe(
      "working",
    );
    expect(resolveAtlasThreadPlacement({ ...base, status: "waiting", running: true })).toBe(
      "working",
    );
    // A session parked at idle is not a running agent.
    expect(resolveAtlasThreadPlacement({ ...base, status: "waiting" })).toBe("project");
    expect(resolveAtlasThreadPlacement({ ...base, status: "approval" })).toBe("attention");
    expect(resolveAtlasThreadPlacement({ ...base, status: "input" })).toBe("attention");
    expect(resolveAtlasThreadPlacement({ ...base, status: "failed" })).toBe("attention");
  });

  it("surfaces unread completions and woken snoozes, not read ones", () => {
    expect(resolveAtlasThreadPlacement({ ...base, status: "ready", isUnread: true })).toBe(
      "attention",
    );
    expect(resolveAtlasThreadPlacement({ ...base, status: "ready" })).toBe("project");
    expect(
      resolveAtlasThreadPlacement({ ...base, status: "ready", snoozed: true, isUnread: true }),
    ).toBe("project");
    expect(resolveAtlasThreadPlacement({ ...base, status: "ready", isWoke: true })).toBe(
      "attention",
    );
  });
});

describe("isAtlasThreadRunning", () => {
  const thread = (
    runtimeStatus: "idle" | "running" | "completed" | null,
    extra: {
      readonly blockedOnThreadWait?: boolean;
      readonly pendingBackgroundTasks?: readonly { taskId: string; kind: "subagent" | "command" }[];
    } = {},
  ) => ({
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    blockedOnThreadWait: extra.blockedOnThreadWait ?? false,
    pendingBackgroundTasks: extra.pendingBackgroundTasks ?? [],
    runtime:
      runtimeStatus === null
        ? null
        : {
            status: runtimeStatus,
            activeRunId: null,
            providerInstanceId: "codex" as never,
            providerName: null,
            lastError: null,
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
  });

  it("counts a live run", () => {
    expect(isAtlasThreadRunning(thread("running"))).toBe(true);
  });

  it("counts a run blocked on another thread", () => {
    expect(isAtlasThreadRunning(thread("running", { blockedOnThreadWait: true }))).toBe(true);
  });

  it("counts a turn held open by background work", () => {
    expect(
      isAtlasThreadRunning(
        thread("idle", { pendingBackgroundTasks: [{ taskId: "agent-1", kind: "subagent" }] }),
      ),
    ).toBe(true);
  });

  it("ignores sessions parked at idle, such as imported history threads", () => {
    // An imported Codex thread has a provider thread but no run, so its runtime
    // reads idle (and its status "waiting") weeks after its last turn.
    expect(isAtlasThreadRunning(thread("idle"))).toBe(false);
    // A leftover command does not hold the turn open either.
    expect(
      isAtlasThreadRunning(
        thread("idle", { pendingBackgroundTasks: [{ taskId: "dev", kind: "command" }] }),
      ),
    ).toBe(false);
  });

  it("ignores finished and never-run threads", () => {
    expect(isAtlasThreadRunning(thread("completed"))).toBe(false);
    expect(isAtlasThreadRunning(thread(null))).toBe(false);
  });
});
