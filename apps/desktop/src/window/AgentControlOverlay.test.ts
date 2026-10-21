import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_CONTROL_IDLE_MS,
  idleRemainingMs,
  parseTargetWindow,
  pillBounds,
  watchSpec,
} from "./AgentControlOverlay.ts";

const target = {
  key: "turn-item:1",
  apps: [] as string[],
  hint: null as string | null,
  agent: "Claude Code",
  running: false,
  startedAt: "2026-10-21T21:47:40.000Z",
  actionAt: "2026-10-21T21:47:41.000Z",
};

describe("parseTargetWindow", () => {
  it("reads the window the JXA watcher streams", () => {
    expect(
      parseTargetWindow(
        '{"x":10,"y":20,"width":800,"height":600,"windowId":4211,"above":4100,"app":"Azahar"}',
      ),
    ).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      windowId: 4211,
      above: 4100,
      app: "Azahar",
    });
  });

  it("returns null when the app has no window or the line is malformed", () => {
    expect(parseTargetWindow("null")).toBeNull();
    expect(parseTargetWindow('{"x":0,"y":0,"width":400,"height":300}')).toBeNull();
    expect(parseTargetWindow('{"x":"0","y":0,"width":1,"height":1,"windowId":1}')).toBeNull();
    expect(parseTargetWindow('{"x":0,"y":0,"wid')).toBeNull();
  });
});

describe("pillBounds", () => {
  const workArea = { x: 0, y: 25, width: 1512, height: 920 };

  it("centers the pill above the window, outside its content", () => {
    expect(pillBounds({ x: 400, y: 300, width: 400, height: 480 }, workArea, 300)).toEqual({
      x: 450,
      y: 262,
      width: 300,
      height: 30,
    });
  });

  it("drops below a window at the top of the screen, then into a maximized one's title bar", () => {
    expect(pillBounds({ x: 400, y: 25, width: 400, height: 480 }, workArea, 300).y).toBe(513);
    expect(pillBounds({ x: 0, y: 25, width: 1512, height: 920 }, workArea, 300)).toEqual({
      x: 1202,
      y: 25,
      width: 300,
      height: 30,
    });
  });

  it("stays on screen next to a window at the edge", () => {
    expect(pillBounds({ x: -100, y: 300, width: 200, height: 300 }, workArea, 300).x).toBe(4);
  });
});

describe("idleRemainingMs", () => {
  const actionMs = Date.parse(target.actionAt);

  it("keeps a running call marked and times a finished one out", () => {
    expect(idleRemainingMs({ ...target, running: true }, actionMs + 600_000)).toBeNull();
    expect(idleRemainingMs(target, actionMs + 10_000)).toBe(AGENT_CONTROL_IDLE_MS - 10_000);
    expect(idleRemainingMs(target, actionMs + AGENT_CONTROL_IDLE_MS + 1)).toBe(0);
    expect(idleRemainingMs({ ...target, actionAt: "not a date" }, actionMs)).toBe(0);
  });
});

describe("watchSpec", () => {
  it("looks named apps up by name, and a hint by launch time", () => {
    expect(JSON.parse(watchSpec({ ...target, apps: ["Azahar", "/Apps/Azahar.app"] }))).toEqual({
      apps: ["azahar", "/apps/azahar.app"],
      hint: "",
      since: 0,
    });
    expect(
      JSON.parse(watchSpec({ ...target, hint: "python3 run_azahar.py x", running: true })),
    ).toEqual({
      apps: [],
      hint: "python3 run_azahar.py x",
      since: Date.parse(target.startedAt) / 1000,
    });
  });

  it("shares one watcher between calls on the same app", () => {
    expect(watchSpec({ ...target, apps: ["Safari"] })).toBe(
      watchSpec({ ...target, key: "turn-item:2", apps: ["Safari"], actionAt: "x" }),
    );
  });
});
