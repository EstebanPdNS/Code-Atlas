import { FolderIcon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";

import { ProjectIconOverrideGlyph } from "~/components/ProjectFavicon";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import type { ProjectFolder, ProjectFolderIcon } from "./projectFolders";

const ProjectIconPickerDialog = lazy(() =>
  import("~/components/settings/ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

// Custom images are stored in the browser with the groups, so they are shrunk first.
const GROUP_IMAGE_SIZE = 64;

/** Draws `file` into a square PNG data URL, cropped to cover like an app icon. */
async function imageFileToIcon(file: File): Promise<ProjectFolderIcon> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = GROUP_IMAGE_SIZE;
  canvas.height = GROUP_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    GROUP_IMAGE_SIZE,
    GROUP_IMAGE_SIZE,
  );
  bitmap.close();
  return { kind: "image", dataUrl: canvas.toDataURL("image/png") };
}

/** A group's icon: its chosen icon or image, otherwise a (possibly open) folder. */
export function GroupIcon(props: {
  readonly icon: ProjectFolderIcon | undefined;
  readonly open?: boolean;
  readonly className?: string;
}) {
  const className = cn("size-4 shrink-0", props.className);
  if (props.icon?.kind === "image") {
    return (
      <img src={props.icon.dataUrl} alt="" className={cn(className, "rounded-sm object-cover")} />
    );
  }
  if (props.icon) return <ProjectIconOverrideGlyph icon={props.icon} className={className} />;
  return <FolderIcon aria-hidden className={cn(className, "text-sidebar-muted-foreground")} />;
}

/** Settings for one sidebar group: its name and icon. */
export function GroupSettingsDialog(props: {
  readonly folder: ProjectFolder;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (input: { name: string; icon: ProjectFolderIcon | null }) => void;
}) {
  const [name, setName] = useState(props.folder.name);
  const [icon, setIcon] = useState<ProjectFolderIcon | null>(props.folder.icon ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const save = () => {
    props.onSave({ name, icon });
    props.onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full sm:w-[28rem]">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
          <DialogDescription>Rename the group and choose its icon.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                }}
                aria-label="Group name"
              />
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Icon</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-muted/40">
                  <GroupIcon icon={icon ?? undefined} className="size-5" />
                </span>
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                  Choose icon
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Choose image
                </Button>
                {icon ? (
                  <Button size="sm" variant="ghost" onClick={() => setIcon(null)}>
                    Use folder icon
                  </Button>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setImageError(null);
                    imageFileToIcon(file).then(setIcon, () =>
                      setImageError("This image could not be read."),
                    );
                  }}
                />
              </div>
              {imageError ? <p className="text-xs text-destructive">{imageError}</p> : null}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={name.trim().length === 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
      {pickerOpen ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            title="Choose group icon"
            current={icon && icon.kind !== "image" ? icon : null}
            projectName={name.trim() || props.folder.name}
            open
            onOpenChange={setPickerOpen}
            onSelect={setIcon}
          />
        </Suspense>
      ) : null}
    </Dialog>
  );
}
