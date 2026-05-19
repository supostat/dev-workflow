"use client";

// Project-registry editor for the Settings page.
//
// Lists the registry from `GET /api/projects` (name / path / lastSeen / active)
// and adds a project through `POST /api/projects`. There is no
// `DELETE /api/projects` route, so removal is not offered — the table renders
// without a remove action and a note points to the registry file / CLI.
//
// "Browse…" opens `DirectoryBrowserDialog`, a server-side directory picker
// (`GET /api/fs/browse`). The picker returns an absolute path directly, so the
// chosen directory seeds the path field ready to POST — no manual editing of a
// browser-hidden path is needed.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { getProjects, createProject } from "@/lib/api";
import type { ProjectListResponse } from "@/lib/api";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";

/** Project-registry table plus an add-project directory picker. */
export function ProjectRegistryEditor() {
  const [registry, setRegistry] = useState<ProjectListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

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
          <RegistryTable registry={registry} />
          <p className="text-xs text-muted-foreground">
            Remove a project via the registry file / CLI.
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
        </div>
      )}
    </Panel>
  );
}

/** Registry table body — one row per project, no remove action. */
function RegistryTable({ registry }: { registry: ProjectListResponse | null }) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {registry.projects.map((project) => (
          <TableRow key={project.name}>
            <TableCell className="font-medium">{project.name}</TableCell>
            <TableCell className="font-mono text-xs">{project.path}</TableCell>
            <TableCell className="text-xs tabular-nums">{project.lastSeen}</TableCell>
            <TableCell>
              {project.active ? <Badge>active</Badge> : <Badge variant="outline">idle</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Reduce an unknown thrown reason to a display message. */
function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
