const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked. As a delegated child task, do not watch or poll PRs; return PR URLs, head SHA, and pending review/check state to your parent. Otherwise, when asked to monitor, watch, or babysit a PR and watch_pull_request is available, call it and end your turn: Code Atlas wakes you when checks finish, someone else comments, or the branch conflicts, so do not poll or run your own watcher. When monitoring is done and you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox.
</pull_request_linking>`;

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Code Atlas through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Code Atlas "plan first": the agent keeps a visible task list for every
 * request that takes action, so the client can show each step as it happens.
 * Each list update is a model round trip, so the list is written in one go and
 * finishing a step starts the next in the same update. `tools` names the
 * harness's task-list tools and how to batch them (Claude Code: TaskCreate and
 * TaskUpdate; Codex: update_plan).
 */
export function buildPlanFirstInstructions(tools: string): string {
  return `<plan_first>The user follows your work through a visible task list, so keep one for every request that involves taking action, however small. Before doing anything else, write the whole list ${tools}: one item per concrete step, in the order you will do them, so the user can check you understood the request. Then work through it step by step: keep exactly one item in progress, and when you finish an item, mark it completed and mark the next one in progress in the same update. Update the list when the plan changes and keep it current until every item is completed. A request with a single action still gets a one-item list. A question you can answer without taking any action needs no list.</plan_first>`;
}
