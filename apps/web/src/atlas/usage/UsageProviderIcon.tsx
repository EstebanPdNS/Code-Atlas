import type { ComponentProps } from "react";

import { CodexMark } from "~/atlas/brand/CodexMark";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { cn } from "~/lib/utils";

/**
 * Code Atlas: the Usage page shows each agent's own app icon: Claude Code's
 * mark, and Codex's instead of the ChatGPT knot.
 */
export function UsageProviderIcon(props: ComponentProps<typeof ProviderInstanceIcon>) {
  if (props.driverKind !== "codex") return <ProviderInstanceIcon {...props} />;
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", props.className)}
    >
      <CodexMark
        aria-hidden
        className={cn(
          "size-5 shrink-0",
          props.size === "compact" && "size-3.5",
          // The knot's text color has no meaning for a colored tile.
          props.iconClassName?.replace(/\btext-\S+/g, ""),
        )}
      />
    </span>
  );
}
