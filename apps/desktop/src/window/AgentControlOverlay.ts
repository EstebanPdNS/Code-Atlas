// @effect-diagnostics nodeBuiltinImport:off -- This native boundary keeps one JXA process open while an agent uses another app's window.
// @effect-diagnostics globalTimers:off globalDate:off -- The idle timeout runs in Electron IPC callbacks, outside any Effect fiber.
import * as NodeChildProcess from "node:child_process";
import type { AgentControlOverlayEvent, AgentControlOverlayTarget } from "@t3tools/contracts";
import * as Electron from "electron";

import { AGENT_CONTROL_OVERLAY_EVENT_CHANNEL } from "../ipc/channels.ts";

/**
 * Code Atlas: while an agent drives another app (computer use, a desktop
 * driver, or an app a long command launched), a thin orange line frames that
 * app's front window and a pill over its top edge names the agent, with Stop.
 *
 * Both overlays sit directly above the target window in z-order (not always
 * on top), so windows in front of the target cover them as they cover the
 * target. They are click-through (the frame) or outside the window (the pill),
 * never take focus, and are left out of screen captures: the agent's own
 * screenshots show the app as it is.
 */

export interface TargetWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** CGWindowID of the target window, and of the window right above it (0: none). */
  readonly windowId: number;
  readonly above: number;
  /** The app's name, as macOS shows it. */
  readonly app: string;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A finished call keeps its app marked as driven this long. */
export const AGENT_CONTROL_IDLE_MS = 30_000;

// Resolves the app by bundle id, name, bundle path or binary name; with only
// a command, by an app launched since it started whose name it mentions. Then
// follows the app's front window (CGWindowList is front to back) at 5 Hz, or
// looks for the app once a second. Window bounds, owners and numbers need no
// Screen Recording permission. One process streams changes only. argv[1] is
// Electron's pid: the loop ends once that app is gone, so a crash that skips
// cleanup cannot leave osascript polling forever.
const TARGET_WINDOW_SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.import("AppKit");
function text(value) { return !value || value.isNil() ? "" : value.js; }
function resolve(spec, ownPid) {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const apps = workspace.runningApplications;
  const front = workspace.frontmostApplication;
  const frontPid = front.isNil() ? -1 : front.processIdentifier;
  let best = null;
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i);
    const launched = app.launchDate.isNil() ? 0 : app.launchDate.timeIntervalSince1970;
    // A hint only matches apps launched since its command started: skip the rest cheaply.
    if (spec.apps.length === 0 && launched < spec.since - 2) continue;
    const pid = app.processIdentifier;
    // JXA bridges this enum as a string.
    if (Number(app.activationPolicy) !== 0 || pid === ownPid || app.isTerminated) continue;
    const name = text(app.localizedName);
    const bundlePath = app.bundleURL.isNil() ? "" : text(app.bundleURL.path);
    const names = [
      name.toLowerCase(),
      bundlePath.split("/").pop().replace(/\\.app$/i, "").toLowerCase(),
      app.executableURL.isNil() ? "" : text(app.executableURL.lastPathComponent).toLowerCase(),
    ];
    const keys = [text(app.bundleIdentifier).toLowerCase(), bundlePath.toLowerCase()].concat(names);
    let rank = spec.apps.findIndex((wanted) => keys.indexOf(wanted) !== -1);
    if (rank === -1 && spec.hint && launched >= spec.since - 2) {
      if (names.some((key) => key.length >= 3 && spec.hint.indexOf(key) !== -1)) rank = spec.apps.length;
    }
    if (rank === -1) continue;
    const candidate = { pid, name, rank, front: pid === frontPid, launched };
    if (
      best === null || rank < best.rank ||
      (rank === best.rank && (candidate.front !== best.front ? candidate.front : launched > best.launched))
    ) best = candidate;
  }
  return best;
}
function frontWindow(target) {
  const list = $.CGWindowListCopyWindowInfo(
    $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
    $.kCGNullWindowID
  );
  if (!list) return null;
  $.CFMakeCollectable(list);
  const count = $.CFArrayGetCount(list);
  let above = 0;
  for (let i = 0; i < count; i++) {
    const w = ObjC.castRefToObject($.CFArrayGetValueAtIndex(list, i));
    if (w.objectForKey("kCGWindowLayer").js !== 0) continue;
    const number = w.objectForKey("kCGWindowNumber").js;
    if (w.objectForKey("kCGWindowOwnerPID").js === target.pid) {
      const b = ObjC.deepUnwrap(w.objectForKey("kCGWindowBounds"));
      if (b.Width >= 160 && b.Height >= 120) {
        return { x: b.X, y: b.Y, width: b.Width, height: b.Height, windowId: number, above: above, app: target.name };
      }
    }
    above = number;
  }
  return null;
}
function run(argv) {
  const spec = JSON.parse(argv[0]);
  const parentPid = Number(argv[1]) || 0;
  let target = null;
  let previous = "";
  let appCount = -1;
  while (true) {
    if (parentPid > 0) {
      const parent = $.NSRunningApplication.runningApplicationWithProcessIdentifier(parentPid);
      if (parent.isNil() || parent.isTerminated) return;
    }
    if (target !== null) {
      const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(target.pid);
      if (app.isNil() || app.isTerminated) target = null;
    }
    if (target === null) {
      // Nothing launched or quit since the last look: the answer is the same.
      const count = $.NSWorkspace.sharedWorkspace.runningApplications.count;
      if (count !== appCount) {
        appCount = count;
        target = resolve(spec, parentPid);
      }
    }
    const line = JSON.stringify(target === null ? null : frontWindow(target));
    if (line !== previous) {
      const data = $(line + "\\n").dataUsingEncoding($.NSUTF8StringEncoding);
      try {
        $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
      } catch (error) {
        return;
      }
      previous = line;
    }
    $.NSThread.sleepForTimeInterval(target === null ? 1 : 0.2);
  }
}`;

// The frame's line sits just outside the window edge, so it never covers content.
const FRAME_LINE = 2;
const PILL_HEIGHT = 30;
const PILL_GAP = 8;
const PILL_DEFAULT_WIDTH = 380;

// A solid line with the macOS window's corner radius; it fades in once and
// then stays still, so nothing repaints while the agent works.
const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.frame{position:absolute;inset:0;border-radius:${12 + FRAME_LINE}px;border:${FRAME_LINE}px solid #f79443;
animation:in 180ms cubic-bezier(.2,0,0,1)}
@keyframes in{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.frame{animation:none}}
</style></head><body><div class="frame"></div></body></html>`;

// Stop sets the page title: the main process reads it without a preload.
const PILL_HTML = `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
html,body{margin:0;background:transparent;overflow:hidden;-webkit-user-select:none;cursor:default}
body{font:500 11.5px/1 "SF Mono",SFMono-Regular,ui-monospace,Menlo,monospace;color:#f3e3d4}
.pill{position:absolute;top:2px;left:2px;display:inline-flex;align-items:center;gap:8px;height:24px;padding:0 3px 0 10px;
border-radius:13px;background:rgba(30,25,22,.94);border:1px solid rgba(255,173,102,.6);box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;background:#f79443;box-shadow:0 0 6px rgba(247,148,67,.9)}
.brand{color:#ffad66}
button{font:inherit;color:#ffe0c5;background:rgba(255,173,102,.14);border:1px solid rgba(255,173,102,.45);border-radius:9px;
height:18px;padding:0 9px;cursor:pointer;transition:background-color 140ms cubic-bezier(.2,0,0,1)}
button:hover{background:rgba(255,173,102,.3)}
button:active{transform:scale(.96)}
@media (prefers-reduced-motion:reduce){button{transition:none}button:active{transform:none}}
</style></head><body><div class="pill"><span class="dot"></span><span><span class="brand">Code Atlas</span> · <span id="agent">An agent</span> is using this window</span><button id="stop" type="button" title="Pause this agent's task">Stop</button></div>
<script>document.getElementById("stop").addEventListener("click",()=>{document.title="stop:"+Date.now()})</script></body></html>`;

export function parseTargetWindow(line: string): TargetWindow | null {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object") return null;
    const { x, y, width, height, windowId, above, app } = value as Record<string, unknown>;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      typeof windowId !== "number"
    ) {
      return null;
    }
    return {
      x,
      y,
      width,
      height,
      windowId,
      above: typeof above === "number" ? above : 0,
      app: typeof app === "string" ? app : "",
    };
  } catch {
    return null;
  }
}

/**
 * Where the pill goes: centered above the window, else below it, else inside
 * its title bar at the right (a maximized window), never over its content.
 */
export function pillBounds(window: Rect, workArea: Rect, pillWidth: number): Rect {
  const clampX = (x: number) =>
    Math.round(Math.min(Math.max(x, workArea.x + 4), workArea.x + workArea.width - pillWidth - 4));
  const centeredX = clampX(window.x + (window.width - pillWidth) / 2);
  const aboveY = window.y - PILL_GAP - PILL_HEIGHT;
  if (aboveY >= workArea.y) {
    return { x: centeredX, y: Math.round(aboveY), width: pillWidth, height: PILL_HEIGHT };
  }
  const belowY = window.y + window.height + PILL_GAP;
  if (belowY + PILL_HEIGHT <= workArea.y + workArea.height) {
    return { x: centeredX, y: Math.round(belowY), width: pillWidth, height: PILL_HEIGHT };
  }
  return {
    x: clampX(window.x + window.width - pillWidth - 10),
    y: Math.round(Math.max(window.y, workArea.y)),
    width: pillWidth,
    height: PILL_HEIGHT,
  };
}

/** How long a target stays marked; null while its call runs, 0 once it expired. */
export function idleRemainingMs(
  target: Pick<AgentControlOverlayTarget, "running" | "actionAt">,
  nowMs: number,
): number | null {
  if (target.running) return null;
  const actionMs = Date.parse(target.actionAt);
  if (!Number.isFinite(actionMs)) return 0;
  return Math.max(0, AGENT_CONTROL_IDLE_MS - (nowMs - actionMs));
}

/** What the JXA watcher looks for; targets with the same spec share one watcher. */
export function watchSpec(target: AgentControlOverlayTarget): string {
  const apps = target.apps.map((app) => app.toLowerCase());
  if (apps.length > 0) return JSON.stringify({ apps, hint: "", since: 0 });
  const since = Date.parse(target.startedAt);
  return JSON.stringify({
    apps,
    hint: (target.hint ?? "").toLowerCase(),
    since: Number.isFinite(since) ? since / 1000 : 0,
  });
}

/** Overlay windows stay transparent: the theme sync must not paint them. */
const overlayWindows = new WeakSet<Electron.BrowserWindow>();

export function isAgentControlOverlayWindow(window: Electron.BrowserWindow): boolean {
  return overlayWindows.has(window);
}

function makeOverlayWindow(html: string, options: { readonly clickable: boolean }) {
  const window = new Electron.BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Left fullscreenable: `false` keeps the frame out of a full-screen app's Space.
    // The frame reaches past the window, so past the screen edge for a window at it.
    enableLargerThanScreen: true,
    focusable: false,
    skipTaskbar: true,
    acceptFirstMouse: options.clickable,
    width: PILL_DEFAULT_WIDTH,
    height: PILL_HEIGHT,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  overlayWindows.add(window);
  if (!options.clickable) window.setIgnoreMouseEvents(true);
  window.setContentProtection(true);
  // Without skipTransformProcessType, Electron briefly turns Code Atlas into a
  // background app to apply this, which throws its own full-screen window out
  // of its Space and leaves it stuck there.
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return window;
}

export interface AgentControlOverlay {
  /**
   * Marks the app the target names; null removes the overlay. `rendererId` is
   * the webContents that asked: Stop and the resolved app name go back to it,
   * and the overlay clears when it reloads or crashes, since a fresh renderer
   * never sends the null that would remove it.
   */
  readonly set: (target: AgentControlOverlayTarget | null, rendererId?: number) => void;
}

interface Current {
  target: AgentControlOverlayTarget;
  rendererId: number | undefined;
  readonly spec: string;
  stopWatching: () => void;
  window: TargetWindow | null;
  resolvedApp: string | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function makeAgentControlOverlay(enabled: boolean): AgentControlOverlay {
  let current: Current | null = null;
  let frame: Electron.BrowserWindow | null = null;
  let pill: Electron.BrowserWindow | null = null;
  let pillLoaded = false;
  let pillAgent: string | null = null;
  let pillWidth: number | null = null;
  let orderedAbove: { windowId: number; above: number } | null = null;
  // Until the interrupt lands, the renderer may still re-send the call Stop ended.
  let stoppedKey: string | null = null;
  const watchedRenderers = new Set<number>();

  const send = (rendererId: number | undefined, event: AgentControlOverlayEvent) => {
    if (rendererId === undefined) return;
    const contents = Electron.webContents.fromId(rendererId);
    if (contents && !contents.isDestroyed())
      contents.send(AGENT_CONTROL_OVERLAY_EVENT_CHANNEL, event);
  };

  const ensureFrame = () => {
    if (frame && !frame.isDestroyed()) return frame;
    frame = makeOverlayWindow(FRAME_HTML, { clickable: false });
    return frame;
  };

  const ensurePill = () => {
    if (pill && !pill.isDestroyed()) return pill;
    const window = makeOverlayWindow(PILL_HTML, { clickable: true });
    pill = window;
    pillLoaded = false;
    pillAgent = null;
    pillWidth = null;
    window.webContents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (!title.startsWith("stop:") || current === null) return;
      stoppedKey = current.target.key;
      send(current.rendererId, { type: "stop", key: stoppedKey });
      clear();
    });
    window.webContents.once("did-finish-load", () => {
      if (pill !== window) return;
      pillLoaded = true;
      labelPill();
    });
    return window;
  };

  // Writes the agent's name into the pill and sizes the window to it.
  const labelPill = () => {
    const window = pill;
    const agent = current?.target.agent;
    if (!window || window.isDestroyed() || !pillLoaded) return;
    if (agent === undefined || agent === pillAgent) return;
    pillAgent = agent;
    window.webContents
      .executeJavaScript(
        `(() => { document.getElementById("agent").textContent = ${JSON.stringify(agent)};
          return Math.ceil(document.querySelector(".pill").getBoundingClientRect().width) + 6; })()`,
      )
      .then((width: unknown) => {
        if (pill !== window || typeof width !== "number" || !Number.isFinite(width)) return;
        pillWidth = Math.min(Math.max(width, 120), 720);
        place(current?.window ?? null);
      })
      .catch(() => undefined);
  };

  const hide = () => {
    orderedAbove = null;
    if (frame && !frame.isDestroyed()) frame.hide();
    if (pill && !pill.isDestroyed()) pill.hide();
  };

  const place = (target: TargetWindow | null) => {
    if (target === null) {
      hide();
      return;
    }
    const frameWindow = ensureFrame();
    const pillWindow = ensurePill();
    frameWindow.setBounds({
      x: Math.round(target.x - FRAME_LINE),
      y: Math.round(target.y - FRAME_LINE),
      width: Math.round(target.width + FRAME_LINE * 2),
      height: Math.round(target.height + FRAME_LINE * 2),
    });
    const shown = [frameWindow];
    if (pillWidth !== null) {
      const { workArea } = Electron.screen.getDisplayMatching(target);
      pillWindow.setBounds(pillBounds(target, workArea, pillWidth));
      shown.push(pillWindow);
    } else {
      labelPill();
    }
    let reorder = orderedAbove?.windowId !== target.windowId || orderedAbove.above !== target.above;
    for (const window of shown) {
      if (window.isVisible()) continue;
      window.showInactive();
      reorder = true;
    }
    if (!reorder) return;
    // Right above the target: pill first, then the frame between it and the window.
    try {
      for (const window of shown.toReversed()) window.moveAbove(`window:${target.windowId}:0`);
    } catch {
      // The window closed between the watcher's report and now; the next report hides us.
    }
    orderedAbove = { windowId: target.windowId, above: target.above };
  };

  const watch = (
    spec: string,
    onWindow: (window: TargetWindow | null) => void,
    onGone: () => void,
  ) => {
    const child = NodeChildProcess.spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", TARGET_WINDOW_SCRIPT, spec, String(process.pid)],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let pending = "";
    let closed = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!closed) onWindow(parseTargetWindow(line));
      }
    });
    const onExit = () => {
      if (closed) return;
      closed = true;
      hide();
      onGone();
    };
    child.on("error", onExit);
    child.on("exit", onExit);
    return () => {
      closed = true;
      child.stdout.removeAllListeners("data");
      child.kill();
    };
  };

  const stopCurrent = () => {
    if (current !== null) {
      current.stopWatching();
      if (current.idleTimer !== null) clearTimeout(current.idleTimer);
    }
    current = null;
    hide();
  };

  // The overlay windows are kept, hidden, for the next target: creating them
  // again for every call made the frame flicker in and out between actions.
  const clear = () => {
    stopCurrent();
  };

  const set = (target: AgentControlOverlayTarget | null, rendererId?: number) => {
    if (!enabled) return;
    if (rendererId !== undefined && target !== null) clearOnRendererReset(rendererId);
    if (target === null) {
      clear();
      return;
    }
    if (target.key === stoppedKey) return;
    const remaining = idleRemainingMs(target, Date.now());
    const spec = watchSpec(target);
    const sameWatcher = current !== null && current.spec === spec;
    // A command that launched nothing we could find is not driving anything once it ends.
    const unresolvedHint = target.apps.length === 0 && !(sameWatcher && current!.resolvedApp);
    if (remaining === 0 || (remaining !== null && unresolvedHint)) {
      clear();
      return;
    }
    if (!sameWatcher) {
      // A new app keeps the overlay windows; only the watcher changes.
      stopCurrent();
      const entry: Current = {
        target,
        rendererId,
        spec,
        stopWatching: () => {},
        window: null,
        resolvedApp: null,
        idleTimer: null,
      };
      // A watcher that dies on its own must not block a later set(sameTarget).
      entry.stopWatching = watch(
        spec,
        (window) => {
          if (current !== entry) return;
          entry.window = window;
          if (window !== null && window.app !== "" && window.app !== entry.resolvedApp) {
            entry.resolvedApp = window.app;
            send(entry.rendererId, { type: "resolved", key: entry.target.key, app: window.app });
          }
          place(window);
        },
        () => {
          if (current === entry) current = null;
        },
      );
      current = entry;
    }
    const entry = current!;
    const keyChanged = entry.target.key !== target.key;
    entry.target = target;
    entry.rendererId = rendererId ?? entry.rendererId;
    if (keyChanged && entry.resolvedApp !== null) {
      send(entry.rendererId, { type: "resolved", key: target.key, app: entry.resolvedApp });
    }
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
    entry.idleTimer =
      remaining === null
        ? null
        : setTimeout(() => {
            if (current === entry) clear();
          }, remaining);
    labelPill();
  };

  const clearOnRendererReset = (rendererId: number) => {
    if (watchedRenderers.has(rendererId)) return;
    const contents = Electron.webContents.fromId(rendererId);
    if (!contents || contents.isDestroyed()) return;
    watchedRenderers.add(rendererId);
    const clearIfOwner = () => {
      if (current?.rendererId === rendererId) clear();
    };
    contents.on(
      "did-start-navigation",
      (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (event.isMainFrame && !event.isSameDocument) clearIfOwner();
      },
    );
    contents.on("render-process-gone", clearIfOwner);
    contents.once("destroyed", () => {
      watchedRenderers.delete(rendererId);
      clearIfOwner();
    });
  };

  return { set };
}
