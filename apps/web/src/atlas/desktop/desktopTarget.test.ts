import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

import {
  agentDesktopTarget,
  computerUseInputApps,
  cuaCodeApp,
  desktopActivityLabel,
  desktopAppLabel,
  rememberResolvedDesktopApp,
  shellCommandApps,
} from "./desktopTarget";

let nextId = 0;

const work = (entry: Partial<WorkLogEntry>): TimelineEntry => {
  const id = entry.id ?? `w-${nextId++}`;
  return {
    id,
    kind: "work",
    createdAt: "2026-10-21T21:47:40.000Z",
    entry: { id, createdAt: "2026-10-21T21:47:40.000Z", label: "Tool", tone: "tool", ...entry },
  };
};

const item = (fields: Record<string, unknown>) =>
  ({
    threadId: "thread-1",
    nativeItemRef: { driver: "codex", nativeId: "n", strength: "strong" },
    startedAt: DateTime.makeUnsafe("2026-10-21T21:47:40.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-10-21T21:47:41.000Z"),
    completedAt: null,
    ...fields,
  }) as never;

/** A Codex computer-use REPL call, as `cua_repl.js` items arrive. */
const cua = (code: string, status: WorkLogEntry["toolLifecycleStatus"] = "completed") =>
  work({
    toolSurface: "computer",
    toolSource: { key: "computer-use", name: "Computer Use", kind: "computer" },
    toolLifecycleStatus: status,
    structuredPayload: item({ type: "dynamic_tool", toolName: "cua_repl.js", input: { code } }),
  });

/** A Claude Code tool call (Bash runs arrive as command items). */
const claudeTool = (toolName: string, input: unknown) =>
  work({
    toolLifecycleStatus: "completed",
    structuredPayload: item({
      type: "dynamic_tool",
      toolName,
      input,
      nativeItemRef: { driver: "claudeAgent", nativeId: "n", strength: "strong" },
    }),
  });

const command = (input: string, status: WorkLogEntry["toolLifecycleStatus"] = "inProgress") =>
  work({
    command: input,
    rawCommand: input,
    toolLifecycleStatus: status,
    structuredPayload: item({
      type: "command_execution",
      input,
      nativeItemRef: { driver: "claudeAgent", nativeId: "n", strength: "strong" },
    }),
  });

const userMessage: TimelineEntry = {
  id: "m",
  kind: "message",
  createdAt: "2026-10-21T21:40:00.000Z",
  message: {
    id: "m" as never,
    role: "user",
    text: "check the emulator",
    runId: null,
    streaming: false,
    createdAt: "2026-10-21T21:40:00.000Z",
    updatedAt: "2026-10-21T21:40:00.000Z",
  },
};

describe("cuaCodeApp", () => {
  it("follows the app a REPL variable is bound to", () => {
    expect(cuaCodeApp(`let arc = await cua.getApp('company.thebrowser.Browser');`)).toBe(
      "company.thebrowser.Browser",
    );
    expect(cuaCodeApp(`await arc.click(57); await arc.getAXState();`, () => "Arc")).toBe("Arc");
    expect(
      cuaCodeApp(`let a = await cua.getApp("Notes"); let b = await cua.getApp("Safari");`),
    ).toBe("Safari");
    expect(
      cuaCodeApp(
        `let s = await cua.getApp("Safari"); let n = await cua.getApp("Notes"); await s.click(1);`,
      ),
    ).toBe("Safari");
    expect(cuaCodeApp(`await cua.getState();`)).toBeNull();
    expect(cuaCodeApp(`nodeRepl.write(x);`)).toBeNull();
  });
});

describe("computerUseInputApps", () => {
  it("reads the app arguments of computer-use tools", () => {
    expect(computerUseInputApps({ app: "Azahar" })).toEqual(["Azahar"]);
    expect(computerUseInputApps({ apps: ["Azahar", { bundleId: "com.apple.Safari" }] })).toEqual([
      "Azahar",
      "com.apple.Safari",
    ]);
    expect(computerUseInputApps({ coordinate: [10, 20] })).toEqual([]);
  });
});

describe("shellCommandApps", () => {
  it("finds the apps desktop drivers and launches name", () => {
    expect(shellCommandApps(`open -a "Azahar" game.3dsx`)).toEqual(["Azahar"]);
    expect(shellCommandApps(`open -na Azahar --args -w game.3dsx`)).toEqual(["Azahar"]);
    expect(shellCommandApps(`open -b org.azahar-emu.Azahar`)).toEqual(["org.azahar-emu.Azahar"]);
    expect(shellCommandApps(`open "/Applications/Arc.app" --args x`)).toEqual([
      "/Applications/Arc.app",
    ]);
    expect(
      shellCommandApps(
        `/bin/zsh -lc "open -a '/Users/me/Downloads/PROJECTOS/01 GAMES/azahar/Azahar.app' --args x.3dsx"`,
      ),
    ).toEqual(["/Users/me/Downloads/PROJECTOS/01 GAMES/azahar/Azahar.app"]);
    expect(
      shellCommandApps(`~/Applications/azahar/Azahar.app/Contents/MacOS/azahar -w game.3dsx`),
    ).toEqual(["~/Applications/azahar/Azahar.app"]);
    expect(shellCommandApps(`osascript -e 'tell application "Azahar" to activate'`)).toEqual([
      "Azahar",
    ]);
    expect(
      shellCommandApps(
        `osascript -e 'tell application "System Events" to get name of every window of process "azahar"'`,
      ),
    ).toEqual(["azahar"]);
    expect(shellCommandApps(`peekaboo click --app Azahar --on B12`)).toEqual(["Azahar"]);
    expect(shellCommandApps(`cua-driver call click --app="Azahar" --x 10`)).toEqual(["Azahar"]);
  });

  it("ignores commands that drive no app", () => {
    expect(shellCommandApps(`python3 run_azahar.py final-new-corneria build.3dsx`)).toEqual([]);
    expect(shellCommandApps(`vp test run src/app.test.ts`)).toEqual([]);
    expect(shellCommandApps(`screencapture -x /tmp/screen.png`)).toEqual([]);
    expect(
      shellCommandApps(`curl -s https://tizentube.app && echo hello@updates.linear.app`),
    ).toEqual([]);
  });
});

describe("desktopAppLabel", () => {
  it("names an app from a path or name, not from a bundle id", () => {
    expect(desktopAppLabel("/Applications/Arc.app")).toBe("Arc");
    expect(desktopAppLabel("Azahar")).toBe("Azahar");
    expect(desktopAppLabel("com.apple.Safari")).toBeNull();
  });
});

describe("agentDesktopTarget", () => {
  it("covers Codex computer use across REPL calls", () => {
    const target = agentDesktopTarget([
      userMessage,
      cua(`let atlasSafari = await cua.getApp("Safari");`),
      cua(`await atlasSafari.pressKey("super+r"); await atlasSafari.getAXState();`),
    ]);
    expect(target).toMatchObject({ apps: ["Safari"], label: "Safari", agent: "Codex" });
    // The REPL keeps variables between turns.
    expect(
      agentDesktopTarget([
        cua(`let arc = await cua.getApp('/Applications/Arc.app');`),
        userMessage,
        cua(`await arc.click(57);`),
      ])?.apps,
    ).toEqual(["/Applications/Arc.app", "Arc"]);
  });

  it("covers Claude computer use, carrying the app an earlier call opened", () => {
    const target = agentDesktopTarget([
      userMessage,
      claudeTool("mcp__computer-use__open_application", { app: "Azahar" }),
      claudeTool("mcp__computer-use__left_click", { coordinate: [100, 200] }),
    ]);
    expect(target).toMatchObject({
      apps: ["Azahar"],
      agent: "Claude Code",
      threadId: "thread-1",
      running: false,
      actionAt: "2026-10-21T21:47:41.000Z",
    });
    expect(
      agentDesktopTarget([
        userMessage,
        claudeTool("mcp__remote-devices__computer_request_access", { apps: ["Azahar"] }),
      ])?.apps,
    ).toEqual(["Azahar"]);
  });

  it("covers Code Atlas's own computer use for Claude", () => {
    expect(
      agentDesktopTarget([
        userMessage,
        claudeTool("mcp__atlas-computer__computer_screenshot", { app: "Azahar" }),
        claudeTool("mcp__atlas-computer__computer_key", { keys: "return" }),
      ])?.apps,
    ).toEqual(["Azahar"]);
  });

  it("hints a long command that launches an app it names", () => {
    const run = command(`python3 run_azahar.py final-old-corneria build.3dsx --old --timeout 600`);
    const target = agentDesktopTarget([userMessage, run, command("ls", "completed")]);
    expect(target).toMatchObject({
      key: run.id,
      apps: [],
      hint: "python3 run_azahar.py final-old-corneria build.3dsx --old --timeout 600",
      running: true,
    });
    // Once it ended there is nothing left to hint.
    expect(
      agentDesktopTarget([userMessage, command("python3 run_azahar.py x", "completed")]),
    ).toBeNull();
  });

  it("keeps an app it just launched marked while the next command runs", () => {
    // As the owner's agents run the emulator: launch it in the background, then poll.
    const launch = command(
      `cd "$E" && ./Azahar.app/Contents/MacOS/azahar "user/sdmc/title/content/e5ef7391.app" &`,
      "completed",
    );
    const poll = command(`sleep 20; screencapture -x /tmp/shot.png`);
    const target = agentDesktopTarget([userMessage, launch, poll]);
    expect(target).toMatchObject({
      key: poll.id,
      hint: "sleep 20; screencapture -x /tmp/shot.png",
      label: "Azahar",
      running: true,
    });
    // The emulator first; the title's content file only trails as a weak guess.
    expect(target?.apps.slice(0, 2)).toEqual(["./Azahar.app", "Azahar"]);
  });

  it("counts a command that only passes an app's path along while it runs", () => {
    expect(
      agentDesktopTarget([
        userMessage,
        command("codesign --verify /Applications/Libron-X.app", "completed"),
      ]),
    ).toBeNull();
    expect(
      agentDesktopTarget([
        userMessage,
        command("/Applications/Libron-X.app/Contents/MacOS/Libron-X", "completed"),
      ])?.apps,
    ).toEqual(["/Applications/Libron-X.app", "Libron-X"]);
  });

  it("ignores calls from an earlier turn", () => {
    expect(
      agentDesktopTarget([
        claudeTool("mcp__computer-use__open_application", { app: "Notes" }),
        userMessage,
        command("ls", "completed"),
      ]),
    ).toBeNull();
  });
});

describe("desktopActivityLabel", () => {
  it("says which app a running call uses", () => {
    expect(
      desktopActivityLabel([userMessage, cua(`await cua.getApp("Safari")`, "inProgress")]),
    ).toBe("Using Safari");
    const run = command(`python3 run_azahar.py corneria build.3dsx`);
    expect(desktopActivityLabel([userMessage, run])).toBeNull();
    rememberResolvedDesktopApp(run.id, "Azahar");
    expect(desktopActivityLabel([userMessage, run])).toBe("Using Azahar");
    expect(desktopActivityLabel([userMessage, command("ls", "completed")])).toBeNull();
  });
});
