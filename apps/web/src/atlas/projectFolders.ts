/**
 * Code Atlas project folders: user-defined, collapsible groups of projects in
 * the sidebar ("3DS", "macOS Apps", ...).
 *
 * Folders are purely a client-side view. They store logical project keys
 * (`SidebarProjectSnapshot.projectKey`) and never touch project directories,
 * repositories, worktrees or threads. ("Project group" already names the
 * automatic same-repository merge in sidebarProjectGrouping.ts, hence
 * "folder" in code.)
 */
import type { ProjectIconOverride } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

/** A group's chosen icon: one of the project icons, or a small custom image. */
export type ProjectFolderIcon =
  | ProjectIconOverride
  | { readonly kind: "image"; readonly dataUrl: string };

export interface ProjectFolder {
  readonly id: string;
  readonly name: string;
  readonly projectKeys: readonly string[];
  readonly collapsed: boolean;
  /** Absent means the default folder icon. */
  readonly icon?: ProjectFolderIcon;
}

export interface ProjectFoldersState {
  readonly folders: readonly ProjectFolder[];
  /** Per-project disclosure of its thread list; projects start collapsed. */
  readonly expandedProjectKeys: Readonly<Record<string, boolean>>;
  /** Projects whose settled/snoozed threads are shown. */
  readonly revealedProjectKeys: Readonly<Record<string, boolean>>;
  readonly ungroupedCollapsed: boolean;
  /** Collapsed sidebar sections (pinned, attention, working, folders). */
  readonly collapsedSections: Readonly<Record<string, boolean>>;
}

export const EMPTY_PROJECT_FOLDERS_STATE: ProjectFoldersState = {
  folders: [],
  expandedProjectKeys: {},
  revealedProjectKeys: {},
  ungroupedCollapsed: false,
  collapsedSections: {},
};

export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function createFolder(
  state: ProjectFoldersState,
  input: { readonly id: string; readonly name: string },
): ProjectFoldersState {
  const name = normalizeFolderName(input.name);
  if (name.length === 0 || state.folders.some((folder) => folder.id === input.id)) return state;
  return {
    ...state,
    folders: [...state.folders, { id: input.id, name, projectKeys: [], collapsed: false }],
  };
}

export function renameFolder(
  state: ProjectFoldersState,
  folderId: string,
  name: string,
): ProjectFoldersState {
  const normalized = normalizeFolderName(name);
  if (normalized.length === 0) return state;
  return mapFolder(state, folderId, (folder) =>
    folder.name === normalized ? folder : { ...folder, name: normalized },
  );
}

/** `null` restores the default folder icon. */
export function setFolderIcon(
  state: ProjectFoldersState,
  folderId: string,
  icon: ProjectFolderIcon | null,
): ProjectFoldersState {
  return mapFolder(state, folderId, (folder) => {
    if (icon === null) {
      if (folder.icon === undefined) return folder;
      const { icon: _removed, ...rest } = folder;
      return rest;
    }
    return { ...folder, icon };
  });
}

/** Deleting a folder only ungroups its projects. */
export function deleteFolder(state: ProjectFoldersState, folderId: string): ProjectFoldersState {
  if (!state.folders.some((folder) => folder.id === folderId)) return state;
  return { ...state, folders: state.folders.filter((folder) => folder.id !== folderId) };
}

export function setFolderCollapsed(
  state: ProjectFoldersState,
  folderId: string,
  collapsed: boolean,
): ProjectFoldersState {
  return mapFolder(state, folderId, (folder) =>
    folder.collapsed === collapsed ? folder : { ...folder, collapsed },
  );
}

/**
 * Moves a project into `folderId` (or out of every folder when null), placed
 * before `beforeProjectKey` when that project is in the same folder, else last.
 * A project belongs to at most one folder.
 */
export function moveProjectToFolder(
  state: ProjectFoldersState,
  input: {
    readonly projectKey: string;
    readonly folderId: string | null;
    readonly beforeProjectKey?: string | null;
  },
): ProjectFoldersState {
  const { projectKey, folderId, beforeProjectKey = null } = input;
  if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) return state;
  if (beforeProjectKey === projectKey) return state;
  const folders = state.folders.map((folder) => {
    const without = folder.projectKeys.filter((key) => key !== projectKey);
    if (folder.id !== folderId) {
      return without.length === folder.projectKeys.length
        ? folder
        : { ...folder, projectKeys: without };
    }
    const insertAt = beforeProjectKey === null ? -1 : without.indexOf(beforeProjectKey);
    const projectKeys =
      insertAt === -1
        ? [...without, projectKey]
        : [...without.slice(0, insertAt), projectKey, ...without.slice(insertAt)];
    return { ...folder, projectKeys };
  });
  return { ...state, folders };
}

/** Moves a folder before `beforeFolderId`, or to the end when null. */
export function moveFolder(
  state: ProjectFoldersState,
  folderId: string,
  beforeFolderId: string | null,
): ProjectFoldersState {
  if (folderId === beforeFolderId) return state;
  const moving = state.folders.find((folder) => folder.id === folderId);
  if (!moving) return state;
  const rest = state.folders.filter((folder) => folder.id !== folderId);
  const insertAt = beforeFolderId === null ? -1 : rest.findIndex((f) => f.id === beforeFolderId);
  const folders =
    insertAt === -1
      ? [...rest, moving]
      : [...rest.slice(0, insertAt), moving, ...rest.slice(insertAt)];
  return { ...state, folders };
}

export interface ResolvedProjectFolder<Project> {
  readonly folder: ProjectFolder;
  readonly projects: readonly Project[];
}

/**
 * Joins stored folders with the live project list. Keys of projects that no
 * longer exist (removed, or on a disconnected machine) are kept in storage
 * but not rendered, so membership comes back when the project does.
 */
export function resolveProjectFolders<Project extends { readonly projectKey: string }>(
  state: Pick<ProjectFoldersState, "folders">,
  projects: readonly Project[],
): {
  readonly folders: readonly ResolvedProjectFolder<Project>[];
  readonly ungrouped: readonly Project[];
} {
  const byKey = new Map(projects.map((project) => [project.projectKey, project] as const));
  const grouped = new Set<string>();
  const folders = state.folders.map((folder) => {
    const members: Project[] = [];
    for (const key of folder.projectKeys) {
      const project = byKey.get(key);
      if (project === undefined || grouped.has(key)) continue;
      grouped.add(key);
      members.push(project);
    }
    return { folder, projects: members };
  });
  return { folders, ungrouped: projects.filter((project) => !grouped.has(project.projectKey)) };
}

function mapFolder(
  state: ProjectFoldersState,
  folderId: string,
  update: (folder: ProjectFolder) => ProjectFolder,
): ProjectFoldersState {
  let changed = false;
  const folders = state.folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    const next = update(folder);
    if (next !== folder) changed = true;
    return next;
  });
  return changed ? { ...state, folders } : state;
}

function newFolderId(): string {
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ProjectFoldersStore extends ProjectFoldersState {
  readonly createFolder: (name: string) => string | null;
  readonly renameFolder: (folderId: string, name: string) => void;
  readonly setFolderIcon: (folderId: string, icon: ProjectFolderIcon | null) => void;
  readonly deleteFolder: (folderId: string) => void;
  readonly toggleFolder: (folderId: string) => void;
  readonly moveProject: (input: {
    projectKey: string;
    folderId: string | null;
    beforeProjectKey?: string | null;
  }) => void;
  readonly moveFolder: (folderId: string, beforeFolderId: string | null) => void;
  readonly toggleProjectExpanded: (projectKey: string) => void;
  readonly toggleProjectRevealed: (projectKey: string) => void;
  readonly toggleUngrouped: () => void;
  readonly toggleSection: (section: string) => void;
}

export const useProjectFoldersStore = create<ProjectFoldersStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_PROJECT_FOLDERS_STATE,
      createFolder: (name) => {
        const id = newFolderId();
        const next = createFolder(get(), { id, name });
        if (next === get()) return null;
        set(next);
        return id;
      },
      renameFolder: (folderId, name) => set((state) => renameFolder(state, folderId, name)),
      setFolderIcon: (folderId, icon) => set((state) => setFolderIcon(state, folderId, icon)),
      deleteFolder: (folderId) => set((state) => deleteFolder(state, folderId)),
      toggleFolder: (folderId) =>
        set((state) => {
          const folder = state.folders.find((candidate) => candidate.id === folderId);
          return folder ? setFolderCollapsed(state, folderId, !folder.collapsed) : state;
        }),
      moveProject: (input) => set((state) => moveProjectToFolder(state, input)),
      moveFolder: (folderId, beforeFolderId) =>
        set((state) => moveFolder(state, folderId, beforeFolderId)),
      toggleProjectExpanded: (projectKey) =>
        set((state) => ({
          expandedProjectKeys: {
            ...state.expandedProjectKeys,
            [projectKey]: !state.expandedProjectKeys[projectKey],
          },
        })),
      toggleProjectRevealed: (projectKey) =>
        set((state) => ({
          revealedProjectKeys: {
            ...state.revealedProjectKeys,
            [projectKey]: !state.revealedProjectKeys[projectKey],
          },
        })),
      toggleUngrouped: () => set((state) => ({ ungroupedCollapsed: !state.ungroupedCollapsed })),
      toggleSection: (section) =>
        set((state) => ({
          collapsedSections: {
            ...state.collapsedSections,
            [section]: !state.collapsedSections[section],
          },
        })),
    }),
    {
      name: "codeatlas:project-folders:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        folders: state.folders,
        expandedProjectKeys: state.expandedProjectKeys,
        revealedProjectKeys: state.revealedProjectKeys,
        ungroupedCollapsed: state.ungroupedCollapsed,
        collapsedSections: state.collapsedSections,
      }),
    },
  ),
);
