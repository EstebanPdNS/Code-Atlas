import {
  useDndContext,
  useDraggable,
  useDroppable,
  type Active,
  type DragEndEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { CSS, useCombinedRefs } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import {
  ATLAS_UNGROUPED_ID,
  atlasSiblingIds,
  atlasSortableId,
  planAtlasSidebarDrop,
  readAtlasSortableData,
  resolveAtlasRowTransform,
  type AtlasSortableData,
} from "./atlasSorting";
import { useProjectFoldersStore } from "./projectFolders";

// dnd-kit's own sortable transition, so these rows glide like the thread rows.
const ROW_TRANSITION = "transform 250ms ease";

export interface AtlasSortableRowState {
  /** Pointer handlers that start the drag; spread on the row's clickable part. */
  readonly listeners: DraggableSyntheticListeners;
  readonly isDragging: boolean;
  /** A project dragged from elsewhere will move into this group on drop. */
  readonly isDropInto: boolean;
}

/**
 * A project or group row of the sidebar that drags to reorder. The whole item
 * (with its open list) moves; `renderRow` draws the clickable row and
 * `children` what opens under it, which stays out of drag re-renders.
 */
export function AtlasSortableRow(props: {
  readonly data: Exclude<AtlasSortableData, { kind: "ungrouped" }>;
  readonly disabled: boolean;
  readonly renderRow: (state: AtlasSortableRowState) => ReactNode;
  readonly children?: ReactNode;
}) {
  const { data } = props;
  const id = atlasSortableId(data);
  const dndData = { atlasSortable: data };
  const {
    listeners,
    setNodeRef: setDragRef,
    transform: dragTransform,
    isDragging,
  } = useDraggable({ id, data: dndData, disabled: props.disabled });
  const { setNodeRef: setDropRef } = useDroppable({ id, data: dndData });
  const setNodeRef = useCombinedRefs(setDragRef, setDropRef);
  const { active, over, droppableRects } = useDndContext();
  const activeData = active === null ? null : readAtlasSortableData(active.data.current);
  const transform = isDragging
    ? dragTransform
    : active !== null && over !== null && activeData?.kind === data.kind
      ? resolveAtlasRowTransform({
          ids: atlasSiblingIds(data),
          rectOf: (rowId) => droppableRects.get(rowId),
          activeId: String(active.id),
          overId: String(over.id),
          id,
        })
      : null;
  const isDropInto =
    data.kind === "folder" &&
    over?.id === id &&
    activeData?.kind === "project" &&
    activeData.folderId !== data.folderId;
  return (
    <li
      ref={setNodeRef}
      data-atlas-sortable={id}
      // An open project or group carries its list along, over the rows it passes.
      className={isDragging ? "relative z-20 list-none rounded-md bg-sidebar" : "list-none"}
      style={{
        transform: CSS.Translate.toString(transform),
        // Only while a row of this kind drags: a drop then lands at once, as the thread rows do.
        transition: activeData?.kind === data.kind && !isDragging ? ROW_TRANSITION : undefined,
      }}
    >
      {props.renderRow({ listeners, isDragging, isDropInto })}
      {props.children}
    </li>
  );
}

/** Ungrouped: a project dragged out of a group moves here when dropped on it. */
export function AtlasUngroupedDropZone(props: {
  readonly className?: string;
  readonly renderHeader: (isDropInto: boolean) => ReactNode;
  readonly children?: ReactNode;
}) {
  const data: AtlasSortableData = { kind: "ungrouped" };
  const { setNodeRef, active, over } = useDroppable({
    id: ATLAS_UNGROUPED_ID,
    data: { atlasSortable: data },
  });
  const activeData = active === null ? null : readAtlasSortableData(active.data.current);
  const isDropInto =
    over?.id === ATLAS_UNGROUPED_ID &&
    activeData?.kind === "project" &&
    activeData.folderId !== null;
  return (
    <li ref={setNodeRef} className={props.className}>
      {props.renderHeader(isDropInto)}
      {props.children}
    </li>
  );
}

/** The dragged row's look, the same as a dragged thread row. */
export const ATLAS_DRAGGING_ROW_CLASS =
  "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active opacity-100 shadow-lg";

/** A group or Ungrouped about to take the dragged project: the drop slot's dashed outline. */
export const ATLAS_DROP_INTO_ROW_CLASS =
  "bg-primary/5 outline-1 outline-dashed -outline-offset-1 outline-primary/45";

/** The sidebar's one DndContext also carries project and group drags; thread handlers skip them. */
export function isAtlasSortableDrag(active: Active): boolean {
  return readAtlasSortableData(active.data.current) !== null;
}

export function applyAtlasSidebarDrop(event: DragEndEvent) {
  const drop = planAtlasSidebarDrop(
    readAtlasSortableData(event.active.data.current),
    event.over === null ? null : readAtlasSortableData(event.over.data.current),
  );
  if (drop === null) return;
  const store = useProjectFoldersStore.getState();
  if (drop.kind === "move-folder") {
    store.moveFolder(drop.folderId, drop.beforeFolderId);
    return;
  }
  store.moveProject({
    projectKey: drop.projectKey,
    folderId: drop.folderId,
    beforeProjectKey: drop.beforeProjectKey,
  });
  if (drop.folderId !== null) {
    const folder = store.folders.find((candidate) => candidate.id === drop.folderId);
    if (folder?.collapsed) store.toggleFolder(drop.folderId);
  }
}
