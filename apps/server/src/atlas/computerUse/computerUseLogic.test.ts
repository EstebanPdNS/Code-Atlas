import { describe, expect, it } from "vite-plus/test";

import { findWindow, imagePointToScreen, parseKeyCombo } from "./computerUseLogic.ts";

describe("parseKeyCombo", () => {
  it("reads modifiers and keys", () => {
    expect(parseKeyCombo("cmd+s")).toEqual({ keyCode: 1, flags: 0x100000 });
    expect(parseKeyCombo("Shift + Cmd + Z")).toEqual({ keyCode: 6, flags: 0x120000 });
    expect(parseKeyCombo("Enter")).toEqual({ keyCode: 36, flags: 0 });
    expect(parseKeyCombo("left")).toEqual({ keyCode: 123, flags: 0 });
    expect(parseKeyCombo("esc")).toEqual({ keyCode: 53, flags: 0 });
  });

  it("rejects unknown names", () => {
    expect(parseKeyCombo("hyper+k")).toBeNull();
    expect(parseKeyCombo("cmd+")).toBeNull();
    expect(parseKeyCombo("")).toBeNull();
  });
});

describe("imagePointToScreen", () => {
  const area = { x: 100, y: 50, width: 400, height: 300 };

  it("scales image pixels to points from the window's corner", () => {
    expect(imagePointToScreen(area, { width: 800, height: 600 }, 400, 300)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("keeps points inside the window", () => {
    expect(imagePointToScreen(area, { width: 800, height: 600 }, 5000, -20)).toEqual({
      x: 499,
      y: 50,
    });
  });

  it("takes points as-is without a screenshot", () => {
    expect(imagePointToScreen(area, null, 10, 20)).toEqual({ x: 110, y: 70 });
  });
});

describe("findWindow", () => {
  const base = { x: 0, y: 0, width: 100, height: 100, title: "" };
  const windows = [
    { ...base, windowId: 1, pid: 1, app: "Azahar", bundleId: "org.azahar-emu.azahar" },
    { ...base, windowId: 2, pid: 2, app: "Finder", bundleId: "com.apple.finder" },
    { ...base, windowId: 3, pid: 1, app: "Azahar", bundleId: "org.azahar-emu.azahar" },
  ];

  it("finds the front window of an app by name or bundle id", () => {
    expect(findWindow(windows, { app: "azahar" })?.windowId).toBe(1);
    expect(findWindow(windows, { app: "com.apple.finder" })?.windowId).toBe(2);
    expect(findWindow(windows, { app: "find" })?.windowId).toBe(2);
  });

  it("finds a window by id and nothing for an unknown app", () => {
    expect(findWindow(windows, { windowId: 3 })?.windowId).toBe(3);
    expect(findWindow(windows, { app: "Safari" })).toBeNull();
  });
});
