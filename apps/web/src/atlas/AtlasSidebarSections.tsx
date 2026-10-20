import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  InboxIcon,
  PinIcon,
  PlusIcon,
} from "lucide-react";
import {
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "~/components/Sidebar.logic";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { projectEnvironment } from "~/state/projects";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { useUiStateStore } from "~/uiStateStore";

import {
  compareAttentionReasons,
  resolveAtlasAttentionReason,
  resolveAtlasThreadPlacement,
  type AtlasAttentionReason,
} from "./atlasThreadSections";
import { GroupIcon, GroupSettingsDialog } from "./GroupSettingsDialog";
import { usePublishRunningAgents } from "./runningAgents";
import {
  resolveProjectFolders,
  useProjectFoldersStore,
  type ProjectFolder,
} from "./projectFolders";

export type AtlasRowSection = "pinned" | "active" | "working" | "snoozed" | "settled";

export interface AtlasSidebarSectionsProps {
  readonly pinnedThreads: readonly EnvironmentThreadShell[];
  readonly activeThreads: readonly EnvironmentThreadShell[];
  readonly workingThreads: readonly EnvironmentThreadShell[];
  readonly snoozedThreads: readonly EnvironmentThreadShell[];
  readonly settledThreads: readonly EnvironmentThreadShell[];
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly snoozeNow: string;
  readonly renderThreadRow: (thread: EnvironmentThreadShell, section: AtlasRowSection) => ReactNode;
  readonly onNewThreadInProject: (project: SidebarProjectSnapshot) => void;
  readonly onProjectSettings: (
    event: ReactMouseEvent<HTMLElement>,
    project: SidebarProjectSnapshot,
  ) => void;
  readonly onAddProject: () => void;
}

const PROJECT_DRAG_TYPE = "application/x-codeatlas-project";
const FOLDER_DRAG_TYPE = "application/x-codeatlas-folder";

type DropTarget =
  | { readonly kind: "folder"; readonly folderId: string }
  | { readonly kind: "project"; readonly projectKey: string }
  | { readonly kind: "ungrouped" };

function threadKeyOf(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

type RowMenuAction = "rename" | "settings";
const ROW_MENU_ITEMS = [
  { id: "rename", label: "Rename" },
  { id: "settings", label: "Settings" },
] as const;

/** Right-click on a project or group: the native Rename / Settings menu. */
async function showRowMenu(event: ReactMouseEvent<HTMLElement>): Promise<RowMenuAction | null> {
  event.preventDefault();
  event.stopPropagation();
  const api = readLocalApi();
  if (!api) return null;
  return api.contextMenu.show<RowMenuAction>(ROW_MENU_ITEMS, {
    x: event.clientX,
    y: event.clientY,
  });
}

function draggedKind(event: ReactDragEvent): "project" | "folder" | null {
  const types = event.dataTransfer.types;
  if (types.includes(PROJECT_DRAG_TYPE)) return "project";
  if (types.includes(FOLDER_DRAG_TYPE)) return "folder";
  return null;
}

/**
 * The Code Atlas thread navigator: Pinned, Needs attention, Working, then the
 * user's project groups with each project's remaining threads. Every thread is
 * rendered once, through the upstream sidebar row.
 */
export function AtlasSidebarSections(props: AtlasSidebarSectionsProps) {
  const {
    pinnedThreads,
    activeThreads,
    workingThreads,
    snoozedThreads,
    settledThreads,
    projects,
    snoozeNow,
    renderThreadRow,
  } = props;
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const store = useProjectFoldersStore();
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingProjectKey, setRenamingProjectKey] = useState<string | null>(null);
  const [settingsFolderId, setSettingsFolderId] = useState<string | null>(null);
  const updateProject = useOrchestrationCommand(projectEnvironment.update);

  // Same rename as Settings → Projects: every member checkout gets the new title.
  const renameProject = async (project: SidebarProjectSnapshot, name: string) => {
    const title = name.trim();
    if (title.length === 0 || title === project.displayName) return;
    for (const member of project.memberProjects) {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, title },
      });
      if (result._tag === "Failure") return;
    }
  };

  const projectKeyByMember = new Map<string, string>();
  for (const project of projects) {
    for (const member of project.memberProjects) {
      projectKeyByMember.set(`${member.environmentId}:${member.id}`, project.projectKey);
    }
  }
  const projectKeyOfThread = (thread: EnvironmentThreadShell) =>
    projectKeyByMember.get(`${thread.environmentId}:${thread.projectId}`) ?? null;

  const attention: { thread: EnvironmentThreadShell; reason: AtlasAttentionReason }[] = [];
  const working: EnvironmentThreadShell[] = [];
  const projectActive = new Map<string, EnvironmentThreadShell[]>();
  const projectHidden = new Map<
    string,
    { thread: EnvironmentThreadShell; section: AtlasRowSection }[]
  >();
  const pushTo = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const thread of [...activeThreads, ...workingThreads]) {
    const status = resolveSidebarThreadStatus(thread);
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      lastVisitedById[threadKeyOf(thread)],
    );
    const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
    const wokeAt = threadWokeAt(thread, { now: snoozeNow });
    const isWoke =
      wokeAt !== null &&
      (lastVisitedAt === undefined || Date.parse(lastVisitedAt) < Date.parse(wokeAt)) &&
      thread.settledOverride !== "settled";
    const placement = resolveAtlasThreadPlacement({
      pinned: false,
      status,
      isUnread,
      isWoke,
      snoozed: false,
    });
    if (placement === "working") {
      working.push(thread);
    } else if (placement === "attention") {
      attention.push({
        thread,
        reason: resolveAtlasAttentionReason({ status, isUnread, isWoke }) ?? "unread",
      });
    } else {
      pushTo(projectActive, projectKeyOfThread(thread) ?? "", thread);
    }
  }
  for (const thread of snoozedThreads) {
    pushTo(projectHidden, projectKeyOfThread(thread) ?? "", { thread, section: "snoozed" });
  }
  for (const thread of settledThreads) {
    pushTo(projectHidden, projectKeyOfThread(thread) ?? "", { thread, section: "settled" });
  }
  attention.sort((left, right) => compareAttentionReasons(left.reason, right.reason));

  const { folders, ungrouped } = resolveProjectFolders(store, projects);

  const clearDrop = () => setDropTarget(null);
  const allowDrop = (event: ReactDragEvent, target: DropTarget) => {
    const kind = draggedKind(event);
    if (kind === null) return;
    if (kind === "folder" && target.kind !== "folder") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };
  const handleDrop = (event: ReactDragEvent, target: DropTarget, folderId: string | null) => {
    const projectKey = event.dataTransfer.getData(PROJECT_DRAG_TYPE);
    const draggedFolderId = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    event.preventDefault();
    setDropTarget(null);
    if (projectKey) {
      store.moveProject({
        projectKey,
        folderId,
        beforeProjectKey: target.kind === "project" ? target.projectKey : null,
      });
      if (folderId !== null) {
        const folder = store.folders.find((candidate) => candidate.id === folderId);
        if (folder?.collapsed) store.toggleFolder(folderId);
      }
    } else if (draggedFolderId && target.kind === "folder") {
      store.moveFolder(draggedFolderId, target.folderId);
    }
  };

  const isDropTarget = (target: DropTarget) =>
    dropTarget !== null &&
    dropTarget.kind === target.kind &&
    (target.kind === "ungrouped" ||
      (target.kind === "folder" &&
        dropTarget.kind === "folder" &&
        dropTarget.folderId === target.folderId) ||
      (target.kind === "project" &&
        dropTarget.kind === "project" &&
        dropTarget.projectKey === target.projectKey));

  const renderProject = (project: SidebarProjectSnapshot, folderId: string | null) => {
    const active = projectActive.get(project.projectKey) ?? [];
    const hidden = projectHidden.get(project.projectKey) ?? [];
    const expanded = store.expandedProjectKeys[project.projectKey] === true;
    const revealed = store.revealedProjectKeys[project.projectKey] === true;
    const target: DropTarget = { kind: "project", projectKey: project.projectKey };
    return (
      <li key={project.projectKey} className="list-none">
        <div
          role="button"
          tabIndex={0}
          draggable={renamingProjectKey !== project.projectKey}
          aria-expanded={expanded}
          onDragStart={(event) => {
            event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.projectKey);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={clearDrop}
          onDragOver={(event) => allowDrop(event, target)}
          onDragLeave={clearDrop}
          onDrop={(event) => handleDrop(event, target, folderId)}
          onClick={() => store.toggleProjectExpanded(project.projectKey)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              store.toggleProjectExpanded(project.projectKey);
            }
          }}
          onContextMenu={(event) => {
            void showRowMenu(event).then((action) => {
              if (action === "rename") setRenamingProjectKey(project.projectKey);
              else if (action === "settings") props.onProjectSettings(event, project);
            });
          }}
          data-atlas-row="project"
          className={cn(
            "group/atlas-project relative flex h-8 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2 text-sm text-sidebar-foreground outline-hidden select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            folderId !== null && "ml-3",
            isDropTarget(target) &&
              "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
          )}
        >
          <ProjectFavicon project={project} className="size-4 shrink-0" />
          {renamingProjectKey === project.projectKey ? (
            <FolderNameInput
              initialValue={project.displayName}
              ariaLabel="Project name"
              onCommit={(name) => {
                setRenamingProjectKey(null);
                void renameProject(project, name);
              }}
              onCancel={() => setRenamingProjectKey(null)}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
          )}
          {active.length > 0 && !expanded ? (
            <span
              data-atlas-row-count
              className="text-2xs text-sidebar-muted-foreground tabular-nums"
            >
              {active.length} {active.length === 1 ? "thread" : "threads"}
            </span>
          ) : null}
          <span
            data-atlas-row-actions
            className="flex items-center opacity-0 group-hover/atlas-project:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100"
          >
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`New thread in ${project.displayName}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onNewThreadInProject(project);
              }}
            >
              <PlusIcon />
            </Button>
            <ProjectMenu
              project={project}
              folders={store.folders}
              currentFolderId={folderId}
              onMove={(targetFolderId) =>
                store.moveProject({ projectKey: project.projectKey, folderId: targetFolderId })
              }
              onNewThread={() => props.onNewThreadInProject(project)}
              onSettings={(event) => props.onProjectSettings(event, project)}
            />
          </span>
        </div>
        {expanded ? (
          <ul
            role="presentation"
            className={cn(
              "mt-px flex flex-col gap-px border-l border-sidebar-border pl-1",
              folderId !== null ? "ml-6" : "ml-3.5",
            )}
          >
            {active.map((thread) => renderThreadRow(thread, "active"))}
            {active.length === 0 && hidden.length === 0 ? (
              <li className="list-none px-2 py-1.5 text-xs text-sidebar-muted-foreground">
                No threads yet
              </li>
            ) : null}
            {hidden.length > 0 ? (
              <li className="list-none">
                <button
                  type="button"
                  onClick={() => store.toggleProjectRevealed(project.projectKey)}
                  className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                >
                  <ChevronRightIcon
                    className={cn("size-3 transition-transform", revealed && "rotate-90")}
                  />
                  {revealed ? "Hide" : "Show"} {hidden.length} settled or snoozed
                </button>
              </li>
            ) : null}
            {revealed
              ? hidden.map(({ thread, section }) => renderThreadRow(thread, section))
              : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const renderFolder = (folder: ProjectFolder, members: readonly SidebarProjectSnapshot[]) => {
    const target: DropTarget = { kind: "folder", folderId: folder.id };
    const hasAttention = members.some((project) =>
      attention.some(({ thread }) => projectKeyOfThread(thread) === project.projectKey),
    );
    return (
      <li key={folder.id} className="list-none">
        <div
          role="button"
          tabIndex={0}
          draggable={renamingFolderId !== folder.id}
          aria-expanded={!folder.collapsed}
          onDragStart={(event) => {
            event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={clearDrop}
          onDragOver={(event) => allowDrop(event, target)}
          onDragLeave={clearDrop}
          onDrop={(event) => handleDrop(event, target, folder.id)}
          onClick={() => store.toggleFolder(folder.id)}
          onDoubleClick={() => setRenamingFolderId(folder.id)}
          onContextMenu={(event) => {
            void showRowMenu(event).then((action) => {
              if (action === "rename") setRenamingFolderId(folder.id);
              else if (action === "settings") setSettingsFolderId(folder.id);
            });
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              store.toggleFolder(folder.id);
            } else if (event.key === "F2") {
              setRenamingFolderId(folder.id);
            }
          }}
          data-atlas-row="folder"
          className={cn(
            "group/atlas-folder relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-1 text-sm font-medium text-sidebar-foreground outline-hidden select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            isDropTarget(target) && "bg-primary/10 ring-1 ring-primary/40",
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform",
              !folder.collapsed && "rotate-90",
            )}
          />
          {folder.icon ? (
            <GroupIcon icon={folder.icon} />
          ) : folder.collapsed ? (
            <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
          ) : (
            <FolderOpenIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
          )}
          {renamingFolderId === folder.id ? (
            <FolderNameInput
              initialValue={folder.name}
              onCommit={(name) => {
                store.renameFolder(folder.id, name);
                setRenamingFolderId(null);
              }}
              onCancel={() => setRenamingFolderId(null)}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          )}
          {folder.collapsed && hasAttention ? (
            <span aria-label="Needs attention" className="size-1.5 rounded-full bg-primary" />
          ) : null}
          <span
            data-atlas-row-count
            className="shrink-0 text-2xs font-normal text-sidebar-muted-foreground tabular-nums"
          >
            {members.length} {members.length === 1 ? "project" : "projects"}
          </span>
          <span
            data-atlas-row-actions
            className="flex items-center opacity-0 group-hover/atlas-folder:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100"
          >
            <FolderMenu
              onRename={() => setRenamingFolderId(folder.id)}
              onSettings={() => setSettingsFolderId(folder.id)}
              onDelete={() => store.deleteFolder(folder.id)}
            />
          </span>
        </div>
        {!folder.collapsed ? (
          <ul role="presentation" className="mt-px flex flex-col gap-px">
            {members.map((project) => renderProject(project, folder.id))}
            {members.length === 0 ? (
              <li className="ml-3 list-none rounded-md border border-dashed border-sidebar-border px-2 py-1.5 text-xs text-sidebar-muted-foreground">
                Drag projects here
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  // Pinned threads keep their row in Pinned, so count their running agents too.
  usePublishRunningAgents(
    working.length +
      pinnedThreads.filter((thread) => {
        const status = resolveSidebarThreadStatus(thread);
        return status === "working" || status === "waiting";
      }).length,
  );

  const settingsFolder =
    settingsFolderId === null
      ? null
      : (store.folders.find((folder) => folder.id === settingsFolderId) ?? null);

  return (
    <>
      {pinnedThreads.length > 0 ? (
        <AtlasSection
          id="pinned"
          icon={<PinIcon className="size-3.5" />}
          label="Pinned"
          collapsed={store.collapsedSections.pinned === true}
          onToggle={() => store.toggleSection("pinned")}
        >
          {pinnedThreads.map((thread) => renderThreadRow(thread, "pinned"))}
        </AtlasSection>
      ) : null}
      {attention.length > 0 ? (
        <AtlasSection
          id="attention"
          icon={<InboxIcon className="size-3.5" />}
          label="Needs attention"
          count={attention.length}
          countTone="attention"
          collapsed={store.collapsedSections.attention === true}
          onToggle={() => store.toggleSection("attention")}
        >
          {attention.map(({ thread }) => renderThreadRow(thread, "active"))}
        </AtlasSection>
      ) : null}
      {working.length > 0 ? (
        <AtlasSection
          id="working"
          icon={<AtlasActivityDots />}
          label="Working"
          count={working.length}
          collapsed={store.collapsedSections.working === true}
          onToggle={() => store.toggleSection("working")}
        >
          {working.map((thread) => renderThreadRow(thread, "working"))}
        </AtlasSection>
      ) : null}

      <li className="mt-3 list-none">
        <div className="flex h-7 items-center gap-1 pr-1 pl-2">
          <span className="flex-1 font-mono text-2xs tracking-wider text-sidebar-muted-foreground uppercase">
            Groups
          </span>
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="New group"
            onClick={() => setCreatingFolder(true)}
          >
            <FolderPlusIcon />
          </Button>
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Add project"
            onClick={props.onAddProject}
          >
            <PlusIcon />
          </Button>
        </div>
        <ul role="presentation" className="flex flex-col gap-px">
          {creatingFolder ? (
            <li className="flex h-8 list-none items-center gap-1.5 rounded-md bg-sidebar-row-hover pl-1">
              <ChevronRightIcon aria-hidden className="size-3.5 text-sidebar-muted-foreground" />
              <FolderIcon aria-hidden className="size-4 text-sidebar-muted-foreground" />
              <FolderNameInput
                initialValue=""
                placeholder="Group name"
                onCommit={(name) => {
                  store.createFolder(name);
                  setCreatingFolder(false);
                }}
                onCancel={() => setCreatingFolder(false)}
              />
            </li>
          ) : null}
          {folders.map(({ folder, projects: members }) => renderFolder(folder, members))}
          {folders.length === 0 && !creatingFolder ? (
            <li className="list-none px-2 py-1 text-xs text-sidebar-muted-foreground">
              <button
                type="button"
                className="cursor-pointer underline-offset-2 hover:text-sidebar-foreground hover:underline"
                onClick={() => setCreatingFolder(true)}
              >
                Create a group
              </button>{" "}
              and drag projects into it.
            </li>
          ) : null}
        </ul>
      </li>

      {ungrouped.length > 0 ? (
        <li className="mt-2 list-none">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={!store.ungroupedCollapsed}
            onClick={store.toggleUngrouped}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                store.toggleUngrouped();
              }
            }}
            onDragOver={(event) => allowDrop(event, { kind: "ungrouped" })}
            onDragLeave={clearDrop}
            onDrop={(event) => handleDrop(event, { kind: "ungrouped" }, null)}
            className={cn(
              "flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 pl-2 outline-hidden select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isDropTarget({ kind: "ungrouped" }) && "bg-primary/10 ring-1 ring-primary/40",
            )}
          >
            <span className="flex-1 font-mono text-2xs tracking-wider text-sidebar-muted-foreground uppercase">
              Ungrouped
            </span>
            <span className="text-2xs text-sidebar-muted-foreground tabular-nums">
              {ungrouped.length}
            </span>
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 text-sidebar-muted-foreground transition-transform",
                !store.ungroupedCollapsed && "rotate-90",
              )}
            />
          </div>
          {!store.ungroupedCollapsed ? (
            <ul role="presentation" className="flex flex-col gap-px">
              {ungrouped.map((project) => renderProject(project, null))}
            </ul>
          ) : null}
        </li>
      ) : null}
      {settingsFolder ? (
        <GroupSettingsDialog
          key={settingsFolder.id}
          folder={settingsFolder}
          onOpenChange={(open) => {
            if (!open) setSettingsFolderId(null);
          }}
          onSave={({ name, icon }) => {
            store.renameFolder(settingsFolder.id, name);
            store.setFolderIcon(settingsFolder.id, icon);
          }}
        />
      ) : null}
    </>
  );
}

function AtlasSection(props: {
  readonly id: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly count?: number;
  readonly countTone?: "attention";
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <li className="mb-2 list-none" data-atlas-section={props.id}>
      <button
        type="button"
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">{props.icon}</span>
        <span className="text-sidebar-foreground">{props.label}</span>
        {props.count !== undefined ? (
          <span
            className={cn(
              "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs tabular-nums",
              props.countTone === "attention"
                ? "bg-primary/15 text-primary"
                : "bg-sidebar-row-active text-sidebar-muted-foreground",
            )}
          >
            {props.count}
          </span>
        ) : null}
        <ChevronRightIcon
          aria-hidden
          className={cn("ml-auto size-3.5 transition-transform", !props.collapsed && "rotate-90")}
        />
      </button>
      {!props.collapsed ? (
        <ul role="presentation" className="mt-px flex flex-col gap-px">
          {props.children}
        </ul>
      ) : null}
    </li>
  );
}

/** Three Code Atlas dots that pulse while agents run (compositor-only). */
export function AtlasActivityDots({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-atlas-activity
      className={cn("inline-grid grid-cols-2 gap-0.5", className)}
    >
      <span className="size-1 rounded-full bg-primary" />
      <span className="size-1 rounded-full bg-primary" />
      <span className="col-span-2 mx-auto size-1 rounded-full bg-primary" />
    </span>
  );
}

function FolderNameInput(props: {
  readonly initialValue: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initialValue);
  const commit = () => {
    if (value.trim().length === 0) props.onCancel();
    else props.onCommit(value);
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel ?? "Group name"}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        else if (event.key === "Escape") props.onCancel();
      }}
      onBlur={commit}
      className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm text-foreground outline-hidden focus-visible:border-ring"
    />
  );
}

function FolderMenu(props: {
  readonly onRename: () => void;
  readonly onSettings: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Group options"
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuItem onClick={props.onRename}>Rename group</MenuItem>
        <MenuItem onClick={props.onSettings}>Group settings</MenuItem>
        <MenuItem variant="destructive" onClick={props.onDelete}>
          Delete group
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ProjectMenu(props: {
  readonly project: SidebarProjectSnapshot;
  readonly folders: readonly ProjectFolder[];
  readonly currentFolderId: string | null;
  readonly onMove: (folderId: string | null) => void;
  readonly onNewThread: () => void;
  readonly onSettings: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Options for ${props.project.displayName}`}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuItem onClick={props.onNewThread}>New thread</MenuItem>
        <MenuItem onClick={(event) => props.onSettings(event)}>Project settings</MenuItem>
        {props.folders.length > 0 || props.currentFolderId !== null ? <MenuSeparator /> : null}
        {props.folders.length > 0 ? (
          <MenuGroup>
            <MenuGroupLabel>Move to group</MenuGroupLabel>
            {props.folders
              .filter((folder) => folder.id !== props.currentFolderId)
              .map((folder) => (
                <MenuItem key={folder.id} onClick={() => props.onMove(folder.id)}>
                  {folder.name}
                </MenuItem>
              ))}
          </MenuGroup>
        ) : null}
        {props.currentFolderId !== null ? (
          <MenuItem onClick={() => props.onMove(null)}>Remove from group</MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
