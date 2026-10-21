import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";

import { formatProviderDriverKindLabel } from "~/providerModels";
import { useEnvironmentProviders } from "~/state/environments";

const AGENT_DRIVERS = new Set(["claudeAgent", "codex"]);
const NO_PROVIDERS: readonly ServerProvider[] = [];

export function atlasProviderLabel(provider: ServerProvider): string {
  if (provider.driver === "claudeAgent") return "Claude Code";
  if (provider.driver === "codex") return "Codex";
  return provider.displayName ?? formatProviderDriverKindLabel(provider.driver);
}

/** The installed, enabled Claude Code and Codex providers of an environment. */
export function useAtlasAgentProviders(
  environmentId: EnvironmentId | null,
): readonly ServerProvider[] {
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    environmentId === null
      ? [...providersByEnvironment.values()][0]
      : providersByEnvironment.get(environmentId);
  // Claude Code first, then Codex, like the handbook's agent line.
  return (providers ?? NO_PROVIDERS)
    .filter(
      (provider) => provider.enabled && provider.installed && AGENT_DRIVERS.has(provider.driver),
    )
    .toSorted(
      (left, right) =>
        Number(right.driver === "claudeAgent") - Number(left.driver === "claudeAgent"),
    );
}
