import { readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFileSafe } from "../lib/fs-helpers.js";
import type { TelemetryCounters, WorkflowRun } from "./types.js";

const EMPTY_TELEMETRY: TelemetryCounters = {
  search: 0,
  store: 0,
  judge: 0,
  vaultRecord: 0,
  skipped: 0,
};

export class WorkflowState {
  private readonly workflowsDir: string;
  public readonly vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.workflowsDir = join(vaultPath, "workflows");
  }

  save(run: WorkflowRun): void {
    const filepath = join(this.workflowsDir, `${run.id}.json`);
    writeFileSafe(filepath, JSON.stringify(run, null, 2));
  }

  /**
   * Increment a telemetry counter for the given run. Sync I/O — Node's
   * single-threaded event loop guarantees atomicity of the read-modify-write
   * block against concurrent JSON-RPC requests handled by the MCP server.
   * Silent no-op if the run file doesn't exist or the JSON is corrupt.
   */
  bumpTelemetry(runId: string, kind: keyof TelemetryCounters, n: number = 1): void {
    const filepath = join(this.workflowsDir, `${runId}.json`);
    if (!existsSync(filepath)) return;
    let run: WorkflowRun;
    try {
      run = JSON.parse(readFileSync(filepath, "utf-8")) as WorkflowRun;
    } catch {
      return;
    }
    if (!run.telemetry) {
      run.telemetry = { ...EMPTY_TELEMETRY };
    }
    run.telemetry[kind] += n;
    writeFileSafe(filepath, JSON.stringify(run, null, 2));
  }

  load(runId: string): WorkflowRun {
    const filepath = join(this.workflowsDir, `${runId}.json`);
    if (!existsSync(filepath)) {
      throw new Error(`Workflow run not found: ${runId}`);
    }
    return JSON.parse(readFileSync(filepath, "utf-8")) as WorkflowRun;
  }

  loadCurrent(): WorkflowRun | null {
    const runs = this.list();
    const active = runs.find(
      (run) => run.status === "running" || run.status === "paused",
    );
    return active ?? null;
  }

  list(): WorkflowRun[] {
    if (!existsSync(this.workflowsDir)) return [];

    const files = readdirSync(this.workflowsDir)
      .filter((file) => file.startsWith("run-") && file.endsWith(".json"));

    const runs: WorkflowRun[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.workflowsDir, file), "utf-8");
        runs.push(JSON.parse(content) as WorkflowRun);
      } catch {
        continue;
      }
    }

    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  delete(runId: string): void {
    const filepath = join(this.workflowsDir, `${runId}.json`);
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  }
}
