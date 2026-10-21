import { type ReactNode, useState } from "react";

/**
 * Content that opens and closes on grid rows ([data-atlas-fold] in atlas.css)
 * instead of appearing and vanishing. The children mount on the first open and
 * stay mounted, so closing folds them away rather than cutting them off; closed,
 * the fold takes no height and is inert. Spacing above the content belongs
 * inside it, or it would stay behind when the fold closes.
 */
export function AtlasFold(props: { readonly open: boolean; readonly children: ReactNode }) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  return (
    <div data-atlas-fold data-shown={props.open ? "" : undefined} inert={!props.open}>
      <div className="min-h-0 overflow-hidden">{opened ? props.children : null}</div>
    </div>
  );
}
