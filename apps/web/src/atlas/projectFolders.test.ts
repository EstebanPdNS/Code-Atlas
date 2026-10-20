import { describe, expect, it } from "vite-plus/test";

import {
  createFolder,
  deleteFolder,
  EMPTY_PROJECT_FOLDERS_STATE,
  moveFolder,
  moveProjectToFolder,
  renameFolder,
  resolveProjectFolders,
  setFolderCollapsed,
  type ProjectFoldersState,
} from "./projectFolders";

function withFolders(...names: string[]): ProjectFoldersState {
  return names.reduce(
    (state, name) => createFolder(state, { id: name.toLowerCase(), name }),
    EMPTY_PROJECT_FOLDERS_STATE,
  );
}

const keysOf = (state: ProjectFoldersState) =>
  Object.fromEntries(state.folders.map((folder) => [folder.id, folder.projectKeys]));

describe("project folders", () => {
  it("creates folders with trimmed names and rejects blank ones", () => {
    const state = createFolder(EMPTY_PROJECT_FOLDERS_STATE, { id: "a", name: "  3DS   ports " });
    expect(state.folders).toEqual([
      { id: "a", name: "3DS ports", projectKeys: [], collapsed: false },
    ]);
    expect(createFolder(state, { id: "b", name: "   " })).toBe(state);
  });

  it("renames, collapses and deletes without touching other folders", () => {
    let state = withFolders("3DS", "Mac");
    state = renameFolder(state, "mac", "macOS Apps");
    state = setFolderCollapsed(state, "3ds", true);
    expect(state.folders.map((f) => [f.name, f.collapsed])).toEqual([
      ["3DS", true],
      ["macOS Apps", false],
    ]);
    expect(renameFolder(state, "mac", "")).toBe(state);
    expect(deleteFolder(state, "3ds").folders.map((f) => f.id)).toEqual(["mac"]);
  });

  it("keeps each project in exactly one folder", () => {
    let state = withFolders("3DS", "Mac");
    state = moveProjectToFolder(state, { projectKey: "mk64", folderId: "3ds" });
    state = moveProjectToFolder(state, { projectKey: "starwing", folderId: "3ds" });
    state = moveProjectToFolder(state, { projectKey: "mk64", folderId: "mac" });
    expect(keysOf(state)).toEqual({ "3ds": ["starwing"], mac: ["mk64"] });
    state = moveProjectToFolder(state, { projectKey: "mk64", folderId: null });
    expect(keysOf(state)).toEqual({ "3ds": ["starwing"], mac: [] });
  });

  it("inserts a project before a sibling and reorders within a folder", () => {
    let state = withFolders("3DS");
    for (const key of ["a", "b", "c"]) {
      state = moveProjectToFolder(state, { projectKey: key, folderId: "3ds" });
    }
    state = moveProjectToFolder(state, { projectKey: "c", folderId: "3ds", beforeProjectKey: "a" });
    expect(keysOf(state)["3ds"]).toEqual(["c", "a", "b"]);
    state = moveProjectToFolder(state, {
      projectKey: "c",
      folderId: "3ds",
      beforeProjectKey: null,
    });
    expect(keysOf(state)["3ds"]).toEqual(["a", "b", "c"]);
  });

  it("ignores moves into a folder that no longer exists", () => {
    const state = withFolders("3DS");
    expect(moveProjectToFolder(state, { projectKey: "a", folderId: "gone" })).toBe(state);
  });

  it("reorders folders", () => {
    const state = withFolders("A", "B", "C");
    expect(moveFolder(state, "c", "a").folders.map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(moveFolder(state, "a", null).folders.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("resolves live projects and keeps missing members dormant", () => {
    let state = withFolders("3DS");
    state = moveProjectToFolder(state, { projectKey: "gone", folderId: "3ds" });
    state = moveProjectToFolder(state, { projectKey: "mk64", folderId: "3ds" });
    const projects = [{ projectKey: "mk64" }, { projectKey: "ludus" }];
    const resolved = resolveProjectFolders(state, projects);
    expect(resolved.folders[0]?.projects).toEqual([{ projectKey: "mk64" }]);
    expect(resolved.ungrouped).toEqual([{ projectKey: "ludus" }]);
    expect(state.folders[0]?.projectKeys).toContain("gone");
  });
});
