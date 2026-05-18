"use client";

// Tasks route (`/tasks`) — the tasks management page.
//
// No live SSE: `startVaultWatch` is depth:0, so `tasks/*.md` never emit
// `vault` events. The list stays current via the mount fetch, a
// project-switch re-fetch, and an explicit re-fetch after every create/patch.
//
// Project-switch race: every fetch is tagged with a generation counter keyed
// on the active project; a response whose generation no longer matches the
// current one is discarded (it belongs to a stale project).
//
// Inline status edit is optimistic: the pre-edit row value is snapshotted at
// edit time and restored verbatim if the PATCH rejects.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/layout/Panel";
import { Button } from "@/components/ui/button";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { ApiTask } from "@/lib/types";
import { TaskFilters } from "@/components/tasks/TaskFilters";
import { TasksTable } from "@/components/tasks/TasksTable";
import { TaskSheet } from "@/components/tasks/TaskSheet";
import { NewTaskDialog, type NewTaskValues } from "@/components/tasks/NewTaskDialog";
import {
  EMPTY_FILTER,
  applyTaskFilter,
  collectBranches,
  sortTasks,
  type SortDirection,
  type TaskFilterState,
  type TaskSortColumn,
} from "@/components/tasks/taskFilter";

export default function TasksPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const boundApi = api.ready ? api.api : null;

  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilterState>(EMPTY_FILTER);
  const [sortColumn, setSortColumn] = useState<TaskSortColumn>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<ApiTask | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const generation = useRef(0);
  const reload = useTaskLoader(boundApi, activeProject, generation, setTasks, setError);

  useEffect(() => {
    generation.current += 1;
    if (boundApi !== null) void reload();
  }, [boundApi, activeProject, reload]);

  const changeStatus = useStatusEditor(boundApi, tasks, setTasks, reload);
  const createTask = useTaskCreator(boundApi, reload);

  /** Flip direction on a repeated column, else switch to it ascending. */
  const toggleSort = useCallback(
    (column: TaskSortColumn): void => {
      if (column === sortColumn) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return;
      }
      setSortColumn(column);
      setSortDirection("asc");
    },
    [sortColumn],
  );

  if (!api.ready) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading project…</p>;
  }

  const visible = sortTasks(applyTaskFilter(tasks, filter), sortColumn, sortDirection);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Panel
        title="Tasks"
        actions={
          <NewTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={createTask} />
        }
      >
        <div className="flex flex-col gap-3">
          <TaskFilters filter={filter} branches={collectBranches(tasks)} onChange={setFilter} />
          {error !== null ? (
            <div>
              <p className="text-sm text-destructive">{error}</p>
              <Button className="mt-2" size="sm" variant="outline" onClick={() => void reload()}>
                Retry
              </Button>
            </div>
          ) : (
            <TasksTable
              tasks={visible}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={(column) => toggleSort(column)}
              onSelect={setSelected}
              onStatusChange={changeStatus}
            />
          )}
        </div>
      </Panel>
      <TaskSheet task={selected} onClose={() => setSelected(null)} onStatusChange={changeStatus} />
    </div>
  );
}

/** Build the generation-guarded task loader. */
function useTaskLoader(
  api: BoundApi | null,
  project: string | null,
  generation: { current: number },
  setTasks: (tasks: ApiTask[]) => void,
  setError: (error: string | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    const ticket = generation.current;
    try {
      const response = await api.getTasks();
      if (ticket !== generation.current) return;
      setTasks(response.tasks);
      setError(null);
    } catch (reason: unknown) {
      if (ticket !== generation.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(`Failed to load tasks: ${message}`);
    }
  }, [api, project, generation, setTasks, setError]);
}

/** Build the optimistic inline-status editor with pre-edit rollback. */
function useStatusEditor(
  api: BoundApi | null,
  tasks: ApiTask[],
  setTasks: (tasks: ApiTask[]) => void,
  reload: () => Promise<void>,
): (task: ApiTask, status: string) => void {
  return useCallback(
    (task: ApiTask, status: string): void => {
      if (api === null || status === task.status) return;
      const previousRow = task;
      const snapshot = tasks;
      setTasks(tasks.map((row) => (row.id === task.id ? { ...row, status: asStatus(status) } : row)));
      void api
        .patchTask(task.id, { status })
        .then(() => reload())
        .catch((reason: unknown) => {
          setTasks(snapshot.map((row) => (row.id === previousRow.id ? previousRow : row)));
          const message = reason instanceof Error ? reason.message : String(reason);
          toast.error(`Failed to update ${task.id}: ${message}`);
        });
    },
    [api, tasks, setTasks, reload],
  );
}

/** Narrow a status string to the `ApiTask` status union for optimistic state. */
function asStatus(status: string): ApiTask["status"] {
  return status as ApiTask["status"];
}

/** Build the create-task handler — POST then re-fetch the list. */
function useTaskCreator(
  api: BoundApi | null,
  reload: () => Promise<void>,
): (values: NewTaskValues) => Promise<void> {
  return useCallback(
    async (values: NewTaskValues): Promise<void> => {
      if (api === null) return;
      try {
        await api.createTask({ title: values.title, description: values.description });
        await reload();
        toast.success("Task created");
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : String(reason);
        toast.error(`Failed to create task: ${message}`);
      }
    },
    [api, reload],
  );
}
