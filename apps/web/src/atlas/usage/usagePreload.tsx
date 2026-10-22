import { useAtomValue } from "@effect/atom-react";
import type { UsageSummaryInput } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";

import { WINDOW_OPTIONS } from "~/components/usage/usageShortcuts";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { usageWindowAtom } from "~/state/usage";

export type UsagePeriodDays = (typeof WINDOW_OPTIONS)[number]["days"];
export type UsagePeriodWindows = Readonly<Record<UsagePeriodDays, UsageSummaryInput>>;

/** Code Atlas: every period's window, made once so its preloaded usage is the one shown. */
export function makePeriodWindows(): UsagePeriodWindows {
  return {
    1: makeWindow(1, undefined, "hour"),
    7: makeWindow(7),
    30: makeWindow(30),
    90: makeWindow(90),
  };
}

/** Every project's activity with its agents over the last `days` days. */
export function useCodeActivity(days: UsagePeriodDays) {
  const environmentId = usePrimaryEnvironmentId();
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: { activityAll: true, activityDays: days },
        }),
  );
}

function PeriodPreload({
  days,
  window,
}: {
  readonly days: UsagePeriodDays;
  readonly window: UsageSummaryInput;
}) {
  useAtomValue(usageWindowAtom(window));
  useCodeActivity(days);
  return null;
}

/**
 * Code Atlas: loads every period's usage and code activity as the Usage page
 * opens and keeps them loaded, so the first switch to a period shows it at
 * once instead of flashing while it loads.
 */
export function UsagePeriodPreload({ windows }: { readonly windows: UsagePeriodWindows }) {
  return WINDOW_OPTIONS.map((option) => (
    <PeriodPreload key={option.days} days={option.days} window={windows[option.days]} />
  ));
}
