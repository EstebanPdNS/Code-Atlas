/**
 * Code Atlas: the pure parts of Claude's computer use (key combos, image to
 * screen coordinates, window matching). AtlasComputerMcp.ts does the I/O.
 */

/** macOS virtual key codes (ANSI layout), by the names agents write. */
const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  return: 36,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  tab: 48,
  space: 49,
  "`": 50,
  backspace: 51,
  escape: 53,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  home: 115,
  pageup: 116,
  forwarddelete: 117,
  end: 119,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
  enter: "return",
  esc: "escape",
  delete: "backspace",
  del: "forwarddelete",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  pgup: "pageup",
  pgdn: "pagedown",
  spacebar: "space",
  " ": "space",
};

const MODIFIER_FLAGS: Readonly<Record<string, number>> = {
  shift: 0x20000,
  ctrl: 0x40000,
  control: 0x40000,
  alt: 0x80000,
  option: 0x80000,
  opt: 0x80000,
  cmd: 0x100000,
  command: 0x100000,
  meta: 0x100000,
  super: 0x100000,
  fn: 0x800000,
};

export interface KeyCombo {
  readonly keyCode: number;
  readonly flags: number;
}

/** "cmd+shift+s", "Return", "left" → key code and modifier flags; null when unknown. */
export function parseKeyCombo(keys: string): KeyCombo | null {
  const parts = keys
    .trim()
    .toLowerCase()
    .split(/\s*\+\s*/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  let flags = 0;
  for (const modifier of parts.slice(0, -1)) {
    const flag = MODIFIER_FLAGS[modifier];
    if (flag === undefined) return null;
    flags |= flag;
  }
  const last = parts[parts.length - 1]!;
  const name = KEY_ALIASES[last] ?? last;
  const keyCode = KEY_CODES[name];
  return keyCode === undefined ? null : { keyCode, flags };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A point in a screenshot (image pixels) to global screen points. Without a
 * screenshot of that area, coordinates are taken as points from its corner.
 */
export function imagePointToScreen(
  area: Rect,
  image: { readonly width: number; readonly height: number } | null,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  const scaleX = image === null || image.width <= 0 ? 1 : area.width / image.width;
  const scaleY = image === null || image.height <= 0 ? 1 : area.height / image.height;
  const clampedX = Math.min(Math.max(x * scaleX, 0), Math.max(area.width - 1, 0));
  const clampedY = Math.min(Math.max(y * scaleY, 0), Math.max(area.height - 1, 0));
  return { x: Math.round(area.x + clampedX), y: Math.round(area.y + clampedY) };
}

export interface DesktopWindow extends Rect {
  readonly windowId: number;
  readonly pid: number;
  readonly app: string;
  readonly bundleId: string;
  readonly title: string;
}

/**
 * The front window of the app an agent names (by name, bundle id or a part of
 * either), or the window with that id. The list is front to back.
 */
export function findWindow(
  windows: ReadonlyArray<DesktopWindow>,
  target: { readonly app?: string | undefined; readonly windowId?: number | undefined },
): DesktopWindow | null {
  if (target.windowId !== undefined) {
    return windows.find((window) => window.windowId === target.windowId) ?? null;
  }
  const wanted = target.app?.trim().toLowerCase();
  if (!wanted) return null;
  const exact = windows.find(
    (window) => window.app.toLowerCase() === wanted || window.bundleId.toLowerCase() === wanted,
  );
  if (exact) return exact;
  return (
    windows.find(
      (window) =>
        window.app.toLowerCase().includes(wanted) || window.bundleId.toLowerCase().includes(wanted),
    ) ?? null
  );
}

/** Long side of the images sent to the model: enough to read, cheap in tokens. */
export const SCREENSHOT_MAX_SIDE = 1568;

/** The names an app's approval is stored under: its name and bundle id, lowercased. */
export function appApprovalKeys(app: string, bundleId = ""): string[] {
  const keys = [app, bundleId]
    .map((value) =>
      value
        .trim()
        .replace(/\.app$/iu, "")
        .toLowerCase(),
    )
    .filter((value) => value.length > 0);
  return [...new Set(keys)];
}
