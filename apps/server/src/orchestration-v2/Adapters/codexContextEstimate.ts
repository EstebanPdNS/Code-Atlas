/**
 * Code Atlas: an estimated context breakdown for Codex, which reports only
 * token totals. Text counts as four bytes per token, the rule of thumb Codex
 * itself uses for its own size checks.
 */
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import type {
  OrchestrationV2ContextCategory,
  OrchestrationV2ContextMemoryFile,
  OrchestrationV2ContextSkill,
} from "@t3tools/contracts";

/** Codex stops reading project AGENTS.md files past this many bytes (`project_doc_max_bytes`). */
const CODEX_PROJECT_DOC_MAX_BYTES = 32 * 1024;
/** The context card lists at most this many skills. */
const CODEX_CONTEXT_SKILLS_LIMIT = 40;

export function estimateTextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

const bytesToTokens = (bytes: number) => Math.ceil(Math.max(0, bytes) / 4);

// Code Atlas ships on macOS only, so plain POSIX paths keep this free of services.
const joinPath = (directory: string, name: string) =>
  `${directory.endsWith("/") ? directory : `${directory}/`}${name}`;
const parentPath = (path: string) => {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
};

/** What Code Atlas knows went into a Codex thread's context besides the conversation. */
export interface CodexContextParts {
  /** Developer instructions and additionalContext entries Code Atlas sends. */
  readonly instructionsTokens: number;
  readonly memoryFiles: ReadonlyArray<OrchestrationV2ContextMemoryFile>;
  /** Omitted when Codex's skills list could not be read. */
  readonly skills?: ReadonlyArray<OrchestrationV2ContextSkill>;
}

const sumTokens = (rows: ReadonlyArray<{ readonly tokens: number }> | undefined) =>
  (rows ?? []).reduce((total, row) => total + row.tokens, 0);

function partsTokens(parts: CodexContextParts): number {
  return parts.instructionsTokens + sumTokens(parts.memoryFiles) + sumTokens(parts.skills);
}

/**
 * Codex's own system prompt and tool schemas: what a new thread's first
 * request carried beyond the first user message and the parts Code Atlas knows.
 */
export function codexBaselineTokens(input: {
  readonly firstInputTokens: number;
  readonly firstUserMessageTokens: number;
  readonly parts: CodexContextParts;
}): number {
  return Math.max(
    0,
    Math.round(input.firstInputTokens - input.firstUserMessageTokens - partsTokens(input.parts)),
  );
}

/** The estimated rows, in the order Claude's /context lists its own. */
export function codexContextBreakdown(input: {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly baselineTokens: number;
  readonly parts: CodexContextParts;
}): {
  readonly contextCategories: ReadonlyArray<OrchestrationV2ContextCategory>;
  readonly contextMemoryFiles?: ReadonlyArray<OrchestrationV2ContextMemoryFile>;
  readonly contextSkills?: ReadonlyArray<OrchestrationV2ContextSkill>;
  readonly contextEstimated: true;
} {
  const { parts } = input;
  const memoryTokens = sumTokens(parts.memoryFiles);
  const skillsTokens = sumTokens(parts.skills);
  const messages = Math.max(
    0,
    Math.round(input.usedTokens - input.baselineTokens - partsTokens(parts)),
  );
  const categories: OrchestrationV2ContextCategory[] = [
    { name: "Messages", tokens: messages, kind: "used" },
    { name: "System prompt & tools", tokens: input.baselineTokens, kind: "used" },
    { name: "Code Atlas instructions", tokens: parts.instructionsTokens, kind: "used" },
    ...(parts.skills === undefined
      ? []
      : [{ name: "Skills", tokens: skillsTokens, kind: "used" } as const]),
    { name: "Memory files", tokens: memoryTokens, kind: "used" },
    ...(input.maxTokens === null || input.maxTokens <= 0
      ? []
      : [
          {
            name: "Free space",
            tokens: Math.max(0, Math.round(input.maxTokens - input.usedTokens)),
            kind: "free",
          } as const,
        ]),
  ];
  return {
    contextCategories: categories,
    ...(parts.memoryFiles.length > 0 ? { contextMemoryFiles: parts.memoryFiles } : {}),
    ...(parts.skills !== undefined && parts.skills.length > 0
      ? { contextSkills: parts.skills.slice(0, CODEX_CONTEXT_SKILLS_LIMIT) }
      : {}),
    contextEstimated: true,
  };
}

/** The text of a turn's input, or undefined when it carries images, files or skills. */
export function codexTextInputTokens(
  input: ReadonlyArray<{ readonly type: string; readonly text?: string }>,
): number | undefined {
  let tokens = 0;
  for (const item of input) {
    if (item.type !== "text" || item.text === undefined) return undefined;
    tokens += estimateTextTokens(item.text);
  }
  return tokens;
}

/** Developer instructions plus additionalContext entries, as Codex renders them. */
export function codexInstructionsTokens(input: {
  readonly developerInstructions?: string | null | undefined;
  readonly additionalContext?:
    | Readonly<Record<string, { readonly kind: string; readonly value: string }>>
    | undefined;
}): number {
  const rendered = Object.entries(input.additionalContext ?? {}).map(([key, entry]) =>
    entry.kind === "untrusted"
      ? `<external_${key}>${entry.value}</external_${key}>`
      : `<${key}>${entry.value}</${key}>`,
  );
  return estimateTextTokens([input.developerInstructions ?? "", ...rendered].join(""));
}

/** Enabled skills as Codex lists them to the model: name, description and file. */
export function codexContextSkills(
  skills: ReadonlyArray<{
    readonly name: string;
    readonly description?: string | undefined;
    readonly path: string;
    readonly enabled: boolean;
  }>,
): ReadonlyArray<OrchestrationV2ContextSkill> {
  return skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      name: skill.name,
      tokens: estimateTextTokens(
        `- ${skill.name}: ${skill.description ?? ""} (file: ${skill.path})\n`,
      ),
    }));
}

/** A directory's AGENTS.override.md, else its AGENTS.md, when not empty. */
const firstCodexAgentsDoc = Effect.fn("CodexAdapterV2.firstCodexAgentsDoc")(function* (
  fileSystem: FileSystem.FileSystem,
  directory: string,
) {
  for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
    const path = joinPath(directory, name);
    const bytes = yield* fileSystem.stat(path).pipe(
      Effect.map((info) => (info.type === "File" ? Number(info.size) : 0)),
      Effect.orElseSucceed(() => 0),
    );
    if (bytes > 0) return { path, bytes };
  }
  return undefined;
});

/**
 * The AGENTS.md files Codex loads, in its order: the global one in CODEX_HOME,
 * then one per directory from the project root (the nearest `.git`) down to
 * cwd. In each place AGENTS.override.md wins over AGENTS.md. Project files
 * share Codex's byte budget.
 */
export const discoverCodexMemoryFiles = Effect.fn("CodexAdapterV2.discoverCodexMemoryFiles")(
  function* (
    fileSystem: FileSystem.FileSystem,
    input: { readonly cwd: string; readonly codexHome: string | undefined },
  ) {
    const firstDoc = (directory: string) => firstCodexAgentsDoc(fileSystem, directory);

    const files: OrchestrationV2ContextMemoryFile[] = [];
    if (input.codexHome !== undefined) {
      const global = yield* firstDoc(input.codexHome);
      if (global !== undefined)
        files.push({ path: global.path, tokens: bytesToTokens(global.bytes) });
    }

    const cwd =
      input.cwd.length > 1 && input.cwd.endsWith("/") ? input.cwd.slice(0, -1) : input.cwd;
    const chain = [cwd];
    let root: string | undefined;
    for (let directory = cwd; ; directory = parentPath(directory)) {
      const hasGit = yield* fileSystem
        .exists(joinPath(directory, ".git"))
        .pipe(Effect.orElseSucceed(() => false));
      if (hasGit) {
        root = directory;
        break;
      }
      if (parentPath(directory) === directory) break;
      chain.unshift(parentPath(directory));
    }
    let budget = CODEX_PROJECT_DOC_MAX_BYTES;
    for (const directory of root === undefined ? [cwd] : chain.slice(chain.indexOf(root))) {
      if (budget <= 0) break;
      const doc = yield* firstDoc(directory);
      if (doc === undefined) continue;
      const bytes = Math.min(doc.bytes, budget);
      budget -= bytes;
      files.push({ path: doc.path, tokens: bytesToTokens(bytes) });
    }
    return files;
  },
);

/** Per native thread: what the estimate has learned so far. */
export interface CodexContextEstimateState {
  /** A thread started in this session, whose first request has not been measured yet. */
  measureBaseline: boolean;
  firstUserMessageTokens?: number;
  firstInputTokens?: number;
  baselineTokens?: number;
  model?: string;
  parts?: CodexContextParts;
}

export function noteCodexTurnStart(
  state: CodexContextEstimateState,
  turn: { readonly model: string; readonly userMessageTokens: number | undefined },
): void {
  // Another model brings its own system prompt.
  if (state.model !== undefined && state.model !== turn.model) {
    delete state.baselineTokens;
    state.measureBaseline = false;
  }
  state.model = turn.model;
  if (state.measureBaseline && state.firstUserMessageTokens === undefined) {
    // Images and files have no byte estimate, so they would land in the baseline.
    if (turn.userMessageTokens === undefined) state.measureBaseline = false;
    else state.firstUserMessageTokens = turn.userMessageTokens;
  }
}

/**
 * Called on each usage report of a thread's root turns. The first report of a
 * new thread measures its baseline, which then also serves resumed threads of
 * the same model; the compaction summary is conversation, so the baseline
 * survives compactions.
 */
export function codexEstimatedBreakdown(
  state: CodexContextEstimateState,
  baselineByModel: Map<string, number>,
  usage: {
    readonly usedTokens: number;
    readonly maxTokens: number | null;
    readonly inputTokens: number;
  },
): ReturnType<typeof codexContextBreakdown> | undefined {
  if (
    state.measureBaseline &&
    state.firstUserMessageTokens !== undefined &&
    usage.inputTokens > 0
  ) {
    state.firstInputTokens = usage.inputTokens;
    state.measureBaseline = false;
  }
  const { parts } = state;
  if (parts === undefined) return undefined;
  if (
    state.baselineTokens === undefined &&
    state.firstInputTokens !== undefined &&
    state.firstUserMessageTokens !== undefined
  ) {
    state.baselineTokens = codexBaselineTokens({
      firstInputTokens: state.firstInputTokens,
      firstUserMessageTokens: state.firstUserMessageTokens,
      parts,
    });
    delete state.firstInputTokens;
    if (state.model !== undefined) baselineByModel.set(state.model, state.baselineTokens);
  }
  const baselineTokens =
    state.baselineTokens ??
    (state.model === undefined ? undefined : baselineByModel.get(state.model));
  if (baselineTokens === undefined) return undefined;
  return codexContextBreakdown({
    usedTokens: usage.usedTokens,
    maxTokens: usage.maxTokens,
    baselineTokens,
    parts,
  });
}

/** Identifies a breakdown, so a turn sends it only when it changes. */
export function codexBreakdownKey(breakdown: ReturnType<typeof codexContextBreakdown>): string {
  return [
    ...breakdown.contextCategories.map((row) => `${row.name}:${row.tokens}`),
    ...(breakdown.contextMemoryFiles ?? []).map((file) => `${file.path}:${file.tokens}`),
    ...(breakdown.contextSkills ?? []).map((skill) => `${skill.name}:${skill.tokens}`),
  ].join("\n");
}
