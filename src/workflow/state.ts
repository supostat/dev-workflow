import { readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFileSafe } from "../lib/fs-helpers.js";
import type { WorkflowRun } from "./types.js";

export class WorkflowState {
  private readonly workflowsDir: string;

  constructor(vaultPath: string) {
    this.workflowsDir = join(vaultPath, "workflows");
  }

  save(run: WorkflowRun): void {
    const filepath = join(this.workflowsDir, `${run.id}.json`);
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
