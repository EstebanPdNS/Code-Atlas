import { cn } from "~/lib/utils";

/**
 * Three Code Atlas dots that pulse while agents run (compositor-only). With a
 * label they announce the activity; without one they decorate a labelled row.
 */
export function AtlasActivityDots(props: { readonly className?: string; readonly label?: string }) {
  return (
    <span
      {...(props.label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": props.label })}
      data-atlas-activity
      className={cn("inline-grid grid-cols-2 gap-0.5", props.className)}
    >
      <span className="size-1 rounded-full bg-primary" />
      <span className="size-1 rounded-full bg-primary" />
      <span className="col-span-2 mx-auto size-1 rounded-full bg-primary" />
    </span>
  );
}
