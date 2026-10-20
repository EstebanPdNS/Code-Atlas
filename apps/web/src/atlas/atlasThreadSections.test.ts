import { describe, expect, it } from "vite-plus/test";

import { resolveAtlasThreadPlacement } from "./atlasThreadSections";

const base = { pinned: false, isUnread: false, isWoke: false, snoozed: false } as const;

describe("resolveAtlasThreadPlacement", () => {
  it("keeps pinned threads pinned whatever their status", () => {
    expect(resolveAtlasThreadPlacement({ ...base, pinned: true, status: "approval" })).toBe(
      "pinned",
    );
    expect(resolveAtlasThreadPlacement({ ...base, pinned: true, status: "working" })).toBe(
      "pinned",
    );
  });

  it("separates running agents from threads that need the user", () => {
    expect(resolveAtlasThreadPlacement({ ...base, status: "working" })).toBe("working");
    expect(resolveAtlasThreadPlacement({ ...base, status: "waiting" })).toBe("working");
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
