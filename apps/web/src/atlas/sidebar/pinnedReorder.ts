/**
 * Reordering Pinned by drag. The upstream sorting strategy projects the whole
 * upstream list (section headers, dividers, placeholders), none of which the
 * Code Atlas layout renders, so it left every row in place. Pinned rows sit
 * together in the sortable list, so dnd-kit's own vertical strategy can shift
 * them, while rows outside Pinned stay put.
 */
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";

import type { SidebarListItem } from "~/components/Sidebar.logic";

export function createAtlasPinnedSortingStrategy(
  items: readonly SidebarListItem[],
  enabled: boolean,
): SortingStrategy {
  const pinned = items.map((item) => item.kind === "thread" && item.section === "pinned");
  return (args) =>
    enabled && pinned[args.activeIndex] && pinned[args.overIndex] && pinned[args.index]
      ? verticalListSortingStrategy(args)
      : null;
}

export interface PinnedRowBox {
  readonly top: number;
  readonly height: number;
}

/**
 * Where the dragged row lands among the pinned rows' resting boxes: the space
 * the shifted rows open for it, at the over row's top when moving up and
 * ending at its bottom when moving down.
 */
export function resolvePinnedDropSlot(
  rows: readonly PinnedRowBox[],
  activeIndex: number,
  overIndex: number,
): PinnedRowBox | null {
  const active = rows[activeIndex];
  const over = rows[overIndex];
  if (active === undefined || over === undefined) return null;
  return {
    top: overIndex > activeIndex ? over.top + over.height - active.height : over.top,
    height: active.height,
  };
}
