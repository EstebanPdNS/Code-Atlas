import type { EnvironmentId, SourceControlDiscoveryResult } from "@t3tools/contracts";
import { providersWithLimits } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";

import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";

import { atlasProviderLabel, useAtlasAgentProviders } from "../brand/agentProviders";
import type { AtlasGitHubAccount, AtlasTerminalMeta } from "./atlasIntro";

/** The GitHub logins source-control discovery reports, with their sign-in state. */
export function toAtlasGitHubAccounts(
  discovery: SourceControlDiscoveryResult | null | undefined,
): readonly AtlasGitHubAccount[] {
  const auth = discovery?.sourceControlProviders.find((item) => item.kind === "github")?.auth;
  if (auth === undefined) return [];
  const byAccount = new Map<string, AtlasGitHubAccount>();
  for (const entry of auth.accounts ?? []) {
    const key = entry.account.toLowerCase();
    const connected = entry.authenticated || byAccount.get(key)?.connected === true;
    byAccount.set(key, { account: entry.account, connected });
  }
  // Older discovery results report only the active login.
  if (byAccount.size === 0 && auth.status === "authenticated" && Option.isSome(auth.account)) {
    byAccount.set(auth.account.value.toLowerCase(), {
      account: auth.account.value,
      connected: true,
    });
  }
  return [...byAccount.values()];
}

/**
 * Everything the terminal shows below the logo: installed agents and each
 * one's weekly usage (session lives in the Usage card), lines committed in the
 * project this week, and the GitHub accounts' sign-in state.
 */
export function useAtlasTerminalSummary(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): Omit<AtlasTerminalMeta, "projectName"> {
  // One discovery call answers both the GitHub sign-in state and this week's commits.
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: cwd === null ? {} : { activityCwd: cwd },
        }),
  );
  const providers = useAtlasAgentProviders(environmentId);
  const agents = [...new Set(providers.map(atlasProviderLabel))];
  const usage = providersWithLimits(providers).map((provider) => {
    const windows = provider.usageLimits?.windows ?? [];
    const weekly = windows.find((window) => window.kind === "weekly") ?? windows[0];
    return { label: atlasProviderLabel(provider), percent: weekly?.usedPercent ?? null };
  });
  return {
    agents,
    usage,
    week: discovery.data?.weeklyActivity ?? null,
    github: toAtlasGitHubAccounts(discovery.data),
  };
}
