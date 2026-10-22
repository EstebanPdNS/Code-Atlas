import { cn } from "~/lib/utils";

import { atlasProvider } from "./providerColors";

/**
 * Three Code Atlas dots that pulse while agents run (compositor-only). With a
 * label they announce the activity; without one they decorate a labelled row.
 * With a provider they take its colors: Claude's orange, Codex's blue to violet.
 */
export function AtlasActivityDots(props: {
  readonly className?: string;
  readonly label?: string;
  readonly provider?: string | null;
}) {
  return (
    <span
      {...(props.label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": props.label })}
      data-atlas-activity
      data-atlas-provider={
        props.provider ? (atlasProvider(props.provider) ?? undefined) : undefined
      }
      className={cn("inline-grid grid-cols-2 gap-0.5", props.className)}
    >
      <span className="size-1 rounded-full bg-primary" />
      <span className="size-1 rounded-full bg-primary" />
      <span className="col-span-2 mx-auto size-1 rounded-full bg-primary" />
    </span>
  );
}
