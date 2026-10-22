/**
 * Code Atlas: which app on this Mac the current turn's agent drives, read
 * from its tool calls. Covered:
 *
 * - Codex computer use: `cua_repl.js` code (`let arc = await cua.getApp("Arc")`,
 *   then `arc.click(…)` in this or a later call; the REPL keeps its variables).
 * - Claude computer use: `mcp__computer-use__*`, `mcp__remote-devices__computer_*` and
 *   Code Atlas's own `mcp__atlas-computer__computer_*` (an `app`/`apps` argument,
 *   else the app an earlier call of the turn named).
 * - Codex MCP computer-use surfaces (the app the server recorded as the tool icon).
 * - Desktop drivers run through the shell: `open -a`, AppleScript `tell application`,
 *   Peekaboo / Cua Driver `--app`, an app bundle's own binary.
 * - A long command that launches an app it names (`python3 run_azahar.py`): only
 *   the command is known here, so the desktop shell finds the app it launched.
 */
import { DateTime } from "effect";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

export interface AgentDesktopTarget {
  /** The tool call's timeline id; a newer call restarts the idle timer. */
  readonly key: string;
  /** App names, bundle identifiers or `.app` paths, best first. */
  readonly apps: readonly string[];
  /** A running command that launches an unnamed app, for the desktop to match. */
  readonly hint: string | null;
  /** The app's display name, when the call names it. */
  readonly label: string | null;
  /** "Claude Code", "Codex". */
  readonly agent: string;
  readonly threadId: string | null;
  /** The call still runs; once it ends, the desktop's idle timer counts from `actionAt`. */
  readonly running: boolean;
  readonly startedAt: string;
  readonly actionAt: string;
}

/** How long a finished call keeps its app marked (the desktop shell's timeout too). */
export const AGENT_DESKTOP_IDLE_MS = 30_000;
/** A command only hints at an app once it has run this long (`ls` never does). */
export const AGENT_DESKTOP_HINT_DELAY_MS = 3_000;

const MAX_APPS = 8;
const MAX_HINT_LENGTH = 4_096;
const MAX_SCAN = 400;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanApp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/u, "");
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null;
}

function unique(apps: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const app of apps) {
    if (app === null || seen.has(app.toLowerCase())) continue;
    seen.add(app.toLowerCase());
    result.push(app);
  }
  return result.slice(0, MAX_APPS);
}

/** "Azahar" for `/…/Azahar.app/Contents/MacOS/azahar`; null for a bundle identifier. */
export function desktopAppLabel(app: string): string | null {
  const bundle = /([^/]+)\.app(?:\/|$)/iu.exec(app);
  if (bundle) return bundle[1]!;
  if (app.includes("/")) return app.split("/").at(-1) || null;
  if (/^[\w-]+(\.[\w-]+){2,}$/u.test(app)) return null;
  return app;
}

/** `/…/Azahar.app/Contents/MacOS/azahar` → `/…/Azahar.app`, then "Azahar" for another copy. */
function expandApp(app: string): string[] {
  const bundle = /^(.*?\.app)(?:\/|$)/iu.exec(app);
  if (bundle?.[1]?.includes("/")) {
    const label = desktopAppLabel(bundle[1]);
    return label === null ? [bundle[1]] : [bundle[1], label];
  }
  return [app];
}

const STRING_ARGUMENT = String.raw`\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\x60([^\x60$]*)\x60)`;
const GET_APP = new RegExp(
  String.raw`(?:\b([A-Za-z_$][\w$]*)\s*=\s*)?(?:await\s+)?\b(?:cua|sky)\s*\.\s*getApp\s*${STRING_ARGUMENT}`,
  "gu",
);
const METHOD_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/gu;

/** The variables a REPL call bound to apps. */
export function cuaBindings(code: string): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const match of code.matchAll(GET_APP)) {
    const app = cleanApp((match[2] ?? match[3] ?? match[4] ?? "").replace(/\\(.)/gu, "$1"));
    if (match[1] && app !== null) bindings.set(match[1], app);
  }
  return bindings;
}

/**
 * The app a computer-use REPL call drives last: a `cua.getApp(…)` or a method
 * call on a variable bound to one (here, or through `lookup` for earlier calls).
 */
export function cuaCodeApp(
  code: string,
  lookup: (variable: string) => string | null = () => null,
): string | null {
  let latest: { readonly index: number; readonly app: string } | null = null;
  const bindings = cuaBindings(code);
  for (const match of code.matchAll(GET_APP)) {
    const app = cleanApp((match[2] ?? match[3] ?? match[4] ?? "").replace(/\\(.)/gu, "$1"));
    if (app !== null) latest = { index: match.index, app };
  }
  for (const match of code.matchAll(METHOD_CALL)) {
    const variable = match[1]!;
    if (variable === "cua" || variable === "sky" || variable === "nodeRepl") continue;
    if (latest !== null && match.index <= latest.index) continue;
    const app = bindings.get(variable) ?? lookup(variable);
    if (app !== null && app !== undefined) latest = { index: match.index, app };
  }
  return latest?.app ?? null;
}

const COMPUTER_USE_TOOL =
  /^(?:mcp__computer-use__|mcp__remote-devices__computer_|mcp__atlas-computer__computer_|computer-use\.)/u;

export function isComputerUseToolName(toolName: string | null | undefined): boolean {
  return typeof toolName === "string" && COMPUTER_USE_TOOL.test(toolName);
}

/** The apps a computer-use call's arguments name. */
export function computerUseInputApps(input: unknown): string[] {
  const record = asRecord(input);
  if (record === undefined) return [];
  const named = [
    record.app,
    record.appName,
    record.application,
    record.bundleId,
    record.bundle_id,
    record.bundleIdentifier,
  ].map(cleanApp);
  const listed = Array.isArray(record.apps)
    ? record.apps.map((app) => {
        const entry = asRecord(app);
        return cleanApp(
          entry === undefined
            ? app
            : (entry.bundleId ?? entry.bundle_id ?? entry.name ?? entry.displayName),
        );
      })
    : [];
  return unique([...named, ...listed]);
}

const QUOTED_OR_WORD = String.raw`(?:\\?"([^"\\]+)\\?"|'([^']+)'|([^\s"';|&)]+))`;
// Drivers that name the app outrank an app's own binary, which outranks any
// path ending in `.app` (a 3DS title's content file is `e5ef7391.app` too).
const SHELL_APP_PATTERNS: readonly (readonly [RegExp, number])[] = [
  // open -a "App" / open -b bundle.id (other flags may come first)
  [new RegExp(String.raw`\bopen\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*[ab]\s+${QUOTED_OR_WORD}`, "gu"), 0],
  // open /Applications/App.app (the bundle itself)
  [
    /\bopen\s+(?:-[A-Za-z]+\s+)*(?:\\?"([^"\\\n]+\.app)\\?"|'([^'\n]+\.app)'|([^\s"';|&]+\.app))(?=[/\s"';|&)]|$)/gu,
    0,
  ],
  // AppleScript: tell application "App" / application id "bundle.id"
  [/\b(?:tell\s+)?app(?:lication)?\s+(?:id\s+)?\\?"([^"\\]+)\\?"/gu, 0],
  // System Events: process "App" / first process whose name is "App"
  [/\bprocess(?:es)?\s+(?:whose\s+name\s+is\s+)?\\?"([^"\\]+)\\?"/gu, 0],
  // Peekaboo, Cua Driver and similar drivers
  [
    new RegExp(
      String.raw`(?:peekaboo|cua-driver)\b[^\n|;&]*?--(?:app|app-name|application|bundle-id|bundle)[=\s]+${QUOTED_OR_WORD}`,
      "gu",
    ),
    0,
  ],
  // An app run through its own binary: a quoted path, then a bare one.
  [/["']([/~.$][^"'\n]*?\.app)\/Contents\/MacOS\//gu, 1],
  [/(?:^|[\s=])([^\s"';|&]*\.app)\/Contents\/MacOS\//gu, 1],
  // Any other app bundle path, opened or passed along (`Mail.app` alone is just a word).
  [/["']([/~.$][^"'\n]*?[^"'\n/\s]\.app)(?=[/"'])/gu, 2],
  [/(?:^|[\s=])([^\s"';|&]*\/[^\s"';|&/]+\.app)(?=[/\s"';|&)]|$)/gu, 2],
];

const NOT_DRIVEN = new Set(["system events", "code atlas"]);

/** The apps a shell command names explicitly. */
export function shellCommandApps(command: string): string[] {
  return rankedShellCommandApps(command).apps;
}

/** `launches`: a driver or the app's binary names it, not just a path (`codesign X.app`). */
function rankedShellCommandApps(command: string): { apps: string[]; launches: boolean } {
  const found: { readonly index: number; readonly rank: number; readonly app: string }[] = [];
  for (const [pattern, rank] of SHELL_APP_PATTERNS) {
    for (const match of command.matchAll(pattern)) {
      const app = cleanApp(match.slice(1).find((group) => group !== undefined));
      // Domains and addresses end in `.app` too.
      if (app === null || app.includes("://") || app.includes("@")) continue;
      const label = desktopAppLabel(app)?.toLowerCase() ?? null;
      if (label !== null && NOT_DRIVEN.has(label)) continue;
      found.push({ index: match.index, rank, app });
    }
  }
  // A quoted path with spaces also matches bare from its last space on: keep the full path.
  const whole = found.filter(
    (hit) =>
      !found.some((other) => other.app.length > hit.app.length && other.app.endsWith(hit.app)),
  );
  // The last named app is the one the command ends up driving.
  const ranked = whole.toSorted(
    (left, right) => left.rank - right.rank || right.index - left.index,
  );
  return { apps: unique(ranked.map((hit) => hit.app)), launches: (ranked[0]?.rank ?? 2) < 2 };
}

function payload(entry: WorkLogEntry) {
  return entry.structuredPayload;
}

function toolName(entry: WorkLogEntry): string | null {
  const item = payload(entry);
  return item?.type === "dynamic_tool" ? item.toolName : null;
}

function toolInput(entry: WorkLogEntry): unknown {
  const item = payload(entry);
  if (item?.type === "dynamic_tool") return item.input;
  return asRecord(entry.toolData)?.input;
}

function replCode(entry: WorkLogEntry): string | null {
  if (entry.toolSurface !== "computer") return null;
  const name = toolName(entry);
  if (name !== null && name !== "cua_repl.js" && name !== "js" && name !== "node_repl.js") {
    return null;
  }
  const code = asRecord(toolInput(entry))?.code;
  return typeof code === "string" ? code : null;
}

function shellCommand(entry: WorkLogEntry): string | null {
  const item = payload(entry);
  if (item !== undefined && item.type !== "command_execution") return null;
  const command = entry.rawCommand ?? entry.command;
  return command?.trim() ? command : null;
}

function iconApp(entry: WorkLogEntry): string | null {
  const icon = entry.toolIcon ?? entry.toolSource?.icon;
  if (icon?._tag !== "native-app") return null;
  return icon.app._tag === "app-id" ? icon.app.appId : icon.app.displayName;
}

const AGENT_NAMES: Readonly<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

function agentName(entry: WorkLogEntry): string {
  const driver = payload(entry)?.nativeItemRef?.driver;
  if (driver === undefined) return "An agent";
  return AGENT_NAMES[driver] ?? driver.replace(/^\w/u, (char) => char.toUpperCase());
}

function epochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  try {
    return DateTime.toEpochMillis(value as DateTime.DateTime);
  } catch {
    return null;
  }
}

function timing(entry: WorkLogEntry) {
  const item = payload(entry);
  const startedMs = epochMs(item?.startedAt) ?? Date.parse(entry.createdAt);
  const actionMs = epochMs(item?.completedAt) ?? epochMs(item?.updatedAt) ?? startedMs;
  const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : entry.createdAt);
  return { startedAt: iso(startedMs), actionAt: iso(actionMs) };
}

function isRunning(entry: WorkLogEntry): boolean {
  return entry.toolLifecycleStatus === "inProgress";
}

/** The app a computer-use call names, if any (REPL bindings via `lookup`). */
function computerUseApps(entry: WorkLogEntry, lookup: (variable: string) => string | null) {
  const code = replCode(entry);
  if (code !== null) {
    const app = cuaCodeApp(code, lookup);
    return app === null ? [] : [app];
  }
  if (entry.toolSurface !== "computer" && !isComputerUseToolName(toolName(entry))) return null;
  const sourceName =
    entry.toolSource?.kind === "computer" && entry.toolSource.key !== "computer-use"
      ? entry.toolSource.name
      : null;
  return unique([...computerUseInputApps(toolInput(entry)), iconApp(entry), sourceName]);
}

function isComputerUse(entry: WorkLogEntry): boolean {
  return entry.toolSurface === "computer" || isComputerUseToolName(toolName(entry));
}

/** Looks back through every REPL call for the app a variable was bound to. */
function replLookup(entries: readonly TimelineEntry[], before: number) {
  return (variable: string): string | null => {
    for (let index = before - 1; index >= 0; index--) {
      const entry = entries[index]!;
      if (entry.kind !== "work") continue;
      const code = replCode(entry.entry);
      const app = code === null ? undefined : cuaBindings(code).get(variable);
      if (app !== undefined) return app;
    }
    return null;
  };
}

function target(
  entry: WorkLogEntry,
  apps: readonly string[],
  hint: string | null,
): AgentDesktopTarget {
  const item = payload(entry);
  return {
    key: entry.id,
    apps: unique(apps.flatMap(expandApp)),
    hint: hint === null ? null : hint.slice(0, MAX_HINT_LENGTH),
    label: apps[0] === undefined ? null : desktopAppLabel(apps[0]),
    agent: agentName(entry),
    threadId: item?.threadId ?? null,
    running: isRunning(entry),
    ...timing(entry),
  };
}

type DesktopCall =
  | { readonly index: number; readonly apps: readonly string[] }
  | { readonly index: number; readonly hint: string };

/** The newest call at or before `from` that drives an app, or hints at one. */
function newestDesktopCall(
  entries: readonly TimelineEntry[],
  start: number,
  from: number,
  explicitOnly: boolean,
): DesktopCall | null {
  // A long turn's old calls are long past the idle timeout.
  for (let index = from; index >= Math.max(start, entries.length - MAX_SCAN); index--) {
    const timelineEntry = entries[index]!;
    if (timelineEntry.kind !== "work") continue;
    const entry = timelineEntry.entry;
    const apps = computerUseApps(entry, replLookup(entries, index));
    if (apps !== null) {
      if (apps.length > 0) return { index, apps };
      // A call that names no app drives the one an earlier call of the turn named.
      const earlier = earlierComputerUseApps(entries, start, index);
      if (earlier.length > 0) return { index, apps: earlier };
      continue;
    }
    const command = shellCommand(entry);
    if (command === null) continue;
    const named = rankedShellCommandApps(command);
    // A command that only passes an app's path along counts while it runs.
    if (named.apps.length > 0 && (named.launches || isRunning(entry))) {
      return { index, apps: named.apps };
    }
    // Only a command that still runs can be the one hosting an app it launched.
    if (!explicitOnly && isRunning(entry)) return { index, hint: command.toLowerCase() };
  }
  return null;
}

function workEntry(entries: readonly TimelineEntry[], index: number): WorkLogEntry {
  return (entries[index] as Extract<TimelineEntry, { kind: "work" }>).entry;
}

/**
 * The app the current turn drives through its newest desktop call, or null.
 * Only the turn since the user's last message counts.
 */
export function agentDesktopTarget(entries: readonly TimelineEntry[]): AgentDesktopTarget | null {
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.kind === "message" && entry.message.role === "user") {
      start = index + 1;
      break;
    }
  }
  const newest = newestDesktopCall(entries, start, entries.length - 1, false);
  if (newest === null) return null;
  const entry = workEntry(entries, newest.index);
  if ("apps" in newest) return target(entry, newest.apps, null);
  // A command run right after driving an app (`sleep 20; screencapture …`, a test
  // script against the emulator it opened) keeps that app marked while it runs.
  const earlier = newestDesktopCall(entries, start, newest.index - 1, true);
  if (earlier !== null && "apps" in earlier) {
    const startedMs = Date.parse(timing(entry).startedAt);
    const earlierMs = Date.parse(timing(workEntry(entries, earlier.index)).actionAt);
    if (startedMs - earlierMs <= AGENT_DESKTOP_IDLE_MS) {
      return target(entry, earlier.apps, newest.hint);
    }
  }
  return target(entry, [], newest.hint);
}

function earlierComputerUseApps(
  entries: readonly TimelineEntry[],
  start: number,
  before: number,
): readonly string[] {
  for (let index = before - 1; index >= start; index--) {
    const entry = entries[index]!;
    if (entry.kind !== "work" || !isComputerUse(entry.entry)) continue;
    const apps = computerUseApps(entry.entry, replLookup(entries, index));
    if (apps !== null && apps.length > 0) return apps;
  }
  return [];
}

/** The desktop shell's names for the apps it found, by tool call (bounded). */
const resolvedApps = new Map<string, string>();

export function rememberResolvedDesktopApp(key: string, app: string): void {
  resolvedApps.delete(key);
  resolvedApps.set(key, app);
  while (resolvedApps.size > 32) resolvedApps.delete(resolvedApps.keys().next().value!);
}

/** "Using Azahar" while a call that drives an app runs. */
export function desktopActivityLabel(entries: readonly TimelineEntry[]): string | null {
  const latest = entries.at(-1);
  if (latest?.kind !== "work" || !isRunning(latest.entry)) return null;
  const app = resolvedApps.get(latest.entry.id);
  if (app !== undefined) return `Using ${app}`;
  const current = agentDesktopTarget(entries);
  if (current === null || current.key !== latest.entry.id || current.label === null) return null;
  return `Using ${current.label}`;
}
