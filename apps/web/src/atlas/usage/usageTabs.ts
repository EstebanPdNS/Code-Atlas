import type { UsagePagePreferences } from "../../components/usage/usagePagePreferences";
import { METRIC_OPTIONS } from "../../components/usage/usageShortcuts";

/** Code Atlas: the Usage switcher offers Cost and Tokens; the limits live inside Tokens. */
export const USAGE_TABS = METRIC_OPTIONS.filter((option) => option.value !== "limits");

/** A saved or default Limits tab opens Tokens, the main view. */
export function withoutLimitsTab(preferences: UsagePagePreferences): UsagePagePreferences {
  return preferences.metric === "limits" ? { ...preferences, metric: "tokens" } : preferences;
}
