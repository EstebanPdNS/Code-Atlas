import { useDndContext } from "@dnd-kit/core";
import { useLayoutEffect, useRef } from "react";

import { resolvePinnedDropSlot, type PinnedRowBox } from "./pinnedReorder";

/**
 * The slot a dragged pinned thread will land in, outlined while the other
 * pinned rows shift around it. Only this marker reads the drag context, so a
 * new target re-renders it alone, not the sidebar.
 */
export function PinnedDropSlot(props: {
  readonly pinnedKeys: readonly string[];
  readonly enabled: boolean;
}) {
  const { pinnedKeys, enabled } = props;
  const { active, over } = useDndContext();
  const activeIndex = active === null ? -1 : pinnedKeys.indexOf(String(active.id));
  const overIndex = over === null ? -1 : pinnedKeys.indexOf(String(over.id));
  const showing = enabled && activeIndex !== -1 && overIndex !== -1;
  const slotRef = useRef<HTMLLIElement>(null);

  // The slot is placed against the rows' laid-out boxes, so it is written to
  // the DOM after layout rather than kept in state.
  useLayoutEffect(() => {
    const node = slotRef.current;
    const list = node?.parentElement;
    if (!node || !list) return;
    const slot = showing ? measurePinnedSlot(list, pinnedKeys, activeIndex, overIndex) : null;
    if (slot === null) {
      node.style.display = "none";
      return;
    }
    node.style.height = `${slot.height}px`;
    node.style.transform = `translateY(${slot.top}px)`;
    node.style.display = "";
  }, [showing, pinnedKeys, activeIndex, overIndex]);

  return (
    <li
      ref={slotRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 list-none rounded-md border border-dashed border-primary/45 bg-primary/5 transition-transform duration-250 ease-out motion-reduce:transition-none"
    />
  );
}

function measurePinnedSlot(
  list: HTMLElement,
  pinnedKeys: readonly string[],
  activeIndex: number,
  overIndex: number,
): PinnedRowBox | null {
  // offsetTop ignores the transforms dnd-kit applies: these are resting boxes.
  const rows: PinnedRowBox[] = [];
  for (const key of pinnedKeys) {
    const row = list.querySelector<HTMLElement>(`[data-thread-item="${CSS.escape(key)}"]`);
    if (row === null) return null;
    rows.push({ top: row.offsetTop, height: row.offsetHeight });
  }
  return resolvePinnedDropSlot(rows, activeIndex, overIndex);
}
