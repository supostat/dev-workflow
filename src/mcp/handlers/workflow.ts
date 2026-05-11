import { WorkflowState } from "../../workflow/state.js";
import { createWorkflow, type WorkflowCreateInput } from "../workflow-create.js";

export function workflowStatus(vaultPath: string, runId?: string): unknown {
  const state = new WorkflowState(vaultPath);
  if (runId) {
    try {
      return state.load(runId);
    } catch {
      return { message: `Workflow run not found: ${runId}` };
    }
  }
  const current = state.loadCurrent();
  if (!current) {
    return { message: "No active workflow." };
  }
  return current;
}

export function workflowCreate(vaultPath: string, input: WorkflowCreateInput): { filepath: string } {
  return createWorkflow(input, vaultPath);
}
