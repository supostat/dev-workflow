"use client";

// Project-registry editor for the Settings page.
//
// Lists the registry from `GET /api/projects` (name / path / lastSeen / active),
// adds a project through `POST /api/projects`, and removes one via
// `DELETE /api/projects/:name`. Removal is registry-only — the project's files
// on disk are untouched. Removing the active project clears the active
// selection server-side; the table re-fetch surfaces the new state and the
// switcher prompts for a new selection.
//
// "Browse…" opens `DirectoryBrowserDialog`, a server-side directory picker
// (`GET /api/fs/browse`). The picker returns an absolute path directly, so the
// chosen directory seeds the path field ready to POST — no manual editing of a
// browser-hidden path is needed.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Panel } from "@/components/layout/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getProjects, createProject, deleteProject } from "@/lib/api";
import type { ProjectListResponse } from "@/lib/api";
import type { Project } from "@/lib/types";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";

/** Registry list row — `Project` plus the active flag the server adds. */
type RegistryRow = Project & { active: boolean };

/** Project-registry table plus an add-project directory picker. */
export function ProjectRegistryEditor() {
  const [registry, setRegistry] = useState<ProjectListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RegistryRow | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setRegistry(await getProjects());
      setError(null);
    } catch (reason: unknown) {
      setError(describeError(reason));
      toast.error(`Failed to load projects: ${describeError(reason)}`);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async (): Promise<void> => {
    const trimmed = path.trim();
    if (trimmed === "") return;
    setAdding(true);
    try {
      await createProject(trimmed);
      toast.success("Project added");
      setPath("");
      await reload();
    } catch (reason: unknown) {
      toast.error(`Failed to add project: ${describeError(reason)}`);
    } finally {
      setAdding(false);
    }
  }, [path, reload]);

  const remove = useCallback(async (target: RegistryRow): Promise<void> => {
    setRemovingName(target.name);
    try {
      await deleteProject(target.name);
      toast.success(
        target.active
          ? `Project "${target.name}" removed; active selection cleared`
          : `Project "${target.name}" removed`,
      );
      await reload();
    } catch (reason: unknown) {
      toast.error(`Failed to remove project: ${describeError(reason)}`);
    } finally {
      setRemovingName(null);
      setConfirmRemove(null);
    }
  }, [reload]);

  return (
    <Panel title="Projects">
      {error !== null ? (
        <div>
          <p className="text-sm text-destructive">{error}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <RegistryTable
            registry={registry}
            removingName={removingName}
            onRequestRemove={setConfirmRemove}
          />
          <p className="text-xs text-muted-foreground">
            Remove deletes the registry entry only — project files on disk are not touched.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium">Add project</span>
              <Input
                value={path}
                placeholder="/absolute/path/to/project"
                aria-label="Project path"
                onChange={(event) => setPath(event.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setBrowserOpen(true)}>
              Browse…
            </Button>
            <Button size="sm" disabled={adding || path.trim() === ""} onClick={() => void add()}>
              {adding ? "Adding…" : "Add project"}
            </Button>
          </div>
          <DirectoryBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            onSelect={(absolutePath) => setPath(absolutePath)}
          />
          <RemoveConfirmDialog
            target={confirmRemove}
            onOpenChange={(open) => {
              if (!open) setConfirmRemove(null);
            }}
            onConfirm={remove}
            removingName={removingName}
          />
        </div>
      )}
    </Panel>
  );
}

/** Registry table body — one row per project, with a remove action per row. */
function RegistryTable({
  registry,
  removingName,
  onRequestRemove,
}: {
  registry: ProjectListResponse | null;
  removingName: string | null;
  onRequestRemove: (project: RegistryRow) => void;
}) {
  if (registry === null) {
    return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  }
  if (registry.projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects registered.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Path</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="w-12 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registry.projects.map((project) => {
          const removing = removingName === project.name;
          return (
            <TableRow key={project.name}>
              <TableCell className="font-medium">{project.name}</TableCell>
              <TableCell className="font-mono text-xs">{project.path}</TableCell>
              <TableCell className="text-xs tabular-nums">{project.lastSeen}</TableCell>
              <TableCell>
                {project.active ? <Badge>active</Badge> : <Badge variant="outline">idle</Badge>}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove project ${project.name}`}
                  title="Remove from registry"
                  disabled={removing}
                  onClick={() => onRequestRemove(project)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Two-step removal confirmation. Active-project case carries a stricter prompt. */
function RemoveConfirmDialog({
  target,
  onOpenChange,
  onConfirm,
  removingName,
}: {
  target: RegistryRow | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (project: RegistryRow) => void | Promise<void>;
  removingName: string | null;
}) {
  const open = target !== null;
  const isRemoving = target !== null && removingName === target.name;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove project from registry?</AlertDialogTitle>
          <AlertDialogDescription>
            {target === null ? null : (
              <>
                Removes <span className="font-mono">{target.name}</span> from the registry.
                The project&apos;s files on disk are not touched.{" "}
                {target.active ? (
                  <span className="font-medium">
                    This project is currently active — removing it will clear the active
                    selection.
                  </span>
                ) : null}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRemoving}
            onClick={(event) => {
              event.preventDefault();
              if (target !== null) void onConfirm(target);
            }}
          >
            {isRemoving ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Reduce an unknown thrown reason to a display message. */
function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
