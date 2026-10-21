import { useDndContext } from "@dnd-kit/core";
import { useLayoutEffect, useRef } from "react";

import { resolveAtlasDropSlot, type AtlasRowBox } from "./atlasSorting";

/**
 * The slot a dragged row will land in, outlined while the other rows of its
 * list shift around it. It sits in the list (positioned) beside the rows whose
 * sortable ids are `ids`. Only this marker reads the drag context, so a new
 * target re-renders it alone, not the sidebar.
 */
export function AtlasDropSlot(props: {
  readonly ids: readonly string[];
  readonly enabled: boolean;
}) {
  const { ids, enabled } = props;
  const { active, over } = useDndContext();
  const activeIndex = active === null ? -1 : ids.indexOf(String(active.id));
  const overIndex = over === null ? -1 : ids.indexOf(String(over.id));
  const showing = enabled && activeIndex !== -1 && overIndex !== -1;
  const slotRef = useRef<HTMLLIElement>(null);

  // The slot is placed against the rows' laid-out boxes, so it is written to
  // the DOM after layout rather than kept in state.
  useLayoutEffect(() => {
    const node = slotRef.current;
    const list = node?.parentElement;
    if (!node || !list) return;
    const slot = showing ? measureSlot(list, ids, activeIndex, overIndex) : null;
    if (slot === null) {
      node.style.display = "none";
      return;
    }
    node.style.height = `${slot.height}px`;
    node.style.transform = `translateY(${slot.top}px)`;
    node.style.display = "";
  }, [showing, ids, activeIndex, overIndex]);

  return (
    <li
      ref={slotRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 list-none rounded-md border border-dashed border-primary/45 bg-primary/5 transition-transform duration-250 ease-out motion-reduce:transition-none"
    />
  );
}

function measureSlot(
  list: HTMLElement,
  ids: readonly string[],
  activeIndex: number,
  overIndex: number,
): AtlasRowBox | null {
  // offsetTop ignores the transforms dnd-kit applies: these are resting boxes.
  const rows: AtlasRowBox[] = [];
  for (const id of ids) {
    const escaped = CSS.escape(id);
    const row = list.querySelector<HTMLElement>(
      `:scope > [data-thread-item="${escaped}"], :scope > [data-atlas-sortable="${escaped}"]`,
    );
    if (row === null) return null;
    rows.push({ top: row.offsetTop, height: row.offsetHeight });
  }
  return resolveAtlasDropSlot(rows, activeIndex, overIndex);
}
