import type { ClientRect } from "@dnd-kit/core";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarListItem } from "~/components/Sidebar.logic";

import { createAtlasPinnedSortingStrategy, resolvePinnedDropSlot } from "./pinnedReorder";

const items: SidebarListItem[] = [
  { kind: "marker", marker: "pinned-header" },
  { kind: "thread", key: "a", section: "pinned" },
  { kind: "thread", key: "b", section: "pinned" },
  { kind: "thread", key: "c", section: "pinned" },
  { kind: "marker", marker: "pinned-divider" },
  { kind: "thread", key: "d", section: "active" },
];

// Rows 36px tall with a 1px gap; markers are not rendered in Code Atlas.
const rect = (top: number): ClientRect => ({
  top,
  bottom: top + 36,
  left: 0,
  right: 200,
  width: 200,
  height: 36,
});
const rects = [undefined, rect(0), rect(37), rect(74), undefined, rect(200)] as ClientRect[];

describe("createAtlasPinnedSortingStrategy", () => {
  const layout = (index: number, activeIndex: number, overIndex: number) => ({
    rects,
    activeNodeRect: rects[activeIndex] ?? null,
    activeIndex,
    overIndex,
    index,
  });

  it("shifts the pinned rows between the dragged row and its target", () => {
    const strategy = createAtlasPinnedSortingStrategy(items, true);
    // Dragging "a" below "c": "b" and "c" move up one row.
    expect(strategy(layout(2, 1, 3))).toMatchObject({ y: -37 });
    expect(strategy(layout(3, 1, 3))).toMatchObject({ y: -37 });
    // Dragging "c" above "a": "a" and "b" move down one row.
    expect(strategy(layout(1, 3, 1))).toMatchObject({ y: 37 });
  });

  it("leaves rows outside Pinned, and drags over them, in place", () => {
    const strategy = createAtlasPinnedSortingStrategy(items, true);
    expect(strategy(layout(5, 1, 3))).toBeNull();
    expect(strategy(layout(2, 1, 5))).toBeNull();
  });

  it("does nothing while the row drags out as chat context", () => {
    expect(createAtlasPinnedSortingStrategy(items, false)(layout(2, 1, 3))).toBeNull();
  });
});

describe("resolvePinnedDropSlot", () => {
  const rows = [
    { top: 0, height: 36 },
    { top: 37, height: 36 },
    { top: 74, height: 36 },
  ];

  it("opens below the target when moving down", () => {
    expect(resolvePinnedDropSlot(rows, 0, 2)).toEqual({ top: 74, height: 36 });
    expect(resolvePinnedDropSlot(rows, 0, 1)).toEqual({ top: 37, height: 36 });
  });

  it("opens at the target when moving up, and in place before moving", () => {
    expect(resolvePinnedDropSlot(rows, 2, 0)).toEqual({ top: 0, height: 36 });
    expect(resolvePinnedDropSlot(rows, 1, 1)).toEqual({ top: 37, height: 36 });
  });

  it("has no slot for rows it cannot measure", () => {
    expect(resolvePinnedDropSlot(rows, 0, 5)).toBeNull();
  });
});
