// A stdio MCP server started per Claude session: it relays plain JSON-RPC
// lines and shells out to macOS tools, so it stays free of Effect and schemas
// like the other fast-path commands in bin.ts.
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";

import {
  type DesktopWindow,
  findWindow,
  imagePointToScreen,
  parseKeyCombo,
  type Rect,
  SCREENSHOT_MAX_SIDE,
} from "./computerUseLogic.ts";

/**
 * Code Atlas: Claude's computer use on this Mac. Claude sees app windows and
 * operates them through these tools; the native helper (native/atlas-computer)
 * posts the events and the system's screencapture takes the pictures. Every
 * process here descends from Code Atlas, so they use its Screen Recording and
 * Accessibility permissions. The first time Claude looks at or controls an app
 * in a session, the user is asked in a system dialog.
 */

const MCP_PROTOCOL_VERSION = "2025-06-18";

type Json = Record<string, unknown>;

interface ToolContent {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

class ComputerUseError extends Error {}

const targetProperties = {
  app: {
    type: "string",
    description: 'The app, by its name or bundle id, e.g. "Azahar" or "com.apple.Safari".',
  },
  windowId: {
    type: "number",
    description: "A window id from computer_windows or a screenshot; overrides app.",
  },
};

const screenshotAfter = {
  screenshot: {
    type: "boolean",
    description: "Return a fresh screenshot of the window after acting (default true).",
  },
};

const TOOLS = [
  {
    name: "computer_windows",
    description:
      "List the app windows on screen, front to back, with their ids, apps and bounds. Use it to find the app to look at.",
    inputSchema: { type: "object", properties: { app: targetProperties.app } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "computer_screenshot",
    description:
      "See an app's front window (or the whole main screen when no app is given) as an image. Coordinates for the other tools are pixels in the latest screenshot of that window.",
    inputSchema: { type: "object", properties: targetProperties },
    annotations: { readOnlyHint: true },
  },
  {
    name: "computer_click",
    description:
      "Click at x, y (pixels in the latest screenshot of the window). The app comes to the front first.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetProperties,
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right"] },
        clicks: { type: "number", description: "1, 2 (double click) or 3." },
        ...screenshotAfter,
      },
      required: ["x", "y"],
    },
  },
  {
    name: "computer_type",
    description: "Type text into the app's focused field.",
    inputSchema: {
      type: "object",
      properties: { ...targetProperties, text: { type: "string" }, ...screenshotAfter },
      required: ["text"],
    },
  },
  {
    name: "computer_key",
    description:
      'Press a key or shortcut, e.g. "return", "cmd+s", "left". holdMs keeps it down (games), repeat presses it again.',
    inputSchema: {
      type: "object",
      properties: {
        ...targetProperties,
        keys: { type: "string" },
        holdMs: { type: "number" },
        repeat: { type: "number" },
        ...screenshotAfter,
      },
      required: ["keys"],
    },
  },
  {
    name: "computer_scroll",
    description: "Scroll at x, y by dx, dy pixels (positive dy scrolls down).",
    inputSchema: {
      type: "object",
      properties: {
        ...targetProperties,
        x: { type: "number" },
        y: { type: "number" },
        dx: { type: "number" },
        dy: { type: "number" },
        ...screenshotAfter,
      },
      required: ["x", "y"],
    },
  },
  {
    name: "computer_drag",
    description: "Drag from one point to another (pixels in the latest screenshot).",
    inputSchema: {
      type: "object",
      properties: {
        ...targetProperties,
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        ...screenshotAfter,
      },
      required: ["fromX", "fromY", "toX", "toY"],
    },
  },
  {
    name: "computer_open_app",
    description: "Open an app, or bring it to the front, by its name or bundle id.",
    inputSchema: {
      type: "object",
      properties: { app: targetProperties.app },
      required: ["app"],
    },
  },
] as const;

/** Packaged app: Contents/Resources/atlas-computer; dev: the native build. */
export function atlasComputerHelperCandidates(execPath: string, moduleUrl: string): string[] {
  const candidates: string[] = [];
  const override = process.env.ATLAS_COMPUTER_HELPER;
  if (override) candidates.push(override);
  const contents = execPath.lastIndexOf(".app/Contents/");
  if (contents !== -1) {
    const app = execPath.slice(0, contents + ".app/Contents/".length);
    candidates.push(NodePath.join(app, "Resources/atlas-computer/atlas-computer"));
  }
  const moduleDirectory = NodePath.dirname(NodeURL.fileURLToPath(moduleUrl));
  for (const up of ["../../../../..", "../../../.."]) {
    candidates.push(
      NodePath.resolve(moduleDirectory, up, "native/atlas-computer/dist/atlas-computer"),
    );
  }
  return candidates;
}

function run(command: string, args: ReadonlyArray<string>, timeoutMs = 30_000) {
  return new Promise<{ readonly stdout: string; readonly code: number }>((resolve) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ stdout: String(stdout), code });
      },
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function numberArg(args: Json, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ComputerUseError(`${key} must be a number.`);
  }
  return value;
}

export function makeAtlasComputer(helper: string) {
  // The size of the latest screenshot of each window (key 0: the screen).
  const shots = new Map<number, { readonly width: number; readonly height: number }>();
  const allowed = new Set<string>();

  const callHelper = async (args: ReadonlyArray<string>): Promise<Json> => {
    const { stdout } = await run(helper, args);
    const line = stdout.trim().split("\n").pop() ?? "";
    let parsed: Json;
    try {
      parsed = JSON.parse(line) as Json;
    } catch {
      throw new ComputerUseError("The computer-use helper did not answer.");
    }
    if (parsed.ok !== true) {
      throw new ComputerUseError(String(parsed.error ?? "The computer-use helper failed."));
    }
    return parsed;
  };

  const listWindows = async (): Promise<DesktopWindow[]> =>
    ((await callHelper(["windows"])).windows as DesktopWindow[] | undefined) ?? [];

  const displayBounds = async (): Promise<Rect> => {
    const display = await callHelper(["display"]);
    return {
      x: Number(display.x),
      y: Number(display.y),
      width: Number(display.width),
      height: Number(display.height),
    };
  };

  const requireAccessibility = async () => {
    const permissions = await callHelper(["permissions"]);
    if (permissions.accessibility !== true) {
      throw new ComputerUseError(
        "Code Atlas needs Accessibility to control apps: System Settings → Privacy & Security → Accessibility → turn on Code Atlas. Then try again.",
      );
    }
  };

  // One question per app and session, answered in a system dialog so it works
  // whatever the thread's approval mode.
  const approve = async (key: string, label: string) => {
    if (allowed.has(key)) return;
    const { stdout, code } = await run(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv",
        "-e",
        'display dialog (item 1 of argv) with title "Code Atlas" buttons {"Don\'t Allow", "Allow"} default button "Allow" cancel button "Don\'t Allow" with icon caution giving up after 120',
        "-e",
        "return button returned of result",
        "-e",
        "end run",
        `Claude wants to see and control ${label} on this Mac.\n\nCode Atlas asks once per app in each Claude session.`,
      ],
      130_000,
    );
    if (code !== 0 || stdout.trim() !== "Allow") {
      throw new ComputerUseError(
        `The user did not allow control of ${label}. Ask them before trying again.`,
      );
    }
    allowed.add(key);
  };

  const resolveTarget = async (args: Json): Promise<DesktopWindow> => {
    const app = typeof args.app === "string" ? args.app : undefined;
    const windowId = typeof args.windowId === "number" ? args.windowId : undefined;
    if (app === undefined && windowId === undefined) {
      throw new ComputerUseError("Name the app (or a windowId) to act on.");
    }
    const window = findWindow(await listWindows(), { app, windowId });
    if (window === null) {
      throw new ComputerUseError(
        `No window of ${app ?? `id ${windowId}`} is on screen. Open the app with computer_open_app or check computer_windows.`,
      );
    }
    await approve(`app:${window.bundleId || window.app}`, `“${window.app}”`);
    return window;
  };

  const screenshot = async (window: DesktopWindow | null): Promise<ToolContent[]> => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "atlas-computer-"));
    const file = NodePath.join(directory, "shot.png");
    try {
      const area = window ?? (await displayBounds());
      const args =
        window === null
          ? ["-x", "-t", "png", "-D", "1", file]
          : ["-x", "-o", "-t", "png", "-l", String(window.windowId), file];
      const { code } = await run("/usr/sbin/screencapture", args);
      const exists = await NodeFSP.stat(file).then(
        () => true,
        () => false,
      );
      if (code !== 0 || !exists) {
        throw new ComputerUseError(
          "The screenshot failed. Code Atlas needs Screen Recording: System Settings → Privacy & Security → Screen & System Audio Recording → turn on Code Atlas.",
        );
      }
      await run("/usr/bin/sips", ["-Z", String(SCREENSHOT_MAX_SIDE), file]);
      const { stdout } = await run("/usr/bin/sips", [
        "-g",
        "pixelWidth",
        "-g",
        "pixelHeight",
        file,
      ]);
      const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1] ?? 0);
      const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1] ?? 0);
      shots.set(window?.windowId ?? 0, { width, height });
      const data = (await NodeFSP.readFile(file)).toString("base64");
      const name =
        window === null ? "the main screen" : `${window.app} (window ${window.windowId})`;
      return [
        { type: "image", data, mimeType: "image/png" },
        {
          type: "text",
          text: `Screenshot of ${name}: ${width}×${height} pixels for ${Math.round(area.width)}×${Math.round(area.height)} points. Use these pixel coordinates for clicks.`,
        },
      ];
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  };

  const toScreen = (window: DesktopWindow, x: number, y: number) =>
    imagePointToScreen(window, shots.get(window.windowId) ?? null, x, y);

  const afterAction = async (args: Json, window: DesktopWindow, summary: string) => {
    if (args.screenshot === false) return [{ type: "text", text: summary } as ToolContent];
    await sleep(350);
    const fresh = findWindow(await listWindows(), { windowId: window.windowId }) ?? window;
    return [{ type: "text", text: summary } as ToolContent, ...(await screenshot(fresh))];
  };

  const focus = async (window: DesktopWindow) => {
    await requireAccessibility();
    await callHelper(["activate", String(window.pid)]);
  };

  const callTool = async (name: string, args: Json): Promise<ToolContent[]> => {
    switch (name) {
      case "computer_windows": {
        const app = typeof args.app === "string" ? args.app.toLowerCase() : null;
        const windows = (await listWindows()).filter(
          (window) =>
            app === null ||
            window.app.toLowerCase().includes(app) ||
            window.bundleId.toLowerCase().includes(app),
        );
        const lines = windows.map(
          (window) =>
            `${window.windowId}  ${window.app}${window.title ? ` — ${window.title}` : ""}  (${Math.round(window.x)}, ${Math.round(window.y)}, ${Math.round(window.width)}×${Math.round(window.height)})`,
        );
        return [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No windows found." }];
      }
      case "computer_screenshot": {
        if (args.app === undefined && args.windowId === undefined) {
          await approve("screen", "the whole screen");
          return screenshot(null);
        }
        return screenshot(await resolveTarget(args));
      }
      case "computer_click": {
        const window = await resolveTarget(args);
        await focus(window);
        const point = toScreen(window, numberArg(args, "x"), numberArg(args, "y"));
        const clicks = typeof args.clicks === "number" ? Math.round(args.clicks) : 1;
        await callHelper([
          "click",
          String(point.x),
          String(point.y),
          args.button === "right" ? "right" : "left",
          String(clicks),
        ]);
        return afterAction(args, window, `Clicked ${window.app} at (${args.x}, ${args.y}).`);
      }
      case "computer_type": {
        const window = await resolveTarget(args);
        if (typeof args.text !== "string" || args.text.length === 0) {
          throw new ComputerUseError("text must be a non-empty string.");
        }
        await focus(window);
        await callHelper(["type", args.text]);
        return afterAction(args, window, `Typed ${args.text.length} characters in ${window.app}.`);
      }
      case "computer_key": {
        const window = await resolveTarget(args);
        const keys = typeof args.keys === "string" ? args.keys : "";
        const combo = parseKeyCombo(keys);
        if (combo === null) throw new ComputerUseError(`Unknown key or shortcut: ${keys}.`);
        await focus(window);
        const repeat = Math.max(1, Math.min(50, Math.round(Number(args.repeat ?? 1)) || 1));
        const hold = Math.max(0, Math.min(10_000, Number(args.holdMs ?? 0) || 0));
        for (let index = 0; index < repeat; index++) {
          await callHelper(["key", String(combo.keyCode), String(combo.flags), String(hold)]);
          if (index < repeat - 1) await sleep(60);
        }
        return afterAction(
          args,
          window,
          `Pressed ${keys}${repeat > 1 ? ` ×${repeat}` : ""} in ${window.app}.`,
        );
      }
      case "computer_scroll": {
        const window = await resolveTarget(args);
        await focus(window);
        const point = toScreen(window, numberArg(args, "x"), numberArg(args, "y"));
        await callHelper([
          "scroll",
          String(point.x),
          String(point.y),
          String(-(Number(args.dx) || 0)),
          String(-(Number(args.dy) || 0)),
        ]);
        return afterAction(args, window, `Scrolled ${window.app}.`);
      }
      case "computer_drag": {
        const window = await resolveTarget(args);
        await focus(window);
        const from = toScreen(window, numberArg(args, "fromX"), numberArg(args, "fromY"));
        const to = toScreen(window, numberArg(args, "toX"), numberArg(args, "toY"));
        await callHelper(["drag", String(from.x), String(from.y), String(to.x), String(to.y)]);
        return afterAction(args, window, `Dragged in ${window.app}.`);
      }
      case "computer_open_app": {
        const app = typeof args.app === "string" ? args.app.trim() : "";
        if (app.length === 0) throw new ComputerUseError("Name the app to open.");
        await approve(`open:${app.toLowerCase()}`, `“${app}”`);
        const byBundle = /^[\w-]+(\.[\w-]+){2,}$/.test(app);
        const { code } = await run("/usr/bin/open", byBundle ? ["-b", app] : ["-a", app]);
        if (code !== 0) throw new ComputerUseError(`Could not open ${app}.`);
        await sleep(1200);
        return [{ type: "text", text: `Opened ${app}. Take a screenshot to see it.` }];
      }
      default:
        throw new ComputerUseError(`Unknown tool ${name}.`);
    }
  };

  return { callTool };
}

export async function runAtlasComputerMcp(): Promise<void> {
  const send = (message: Json) => process.stdout.write(`${JSON.stringify(message)}\n`);
  let helper: string | null = null;
  for (const candidate of atlasComputerHelperCandidates(process.execPath, import.meta.url)) {
    if (
      await NodeFSP.stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    ) {
      helper = candidate;
      break;
    }
  }
  const computer = helper === null ? null : makeAtlasComputer(helper);
  // One call at a time: two agents' clicks must never interleave.
  let queue: Promise<unknown> = Promise.resolve();

  const handle = async (message: Json) => {
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : "";
    if (id === undefined || id === null) return;
    if (method === "initialize") {
      const params = (message.params ?? {}) as Json;
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "atlas-computer", version: "1.5.0" },
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const params = (message.params ?? {}) as Json;
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as Json;
      try {
        if (computer === null) {
          throw new ComputerUseError(
            "The computer-use helper is missing from this Code Atlas build.",
          );
        }
        const content = await computer.callTool(name, args);
        send({ jsonrpc: "2.0", id, result: { content } });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
      }
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  };

  const lines = NodeReadline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    queue = queue.then(() => handle(message)).catch(() => undefined);
  }
  await queue;
}
