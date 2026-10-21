// @effect-diagnostics nodeBuiltinImport:off -- This native boundary keeps one JXA process open while an agent uses another app's window.
import * as NodeChildProcess from "node:child_process";
import * as Electron from "electron";

/**
 * Code Atlas: while an agent drives another app (Codex computer use), an
 * orange glow frames that app's front window, like Claude's computer-use
 * indicator. The overlay is transparent, click-through and only shown while
 * the app is frontmost, so it never paints over other windows.
 */

export interface TargetWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frontmost: boolean;
}

// Matches the app by bundle identifier or name. Window bounds and owner PIDs
// need no Screen Recording permission. One process streams changes only.
// argv[1] is Electron's pid: the loop ends once that app is gone, so a crash
// that skips cleanup cannot leave osascript polling forever.
const TARGET_WINDOW_SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.import("AppKit");
function run(argv) {
  const target = String(argv[0] || "").toLowerCase();
  const parentPid = Number(argv[1]) || 0;
  let previous = "";
  while (true) {
    if (parentPid > 0) {
      const parent = $.NSRunningApplication.runningApplicationWithProcessIdentifier(parentPid);
      if (parent.isNil() || parent.isTerminated) return;
    }
    const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
    let pid = null;
    for (let i = 0; i < apps.count; i++) {
      const app = apps.objectAtIndex(i);
      const bundleId = app.bundleIdentifier.isNil() ? "" : app.bundleIdentifier.js.toLowerCase();
      const name = app.localizedName.isNil() ? "" : app.localizedName.js.toLowerCase();
      if (bundleId === target || name === target) { pid = app.processIdentifier; break; }
    }
    let result = null;
    if (pid !== null) {
      const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
      const list = $.CGWindowListCopyWindowInfo(
        $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
        $.kCGNullWindowID
      );
      if (list) {
        $.CFMakeCollectable(list);
        const count = $.CFArrayGetCount(list);
        for (let i = 0; i < count; i++) {
          const w = ObjC.castRefToObject($.CFArrayGetValueAtIndex(list, i));
          if (w.objectForKey("kCGWindowOwnerPID").js !== pid || w.objectForKey("kCGWindowLayer").js !== 0) continue;
          const b = ObjC.deepUnwrap(w.objectForKey("kCGWindowBounds"));
          if (b.Width < 160 || b.Height < 120) continue;
          result = { x: b.X, y: b.Y, width: b.Width, height: b.Height, frontmost: !front.isNil() && front.processIdentifier === pid };
          break;
        }
      }
    }
    const line = JSON.stringify(result);
    if (line !== previous) {
      const data = $(line + "\\n").dataUsingEncoding($.NSUTF8StringEncoding);
      try {
        $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
      } catch (error) {
        return;
      }
      previous = line;
    }
    $.NSThread.sleepForTimeInterval(0.4);
  }
}`;

// The glow extends past the window edge by this much on every side.
const GLOW_MARGIN = 18;

// Three pulses announce the glow, then it rests at full strength: a
// continuous animation would keep the compositor busy for the whole task.

const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.glow{position:absolute;inset:${GLOW_MARGIN - 2}px;border-radius:14px;border:2px solid rgba(255,173,102,.95);
box-shadow:0 0 22px 6px rgba(247,148,67,.55),inset 0 0 18px 2px rgba(247,148,67,.3);
animation:pulse 2.4s ease-in-out 3}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.glow{animation:none}}
</style></head><body><div class="glow"></div></body></html>`;

export function parseTargetWindow(line: string): TargetWindow | null {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object") return null;
    const { x, y, width, height, frontmost } = value as Record<string, unknown>;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      return null;
    }
    return { x, y, width, height, frontmost: frontmost === true };
  } catch {
    return null;
  }
}

export interface AgentControlOverlay {
  /**
   * Frames the named app's front window; null removes the glow. `rendererId`
   * is the webContents that asked: the glow clears when it reloads or crashes,
   * since a fresh renderer never sends the null that would remove it.
   */
  readonly set: (app: string | null, rendererId?: number) => void;
}

export function makeAgentControlOverlay(enabled: boolean): AgentControlOverlay {
  let current: { app: string; stopWatching: () => void } | null = null;
  let overlay: Electron.BrowserWindow | null = null;
  const watchedRenderers = new Set<number>();

  const ensureOverlay = () => {
    if (overlay && !overlay.isDestroyed()) return overlay;
    overlay = new Electron.BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, "floating");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
    return overlay;
  };

  const hide = () => {
    if (overlay && !overlay.isDestroyed()) overlay.hide();
  };

  const place = (window: TargetWindow | null) => {
    if (window === null || !window.frontmost) {
      hide();
      return;
    }
    const target = ensureOverlay();
    target.setBounds({
      x: Math.round(window.x - GLOW_MARGIN),
      y: Math.round(window.y - GLOW_MARGIN),
      width: Math.round(window.width + GLOW_MARGIN * 2),
      height: Math.round(window.height + GLOW_MARGIN * 2),
    });
    if (!target.isVisible()) target.showInactive();
  };

  const watch = (app: string, onGone: () => void) => {
    const child = NodeChildProcess.spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", TARGET_WINDOW_SCRIPT, app, String(process.pid)],
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
        if (!closed) place(parseTargetWindow(line));
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

  const set = (app: string | null, rendererId?: number) => {
    if (!enabled) return;
    if (rendererId !== undefined && app !== null) clearOnRendererReset(rendererId);
    if (current?.app === app) return;
    current?.stopWatching();
    current = null;
    if (app === null) {
      if (overlay && !overlay.isDestroyed()) overlay.destroy();
      overlay = null;
      return;
    }
    const entry = { app, stopWatching: () => {} };
    // A watcher that dies on its own must not block a later set(sameApp).
    entry.stopWatching = watch(app, () => {
      if (current === entry) current = null;
    });
    current = entry;
  };

  const clearOnRendererReset = (rendererId: number) => {
    if (watchedRenderers.has(rendererId)) return;
    const contents = Electron.webContents.fromId(rendererId);
    if (!contents || contents.isDestroyed()) return;
    watchedRenderers.add(rendererId);
    const clear = () => set(null);
    contents.on(
      "did-start-navigation",
      (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (event.isMainFrame && !event.isSameDocument) clear();
      },
    );
    contents.on("render-process-gone", clear);
    contents.once("destroyed", () => {
      watchedRenderers.delete(rendererId);
      clear();
    });
  };

  return { set };
}
