import { describe, expect, it } from "vite-plus/test";

import { parseTargetWindow } from "./AgentControlOverlay.ts";

describe("parseTargetWindow", () => {
  it("reads the bounds the JXA watcher streams", () => {
    expect(parseTargetWindow('{"x":10,"y":20,"width":800,"height":600,"frontmost":true}')).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      frontmost: true,
    });
  });

  it("treats a missing frontmost flag as background", () => {
    expect(parseTargetWindow('{"x":0,"y":0,"width":400,"height":300}')?.frontmost).toBe(false);
  });

  it("returns null when the app has no window or the line is malformed", () => {
    expect(parseTargetWindow("null")).toBeNull();
    expect(parseTargetWindow('{"x":"0","y":0,"width":1,"height":1}')).toBeNull();
    expect(parseTargetWindow('{"x":0,"y":0,"wid')).toBeNull();
  });
});
