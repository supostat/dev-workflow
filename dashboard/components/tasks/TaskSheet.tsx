"use client";

// Task detail Sheet — a right-side drawer showing one task's metadata.
//
// Read-only by design: `ApiTask` carries no description/body and the web API's
// `patchTask` accepts only `{status, description}`, so the Sheet exposes the
// task's fixed metadata plus an inline status DropdownMenu. A description
// editor would be half-wired against the current API and is deferred (debt).

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiTask } from "@/lib/types";

const TASK_STATUSES = ["pending", "in-progress", "review", "done", "blocked"] as const;

interface TaskSheetProps {
  /** The task to show, or null when the drawer is closed. */
  task: ApiTask | null;
  /** Close the drawer. */
  onClose: () => void;
  /** Inline status change for the open task. */
  onStatusChange: (task: ApiTask, status: string) => void;
}

/** Right-side drawer with one task's read-only metadata and inline status. */
export function TaskSheet({ task, onClose, onStatusChange }: TaskSheetProps) {
  return (
    <Sheet open={task !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-[26rem] sm:max-w-none">
        {task !== null ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">{task.id}</SheetTitle>
              <SheetDescription>{task.title}</SheetDescription>
            </SheetHeader>
            <dl className="flex flex-col gap-3 px-4 text-sm">
              <MetaRow label="Status">
                <StatusEditor task={task} onStatusChange={onStatusChange} />
              </MetaRow>
              <MetaRow label="Priority">
                <Badge variant="outline">{task.priority}</Badge>
              </MetaRow>
              <MetaRow label="Branch">
                <span className="font-mono text-xs">{task.branch ?? "—"}</span>
              </MetaRow>
              <MetaRow label="Created">
                <span className="font-mono text-xs">{task.created}</span>
              </MetaRow>
              <MetaRow label="Updated">
                <span className="font-mono text-xs">{task.updated}</span>
              </MetaRow>
            </dl>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** One label/value line in the metadata list. */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Inline status DropdownMenu mirroring the table's row editor. */
function StatusEditor({
  task,
  onStatusChange,
}: {
  task: ApiTask;
  onStatusChange: (task: ApiTask, status: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline">
          {task.status}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {TASK_STATUSES.map((status) => (
          <DropdownMenuItem key={status} onSelect={() => onStatusChange(task, status)}>
            {status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
