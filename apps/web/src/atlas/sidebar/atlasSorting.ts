/**
 * Drag to reorder in the Code Atlas sidebar: Pinned, each project's threads,
 * each group's projects and the groups themselves all move the same way. The
 * rows of the dragged row's own list glide out of its way with dnd-kit's
 * vertical list strategy while a dashed slot (AtlasDropSlot) marks where it
 * lands; rows of every other list stay put.
 *
 * The upstream sorting strategy projects the whole upstream list (section
 * headers, dividers, placeholders), none of which the Code Atlas layout
 * renders, and the projects and groups used native drag and drop with its own
 * ghost and drop lines, which is why each list used to feel different.
 */
import {
  closestCenter,
  type ClientRect,
  type CollisionDetection,
  type DroppableContainer,
} from "@dnd-kit/core";
import { arrayMove, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";

import { sidebarListItemId, type SidebarListItem } from "~/components/Sidebar.logic";

type Layout = Parameters<SortingStrategy>[0];
type Transform = ReturnType<SortingStrategy>;

/**
 * The list each rendered thread row belongs to: "pinned", "attention",
 * "working", `project:<key>` for a project's threads and `hidden:<key>` for
 * its settled or snoozed ones.
 */
export type AtlasSortableLists = ReadonlyMap<string, string>;

/**
 * The lists as last rendered. The Code Atlas sections write it after layout
 * and the sorting strategy and collision detection read it during a drag; the
 * sidebar renders once, so one holder serves it.
 */
export const atlasSortableLists: { current: AtlasSortableLists } = { current: new Map() };

export function atlasProjectThreadsList(projectKey: string): string {
  return `project:${projectKey}`;
}

/**
 * dnd-kit's vertical list strategy over one list. The sortable items can
 * interleave rows of other lists (the upstream order mixes every project's
 * threads), so the list's rows are laid out on their own.
 */
export function sortWithinList(layout: Layout, members: readonly number[]): Transform {
  const activeIndex = members.indexOf(layout.activeIndex);
  const overIndex = members.indexOf(layout.overIndex);
  const index = members.indexOf(layout.index);
  if (activeIndex === -1 || overIndex === -1 || index === -1) return null;
  const rects: ClientRect[] = [];
  for (const [local, member] of members.entries()) {
    const rect = layout.rects[member];
    if (rect !== undefined) rects[local] = rect;
  }
  return verticalListSortingStrategy({
    rects,
    activeNodeRect: layout.activeNodeRect,
    activeIndex,
    overIndex,
    index,
  });
}

/** The sidebar's thread rows: only rows in the dragged row's own list move. */
export function createAtlasSortingStrategy(
  items: readonly SidebarListItem[],
  lists: { readonly current: AtlasSortableLists },
  enabled: boolean,
): SortingStrategy {
  const ids = items.map(sidebarListItemId);
  let membersFor: AtlasSortableLists | null = null;
  const members = new Map<string, number[]>();
  const membersOf = (list: string) => {
    if (membersFor !== lists.current) {
      membersFor = lists.current;
      members.clear();
    }
    let indices = members.get(list);
    if (indices === undefined) {
      indices = [];
      for (const [index, id] of ids.entries()) {
        if (lists.current.get(id) === list) indices.push(index);
      }
      members.set(list, indices);
    }
    return indices;
  };
  return (layout) => {
    if (!enabled) return null;
    const listOf = (index: number) => {
      const id = ids[index];
      return id === undefined ? undefined : lists.current.get(id);
    };
    const list = listOf(layout.index);
    if (list === undefined || listOf(layout.activeIndex) !== list) return null;
    if (listOf(layout.overIndex) !== list) return null;
    return sortWithinList(layout, membersOf(list));
  };
}

/**
 * A project's thread dropped on another project's, or on Needs attention or
 * Working, would only reshuffle the shared upstream order without moving on
 * screen, so those rows are not targets. Pinned and settled rows still are:
 * dropping there pins or settles the thread.
 */
export function isAtlasThreadDropTarget(
  sourceList: string | undefined,
  targetList: string | undefined,
): boolean {
  if (sourceList === undefined || targetList === undefined || targetList === sourceList) {
    return true;
  }
  if (!sourceList.startsWith("project:")) return true;
  return !(
    targetList.startsWith("project:") ||
    targetList === "attention" ||
    targetList === "working"
  );
}

export interface AtlasRowBox {
  readonly top: number;
  readonly height: number;
}

/**
 * Where the dragged row lands among its list's resting boxes: the space the
 * shifted rows open for it, at the over row's top when moving up and ending
 * at its bottom when moving down.
 */
export function resolveAtlasDropSlot(
  rows: readonly AtlasRowBox[],
  activeIndex: number,
  overIndex: number,
): AtlasRowBox | null {
  const active = rows[activeIndex];
  const over = rows[overIndex];
  if (active === undefined || over === undefined) return null;
  return {
    top: overIndex > activeIndex ? over.top + over.height - active.height : over.top,
    height: active.height,
  };
}

/** What a sortable project row, group or the Ungrouped list carries in its dnd-kit data. */
export type AtlasSortableData =
  | {
      readonly kind: "project";
      readonly projectKey: string;
      /** `null` for Ungrouped. */
      readonly folderId: string | null;
      /** The project keys of its list in order; empty where the order is not the user's. */
      readonly siblings: readonly string[];
    }
  | { readonly kind: "folder"; readonly folderId: string; readonly siblings: readonly string[] }
  | { readonly kind: "ungrouped" };

export const ATLAS_UNGROUPED_ID = "atlas-ungrouped";

export function atlasProjectSortableId(projectKey: string): string {
  return `atlas-project:${projectKey}`;
}

export function atlasFolderSortableId(folderId: string): string {
  return `atlas-folder:${folderId}`;
}

export function atlasSortableId(data: AtlasSortableData): string {
  return data.kind === "project"
    ? atlasProjectSortableId(data.projectKey)
    : data.kind === "folder"
      ? atlasFolderSortableId(data.folderId)
      : ATLAS_UNGROUPED_ID;
}

/** The sortable ids of a row's list, in order. */
export function atlasSiblingIds(
  data: Extract<AtlasSortableData, { siblings: readonly string[] }>,
): string[] {
  return data.siblings.map(
    data.kind === "project" ? atlasProjectSortableId : atlasFolderSortableId,
  );
}

export function readAtlasSortableData(data: unknown): AtlasSortableData | null {
  if (typeof data !== "object" || data === null || !("atlasSortable" in data)) return null;
  return (data as { readonly atlasSortable: AtlasSortableData }).atlasSortable;
}

/**
 * The shift for one project or group row while another row of the sidebar
 * drags: the same vertical list movement as the thread rows.
 */
export function resolveAtlasRowTransform(input: {
  readonly ids: readonly string[];
  readonly rectOf: (id: string) => ClientRect | undefined;
  readonly activeId: string;
  readonly overId: string;
  readonly id: string;
}): Transform {
  const rects: ClientRect[] = [];
  for (const [index, id] of input.ids.entries()) {
    const rect = input.rectOf(id);
    if (rect !== undefined) rects[index] = rect;
  }
  const members = input.ids.map((_, index) => index);
  return sortWithinList(
    {
      rects,
      activeNodeRect: null,
      activeIndex: input.ids.indexOf(input.activeId),
      overIndex: input.ids.indexOf(input.overId),
      index: input.ids.indexOf(input.id),
    },
    members,
  );
}

export type AtlasSidebarDrop =
  | {
      readonly kind: "move-project";
      readonly projectKey: string;
      readonly folderId: string | null;
      readonly beforeProjectKey: string | null;
    }
  | {
      readonly kind: "move-folder";
      readonly folderId: string;
      readonly beforeFolderId: string | null;
    };

/** The key that follows `key` once it moves from its place to `over`'s. */
function nextAfterMove(siblings: readonly string[], key: string, over: string): string | null {
  const from = siblings.indexOf(key);
  const to = siblings.indexOf(over);
  if (from === -1 || to === -1) return null;
  return arrayMove([...siblings], from, to)[to + 1] ?? null;
}

/** What dropping one project or group row on another target does. */
export function planAtlasSidebarDrop(
  active: AtlasSortableData | null,
  over: AtlasSortableData | null,
): AtlasSidebarDrop | null {
  if (active === null || over === null) return null;
  if (active.kind === "folder") {
    if (over.kind !== "folder" || over.folderId === active.folderId) return null;
    return {
      kind: "move-folder",
      folderId: active.folderId,
      beforeFolderId: nextAfterMove(active.siblings, active.folderId, over.folderId),
    };
  }
  if (active.kind !== "project") return null;
  const { projectKey } = active;
  if (over.kind === "project") {
    if (over.projectKey === projectKey) return null;
    if (over.folderId === active.folderId) {
      // Ungrouped follows the project sort setting, so it has no order to change.
      if (active.folderId === null || !active.siblings.includes(over.projectKey)) return null;
      return {
        kind: "move-project",
        projectKey,
        folderId: active.folderId,
        beforeProjectKey: nextAfterMove(active.siblings, projectKey, over.projectKey),
      };
    }
    return {
      kind: "move-project",
      projectKey,
      folderId: over.folderId,
      beforeProjectKey: over.folderId === null ? null : over.projectKey,
    };
  }
  const folderId = over.kind === "folder" ? over.folderId : null;
  if (folderId === active.folderId) return null;
  return { kind: "move-project", projectKey, folderId, beforeProjectKey: null };
}

function pointerInside(
  rect: ClientRect | undefined,
  pointer: { readonly x: number; readonly y: number } | null,
): boolean {
  return (
    rect !== undefined &&
    pointer !== null &&
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom
  );
}

/**
 * Targets for project and group drags. A group reorders among the groups. A
 * project reorders among its group's projects while the pointer stays in that
 * group, and moves into another group, or out to Ungrouped, when the pointer
 * enters it.
 */
export const atlasCollisionDetection: CollisionDetection = (args) => {
  const active = readAtlasSortableData(args.active.data.current);
  const containers: DroppableContainer[] = [];
  const dataOf = new Map<DroppableContainer, AtlasSortableData>();
  for (const container of args.droppableContainers) {
    const data = readAtlasSortableData(container.data.current);
    if (data === null) continue;
    containers.push(container);
    dataOf.set(container, data);
  }
  const closest = (accept: (data: AtlasSortableData) => boolean) =>
    closestCenter({
      ...args,
      droppableContainers: containers.filter((container) => accept(dataOf.get(container)!)),
    });
  if (active?.kind === "folder") return closest((data) => data.kind === "folder");
  if (active?.kind !== "project") return [];
  const own =
    active.folderId === null ? ATLAS_UNGROUPED_ID : atlasFolderSortableId(active.folderId);
  const inside = (container: DroppableContainer) =>
    pointerInside(args.droppableRects.get(container.id), args.pointerCoordinates);
  const sibling = (data: AtlasSortableData) =>
    data.kind === "project" && active.folderId !== null && data.folderId === active.folderId;
  if (containers.some((container) => container.id === own && inside(container))) {
    return active.folderId === null ? [] : closest(sibling);
  }
  const into = containers.find(
    (container) =>
      container.id !== own && dataOf.get(container)!.kind !== "project" && inside(container),
  );
  if (into !== undefined) return [{ id: into.id, data: { droppableContainer: into, value: 0 } }];
  return active.folderId === null ? [] : closest(sibling);
};

/**
 * The sidebar's one DndContext carries thread, project and group drags. Thread
 * drags keep the upstream detection, over thread rows that make sense for the
 * dragged row's list; project and group drags use the Code Atlas one.
 */
export function withAtlasCollisions(
  threadCollisions: CollisionDetection,
  lists: { readonly current: AtlasSortableLists },
): CollisionDetection {
  return (args) => {
    if (readAtlasSortableData(args.active.data.current) !== null) {
      return atlasCollisionDetection(args);
    }
    const source = lists.current.get(String(args.active.id));
    return threadCollisions({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) =>
          readAtlasSortableData(container.data.current) === null &&
          isAtlasThreadDropTarget(source, lists.current.get(String(container.id))),
      ),
    });
  };
}
