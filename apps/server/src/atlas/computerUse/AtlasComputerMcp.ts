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
  appApprovalKeys,
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
  foreground: {
    type: "boolean",
    description:
      "Bring the app to the front and send real input. Default false: input goes to the app in the background and the user keeps their pointer. Use true only when a screenshot shows the background action had no effect (games, emulators).",
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
      "Click at x, y (pixels in the latest screenshot of the window) with Claude's own cursor; the app stays where it is and the user keeps their pointer.",
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

/** Apps the user chose "Always Allow" for, kept across Claude sessions. */
function approvalsFile(): string {
  const home = process.env.T3CODE_HOME || NodePath.join(NodeOS.homedir(), ".code-atlas");
  return NodePath.join(home, "userdata", "computer-use-apps.json");
}

async function readAlwaysAllowed(): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await NodeFSP.readFile(approvalsFile(), "utf8"));
    const apps = (parsed as { readonly apps?: unknown }).apps;
    return new Set(Array.isArray(apps) ? apps.filter((app) => typeof app === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeAlwaysAllowed(apps: ReadonlySet<string>) {
  const file = approvalsFile();
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  await NodeFSP.writeFile(file, `${JSON.stringify({ apps: [...apps].toSorted() }, null, 2)}\n`);
}

const SETTINGS_PANES = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
} as const;

// macOS keeps a grant tied to the signature it was given to; a Code Atlas
// build signed differently shows as allowed yet is asked again.
const STALE_GRANT_HINT =
  "If Code Atlas already shows as on there, macOS still holds the permission of an older Code Atlas build: select Code Atlas, remove it with −, add it again with +, then quit and reopen Code Atlas.";

export function makeAtlasComputer(helper: string) {
  // The size of the latest screenshot of each window (key 0: the screen).
  const shots = new Map<number, { readonly width: number; readonly height: number }>();
  // "Allow Once" answers last for this session; "Always Allow" is stored.
  const allowed = new Set<string>();
  const alwaysAllowed = readAlwaysAllowed();
  const requested = new Set<keyof typeof SETTINGS_PANES>();

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

  // Checked before every capture or input, so a missing permission is asked
  // for once per session instead of re-prompting on every screencapture.
  const ensurePermission = async (kind: keyof typeof SETTINGS_PANES) => {
    const permissions = await callHelper(["permissions"]);
    const granted =
      kind === "screen" ? permissions.screenRecording === true : permissions.accessibility === true;
    if (granted) return;
    const name = kind === "screen" ? "Screen & System Audio Recording" : "Accessibility";
    if (!requested.has(kind)) {
      requested.add(kind);
      await callHelper(["request", kind]);
      await run("/usr/bin/open", [SETTINGS_PANES[kind]]);
    }
    throw new ComputerUseError(
      `Code Atlas needs ${name} permission (System Settings → Privacy & Security → ${name} → turn on Code Atlas; that page is now open). ${STALE_GRANT_HINT} Tell the user exactly this, then wait for them before trying again.`,
    );
  };

  // One question per app, in a system dialog so it works whatever the
  // thread's approval mode; "Always Allow" is remembered for later sessions.
  const approve = async (app: string, bundleId = "") => {
    const keys = appApprovalKeys(app, bundleId);
    const always = await alwaysAllowed;
    if (keys.some((key) => allowed.has(key) || always.has(key))) return;
    const { stdout, code } = await run(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv",
        "-e",
        'display dialog (item 1 of argv) with title "Code Atlas" buttons {"Don\'t Allow", "Allow Once", "Always Allow"} default button "Always Allow" cancel button "Don\'t Allow" with icon caution giving up after 120',
        "-e",
        "return button returned of result",
        "-e",
        "end run",
        `Claude wants to see and control “${app}” on this Mac: take screenshots of its windows, click, type and press keys in it.`,
      ],
      130_000,
    );
    const answer = stdout.trim();
    if (code !== 0 || (answer !== "Allow Once" && answer !== "Always Allow")) {
      throw new ComputerUseError(
        `The user did not allow control of “${app}”. Ask them before trying again.`,
      );
    }
    for (const key of keys) allowed.add(key);
    if (answer === "Always Allow") {
      for (const key of keys) always.add(key);
      await writeAlwaysAllowed(always).catch(() => undefined);
    }
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
    await approve(window.app, window.bundleId);
    return window;
  };

  const screenshot = async (window: DesktopWindow | null): Promise<ToolContent[]> => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "atlas-computer-"));
    const file = NodePath.join(directory, "shot.png");
    try {
      await ensurePermission("screen");
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
          `The screenshot failed. Code Atlas needs Screen & System Audio Recording permission. ${STALE_GRANT_HINT}`,
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

  // Claude's gray cursor, drawn by the helper; one process for the session.
  let cursor: NodeChildProcess.ChildProcess | null = null;
  let cursorAt: { readonly x: number; readonly y: number } | null = null;
  const cue = (line: string) => {
    if (cursor === null || cursor.exitCode !== null || cursor.stdin?.destroyed) {
      cursor = NodeChildProcess.spawn(helper, ["cursor"], { stdio: ["pipe", "ignore", "ignore"] });
      cursor.on("error", () => undefined);
      cursor.stdin?.on("error", () => undefined);
    }
    cursor.stdin?.write(`${line}\n`);
  };
  // The cursor glides first, so the user sees where Claude is about to act.
  const glideTo = async (point: { readonly x: number; readonly y: number }) => {
    cue(`move ${point.x} ${point.y}`);
    cursorAt = point;
    await sleep(380);
  };
  const glideIntoWindow = (window: DesktopWindow) =>
    glideTo(
      cursorAt !== null &&
        cursorAt.x >= window.x &&
        cursorAt.y >= window.y &&
        cursorAt.x <= window.x + window.width &&
        cursorAt.y <= window.y + window.height
        ? cursorAt
        : {
            x: Math.round(window.x + window.width / 2),
            y: Math.round(window.y + window.height / 2),
          },
    );

  // Background input goes straight to the app: the user keeps their pointer
  // and focus. Foreground input brings the app to the front first, for apps
  // that ignore background input (games, emulators).
  const prepareInput = async (window: DesktopWindow, args: Json) => {
    await ensurePermission("accessibility");
    const foreground = args.foreground === true;
    if (foreground) await callHelper(["activate", String(window.pid)]);
    return foreground ? "foreground" : "background";
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
          await approve("the whole screen");
          return screenshot(null);
        }
        return screenshot(await resolveTarget(args));
      }
      case "computer_click": {
        const window = await resolveTarget(args);
        const mode = await prepareInput(window, args);
        const point = toScreen(window, numberArg(args, "x"), numberArg(args, "y"));
        const clicks = typeof args.clicks === "number" ? Math.round(args.clicks) : 1;
        await glideTo(point);
        cue(`click ${point.x} ${point.y}`);
        await callHelper([
          "click",
          String(window.pid),
          String(window.windowId),
          mode,
          String(point.x),
          String(point.y),
          args.button === "right" ? "right" : "left",
          String(clicks),
        ]);
        return afterAction(
          args,
          window,
          `Clicked ${window.app} at (${args.x}, ${args.y}) (${mode}).`,
        );
      }
      case "computer_type": {
        const window = await resolveTarget(args);
        if (typeof args.text !== "string" || args.text.length === 0) {
          throw new ComputerUseError("text must be a non-empty string.");
        }
        const mode = await prepareInput(window, args);
        await glideIntoWindow(window);
        await callHelper(["type", String(window.pid), mode, args.text]);
        return afterAction(
          args,
          window,
          `Typed ${args.text.length} characters in ${window.app} (${mode}).`,
        );
      }
      case "computer_key": {
        const window = await resolveTarget(args);
        const keys = typeof args.keys === "string" ? args.keys : "";
        const combo = parseKeyCombo(keys);
        if (combo === null) throw new ComputerUseError(`Unknown key or shortcut: ${keys}.`);
        const mode = await prepareInput(window, args);
        await glideIntoWindow(window);
        const repeat = Math.max(1, Math.min(50, Math.round(Number(args.repeat ?? 1)) || 1));
        const hold = Math.max(0, Math.min(10_000, Number(args.holdMs ?? 0) || 0));
        for (let index = 0; index < repeat; index++) {
          await callHelper([
            "key",
            String(window.pid),
            mode,
            String(combo.keyCode),
            String(combo.flags),
            String(hold),
          ]);
          if (index < repeat - 1) await sleep(60);
        }
        return afterAction(
          args,
          window,
          `Pressed ${keys}${repeat > 1 ? ` ×${repeat}` : ""} in ${window.app} (${mode}).`,
        );
      }
      case "computer_scroll": {
        const window = await resolveTarget(args);
        const mode = await prepareInput(window, args);
        const point = toScreen(window, numberArg(args, "x"), numberArg(args, "y"));
        await glideTo(point);
        await callHelper([
          "scroll",
          String(window.pid),
          String(window.windowId),
          mode,
          String(point.x),
          String(point.y),
          String(-(Number(args.dx) || 0)),
          String(-(Number(args.dy) || 0)),
        ]);
        return afterAction(args, window, `Scrolled ${window.app} (${mode}).`);
      }
      case "computer_drag": {
        const window = await resolveTarget(args);
        const mode = await prepareInput(window, args);
        const from = toScreen(window, numberArg(args, "fromX"), numberArg(args, "fromY"));
        const to = toScreen(window, numberArg(args, "toX"), numberArg(args, "toY"));
        await glideTo(from);
        cue(`move ${to.x} ${to.y}`);
        cursorAt = to;
        await callHelper([
          "drag",
          String(window.pid),
          String(window.windowId),
          mode,
          String(from.x),
          String(from.y),
          String(to.x),
          String(to.y),
        ]);
        return afterAction(args, window, `Dragged in ${window.app} (${mode}).`);
      }
      case "computer_open_app": {
        const app = typeof args.app === "string" ? args.app.trim() : "";
        if (app.length === 0) throw new ComputerUseError("Name the app to open.");
        await approve(app);
        const byBundle = /^[\w-]+(\.[\w-]+){2,}$/.test(app);
        // -g: launched behind the user's current app, like the rest of computer use.
        const { code } = await run(
          "/usr/bin/open",
          byBundle ? ["-g", "-b", app] : ["-g", "-a", app],
        );
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
