import type { ClientRect, Collision, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarListItem } from "~/components/Sidebar.logic";

import {
  ATLAS_UNGROUPED_ID,
  atlasCollisionDetection,
  atlasFolderSortableId,
  atlasProjectSortableId,
  createAtlasSortingStrategy,
  isAtlasThreadDropTarget,
  planAtlasSidebarDrop,
  resolveAtlasDropSlot,
  resolveAtlasRowTransform,
  type AtlasSortableData,
} from "./atlasSorting";

// The upstream order mixes every project's threads; Code Atlas shows "d" and
// "f" under project x and "e" under project y.
const items: SidebarListItem[] = [
  { kind: "marker", marker: "pinned-header" },
  { kind: "thread", key: "a", section: "pinned" },
  { kind: "thread", key: "b", section: "pinned" },
  { kind: "thread", key: "c", section: "pinned" },
  { kind: "marker", marker: "pinned-divider" },
  { kind: "thread", key: "d", section: "active" },
  { kind: "thread", key: "e", section: "active" },
  { kind: "thread", key: "f", section: "active" },
];
const lists = {
  current: new Map([
    ["a", "pinned"],
    ["b", "pinned"],
    ["c", "pinned"],
    ["d", "project:x"],
    ["e", "project:y"],
    ["f", "project:x"],
  ]),
};

// Rows 36px tall with a 1px gap; markers are not rendered in Code Atlas.
const rect = (top: number, height = 36): ClientRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 200,
  width: 200,
  height,
});
const rects = [
  undefined,
  rect(0),
  rect(37),
  rect(74),
  undefined,
  rect(200),
  rect(400),
  rect(237),
] as ClientRect[];

describe("createAtlasSortingStrategy", () => {
  const layout = (index: number, activeIndex: number, overIndex: number) => ({
    rects,
    activeNodeRect: rects[activeIndex] ?? null,
    activeIndex,
    overIndex,
    index,
  });

  it("shifts the pinned rows between the dragged row and its target", () => {
    const strategy = createAtlasSortingStrategy(items, lists, true);
    // Dragging "a" below "c": "b" and "c" move up one row.
    expect(strategy(layout(2, 1, 3))).toMatchObject({ y: -37 });
    expect(strategy(layout(3, 1, 3))).toMatchObject({ y: -37 });
    // Dragging "c" above "a": "a" and "b" move down one row.
    expect(strategy(layout(1, 3, 1))).toMatchObject({ y: 37 });
  });

  it("shifts a project's threads among themselves, past rows of other lists", () => {
    const strategy = createAtlasSortingStrategy(items, lists, true);
    // Dragging "f" above "d": "d" moves down by one row of its own list.
    expect(strategy(layout(5, 7, 5))).toMatchObject({ y: 37 });
    // "e" sits between them in the upstream order but in another project.
    expect(strategy(layout(6, 7, 5))).toBeNull();
  });

  it("leaves rows outside the dragged row's list, and drags over them, in place", () => {
    const strategy = createAtlasSortingStrategy(items, lists, true);
    expect(strategy(layout(5, 1, 3))).toBeNull();
    expect(strategy(layout(2, 1, 5))).toBeNull();
    expect(strategy(layout(5, 7, 6))).toBeNull();
  });

  it("does nothing while the row drags out as chat context", () => {
    expect(createAtlasSortingStrategy(items, lists, false)(layout(2, 1, 3))).toBeNull();
  });

  it("reads the lists as the sidebar renders them", () => {
    const moving = { current: lists.current };
    const strategy = createAtlasSortingStrategy(items, moving, true);
    expect(strategy(layout(6, 7, 5))).toBeNull();
    moving.current = new Map([...lists.current, ["e", "project:x"]]);
    expect(strategy(layout(6, 7, 5))).not.toBeNull();
  });
});

describe("isAtlasThreadDropTarget", () => {
  it("keeps a project's thread over its own rows, Pinned and settled rows", () => {
    expect(isAtlasThreadDropTarget("project:x", "project:x")).toBe(true);
    expect(isAtlasThreadDropTarget("project:x", "pinned")).toBe(true);
    expect(isAtlasThreadDropTarget("project:x", "hidden:x")).toBe(true);
  });

  it("drops rows where a project's thread would not visibly move", () => {
    expect(isAtlasThreadDropTarget("project:x", "project:y")).toBe(false);
    expect(isAtlasThreadDropTarget("project:x", "attention")).toBe(false);
    expect(isAtlasThreadDropTarget("project:x", "working")).toBe(false);
  });

  it("lets a pinned thread unpin over any row", () => {
    expect(isAtlasThreadDropTarget("pinned", "project:y")).toBe(true);
    expect(isAtlasThreadDropTarget("pinned", "attention")).toBe(true);
  });
});

describe("resolveAtlasDropSlot", () => {
  const rows = [
    { top: 0, height: 36 },
    { top: 37, height: 36 },
    { top: 74, height: 36 },
  ];

  it("opens below the target when moving down", () => {
    expect(resolveAtlasDropSlot(rows, 0, 2)).toEqual({ top: 74, height: 36 });
    expect(resolveAtlasDropSlot(rows, 0, 1)).toEqual({ top: 37, height: 36 });
  });

  it("opens at the target when moving up, and in place before moving", () => {
    expect(resolveAtlasDropSlot(rows, 2, 0)).toEqual({ top: 0, height: 36 });
    expect(resolveAtlasDropSlot(rows, 1, 1)).toEqual({ top: 37, height: 36 });
  });

  it("takes the dragged row's height, such as an open group", () => {
    const groups = [
      { top: 0, height: 100 },
      { top: 101, height: 32 },
    ];
    expect(resolveAtlasDropSlot(groups, 0, 1)).toEqual({ top: 33, height: 100 });
  });

  it("has no slot for rows it cannot measure", () => {
    expect(resolveAtlasDropSlot(rows, 0, 5)).toBeNull();
  });
});

describe("resolveAtlasRowTransform", () => {
  const ids = ["p1", "p2", "p3"];
  const boxes = new Map([
    ["p1", rect(0, 32)],
    ["p2", rect(33, 32)],
    ["p3", rect(66, 32)],
  ]);
  const shift = (id: string, activeId: string, overId: string) =>
    resolveAtlasRowTransform({ ids, rectOf: (rowId) => boxes.get(rowId), activeId, overId, id });

  it("glides the rows between the dragged row and its target, like the thread rows", () => {
    expect(shift("p2", "p1", "p3")).toMatchObject({ y: -33 });
    expect(shift("p3", "p1", "p3")).toMatchObject({ y: -33 });
    expect(shift("p1", "p3", "p2")).toMatchObject({ y: 0 });
    expect(shift("p2", "p3", "p2")).toMatchObject({ y: 33 });
  });

  it("stays put while the dragged row is over another list", () => {
    expect(shift("p2", "p1", "elsewhere")).toBeNull();
    expect(shift("p2", "elsewhere", "p3")).toBeNull();
  });
});

const project = (projectKey: string, folderId: string | null, siblings: string[] = []) =>
  ({ kind: "project", projectKey, folderId, siblings }) satisfies AtlasSortableData;
const folder = (folderId: string, siblings: string[]) =>
  ({ kind: "folder", folderId, siblings }) satisfies AtlasSortableData;

describe("planAtlasSidebarDrop", () => {
  const ports = ["sm64", "zelda", "doom"];

  it("reorders projects inside a group, before the row that follows the drop", () => {
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), project("doom", "3ds"))).toEqual({
      kind: "move-project",
      projectKey: "sm64",
      folderId: "3ds",
      beforeProjectKey: null,
    });
    expect(planAtlasSidebarDrop(project("doom", "3ds", ports), project("sm64", "3ds"))).toEqual({
      kind: "move-project",
      projectKey: "doom",
      folderId: "3ds",
      beforeProjectKey: "sm64",
    });
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), project("zelda", "3ds"))).toEqual(
      expect.objectContaining({ beforeProjectKey: "doom" }),
    );
  });

  it("moves a project into another group, or out to Ungrouped", () => {
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), folder("mac", []))).toEqual({
      kind: "move-project",
      projectKey: "sm64",
      folderId: "mac",
      beforeProjectKey: null,
    });
    expect(planAtlasSidebarDrop(project("app", null), folder("mac", []))).toEqual(
      expect.objectContaining({ folderId: "mac" }),
    );
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), { kind: "ungrouped" })).toEqual(
      expect.objectContaining({ folderId: null, beforeProjectKey: null }),
    );
  });

  it("does nothing in place, in its own group or within Ungrouped", () => {
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), project("sm64", "3ds"))).toBeNull();
    expect(planAtlasSidebarDrop(project("sm64", "3ds", ports), folder("3ds", []))).toBeNull();
    expect(planAtlasSidebarDrop(project("app", null), project("tool", null))).toBeNull();
    expect(planAtlasSidebarDrop(project("app", null), { kind: "ungrouped" })).toBeNull();
    expect(planAtlasSidebarDrop(project("app", null), null)).toBeNull();
  });

  it("reorders groups", () => {
    const groups = ["3ds", "mac", "web"];
    expect(planAtlasSidebarDrop(folder("3ds", groups), folder("mac", groups))).toEqual({
      kind: "move-folder",
      folderId: "3ds",
      beforeFolderId: "web",
    });
    expect(planAtlasSidebarDrop(folder("web", groups), folder("3ds", groups))).toEqual({
      kind: "move-folder",
      folderId: "web",
      beforeFolderId: "3ds",
    });
    expect(planAtlasSidebarDrop(folder("3ds", groups), project("sm64", "mac"))).toBeNull();
  });
});

describe("atlasCollisionDetection", () => {
  const container = (id: string, data: AtlasSortableData, box: ClientRect) => ({
    container: {
      id,
      key: id,
      data: { current: { atlasSortable: data } },
      disabled: false,
      node: { current: null },
      rect: { current: box },
    } as unknown as DroppableContainer,
    box,
  });
  const ports = ["sm64", "zelda"];
  const entries = [
    container(atlasFolderSortableId("3ds"), folder("3ds", ["3ds", "mac"]), rect(0, 100)),
    container(atlasProjectSortableId("sm64"), project("sm64", "3ds", ports), rect(33, 32)),
    container(atlasProjectSortableId("zelda"), project("zelda", "3ds", ports), rect(66, 32)),
    container(atlasFolderSortableId("mac"), folder("mac", ["3ds", "mac"]), rect(101, 32)),
    container(ATLAS_UNGROUPED_ID, { kind: "ungrouped" }, rect(140, 60)),
    container(atlasProjectSortableId("app"), project("app", null), rect(168, 32)),
  ];
  const detect = (active: AtlasSortableData, activeId: string, y: number): Collision[] =>
    atlasCollisionDetection({
      active: { id: activeId, data: { current: { atlasSortable: active } }, rect: { current: {} } },
      collisionRect: rect(y - 16, 32),
      droppableRects: new Map(entries.map(({ container: c, box }) => [c.id, box])),
      droppableContainers: entries.map(({ container: c }) => c),
      pointerCoordinates: { x: 100, y },
    } as unknown as Parameters<typeof atlasCollisionDetection>[0]);
  const target = (active: AtlasSortableData, activeId: string, y: number) =>
    detect(active, activeId, y)[0]?.id;
  const sm64 = project("sm64", "3ds", ports);
  const sm64Id = atlasProjectSortableId("sm64");

  it("reorders a project among its group's projects while it stays in the group", () => {
    expect(target(sm64, sm64Id, 82)).toBe(atlasProjectSortableId("zelda"));
  });

  it("moves a project into the group or Ungrouped under the pointer", () => {
    expect(target(sm64, sm64Id, 117)).toBe(atlasFolderSortableId("mac"));
    expect(target(sm64, sm64Id, 150)).toBe(ATLAS_UNGROUPED_ID);
    expect(target(project("app", null), atlasProjectSortableId("app"), 117)).toBe(
      atlasFolderSortableId("mac"),
    );
  });

  it("has no target for an Ungrouped project inside Ungrouped", () => {
    expect(detect(project("app", null), atlasProjectSortableId("app"), 184)).toEqual([]);
  });

  it("reorders groups among groups", () => {
    const threeDs = folder("3ds", ["3ds", "mac"]);
    expect(target(threeDs, atlasFolderSortableId("3ds"), 117)).toBe(atlasFolderSortableId("mac"));
  });
});
