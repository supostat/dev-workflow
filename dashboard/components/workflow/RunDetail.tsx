"use client";

// Run-detail view for `/workflow/run/?id=run-XXX`. Reads the `?id=` query
// param via `useSearchParams()` and loads the full run through
// `getWorkflowRun`. Three id-dependent render states:
//   (a) no `?id=`            → an empty state pointing back to the runs list;
//   (b) malformed `?id=`     → a distinct error panel (the server rejects an
//                              id failing `RUN_ID_PATTERN` with a 400);
//   (c) a resolved run       → the tabbed detail (Overview / Steps / JSON /
//                              Trace).
// A generation guard keyed on the run id discards a response whose id no
// longer matches the current query param. The trace SSE url stays `null`
// until the id resolves — the server 400s on a missing runId.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/layout/Panel";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { ApiWorkflowRunDetail } from "@/lib/api";
import { RunStatusBadge } from "./RunStatusBadge";
import { StepList } from "./StepList";
import { TelemetryCounters } from "./TelemetryCounters";
import { TraceTail } from "./TraceTail";

/** Distinguishes a malformed-id 400 from a generic load failure. */
type LoadError = { kind: "malformed" | "generic"; message: string };

export function RunDetail() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const searchParams = useSearchParams();
  const runId = searchParams.get("id");
  const boundApi = api.ready ? api.api : null;

  const [run, setRun] = useState<ApiWorkflowRunDetail | null>(null);
  const [error, setError] = useState<LoadError | null>(null);

  const generation = useRef(0);
  const reload = useRunDetailLoader(boundApi, runId, generation, setRun, setError);

  useEffect(() => {
    generation.current += 1;
    setRun(null);
    setError(null);
    if (boundApi !== null && runId !== null) void reload();
  }, [boundApi, activeProject, runId, reload]);

  if (!api.ready) {
    return <ProjectNotice reason={api.reason} message={api.reason === "error" ? api.message : undefined} />;
  }
  if (runId === null) return <NoRunState />;
  if (error !== null) {
    return <ErrorState error={error} onRetry={error.kind === "generic" ? reload : null} />;
  }
  if (run === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading run…</p>;
  }
  return <RunTabs run={run} runId={runId} />;
}

/** Build the generation-guarded run-detail loader. */
function useRunDetailLoader(
  api: BoundApi | null,
  runId: string | null,
  generation: { current: number },
  setRun: (run: ApiWorkflowRunDetail) => void,
  setError: (error: LoadError | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null || runId === null) return;
    const ticket = generation.current;
    try {
      const detail = await api.getWorkflowRun(runId);
      if (ticket !== generation.current) return;
      setError(null);
      setRun(detail);
    } catch (reason: unknown) {
      if (ticket !== generation.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      const kind = message.startsWith("invalid run id") ? "malformed" : "generic";
      setError({ kind, message });
      toast.error(`Failed to load run: ${message}`);
    }
  }, [api, runId, generation, setRun, setError]);
}

/** Empty state shown when the route carries no `?id=`. */
function NoRunState() {
  return (
    <Panel title="Run detail">
      <p className="text-sm text-muted-foreground">
        No run selected. Pick a run from the{" "}
        <Link href="/workflow" className="underline">
          runs list
        </Link>
        .
      </p>
    </Panel>
  );
}

/** Error panel — malformed-id and generic load failures render distinctly. */
function ErrorState({
  error,
  onRetry,
}: {
  error: LoadError;
  onRetry: (() => Promise<void>) | null;
}) {
  return (
    <Panel title="Run detail">
      <p className="text-sm text-destructive">
        {error.kind === "malformed"
          ? `That run id is not valid: ${error.message}`
          : error.message}
      </p>
      <div className="mt-2 flex gap-2">
        <BackLink />
        {onRetry !== null ? (
          <Button size="sm" variant="outline" onClick={() => void onRetry()}>
            Retry
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** The tabbed detail of a loaded run. */
function RunTabs({ run, runId }: { run: ApiWorkflowRunDetail; runId: string }) {
  return (
    <Panel
      title={`Run ${run.id}`}
      actions={
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          <BackLink />
        </div>
      }
    >
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
          <TabsTrigger value="trace">Trace</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <RunOverview run={run} />
        </TabsContent>
        <TabsContent value="steps">
          <StepList steps={run.steps} />
        </TabsContent>
        <TabsContent value="json">
          <ScrollArea className="h-96 rounded-md border border-border">
            <pre className="p-3 font-mono text-xs">{JSON.stringify(run, null, 2)}</pre>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="trace">
          <TraceTail url={`/events/trace?runId=${encodeURIComponent(runId)}`} />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

/** Overview tab — run metadata plus the engram telemetry strip. */
function RunOverview({ run }: { run: ApiWorkflowRunDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <Field label="Workflow" value={run.workflowName} />
        <Field label="Current step" value={run.currentStep} />
        <Field label="Task" value={run.taskId ?? "—"} />
        <Field label="Phase" value={run.phase ?? "—"} />
        <Field label="Started" value={run.startedAt} />
        <Field label="Completed" value={run.completedAt ?? "—"} />
      </dl>
      <p className="text-sm text-muted-foreground">{run.taskDescription}</p>
      {run.abortReason !== undefined ? (
        <p className="text-sm text-status-failed">Aborted: {run.abortReason}</p>
      ) : null}
      <TelemetryCounters telemetry={run.telemetry ?? null} />
    </div>
  );
}

/** One definition-list field. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </>
  );
}

/** Back link to the runs list. */
function BackLink() {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/workflow">
        <ArrowLeft className="size-3" />
        Runs
      </Link>
    </Button>
  );
}
