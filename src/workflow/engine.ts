import type { AgentRegistry } from "../agents/registry.js";
import type { AgentContextBuilder } from "../agents/context-builder.js";
import type { PreparedAgent } from "../agents/types.js";
import type { TaskManager } from "../tasks/manager.js";
import type { WorkflowDefinition, WorkflowRun, StepDefinition } from "./types.js";
import type { WorkflowState } from "./state.js";
import type { EngramBridge } from "../lib/engram.js";
import { todayDate } from "../lib/fs-helpers.js";

export interface WorkflowResolver {
  resolve(name: string): WorkflowDefinition;
}

export interface StepExecutor {
  execute(agent: PreparedAgent): Promise<string>;
}

export interface GateChecker {
  checkTestsPass(command: string): Promise<boolean>;
  checkReviewPass(reviewOutput: string): boolean;
  requestUserApproval(stepName: string, context: string): Promise<boolean>;
}

function nowISO(): string {
  return new Date().toISOString();
}

function computeDurationMs(startedAt: string | null): number | null {
  if (!startedAt) return null;
  return Date.now() - new Date(startedAt).getTime();
}

export class WorkflowEngine {
  private readonly registry: AgentRegistry;
  private readonly contextBuilder: AgentContextBuilder;
  private readonly state: WorkflowState;
  private readonly taskManager: TaskManager | null;
  private readonly executor: StepExecutor;
  private readonly gateChecker: GateChecker;
  private readonly workflowResolver: WorkflowResolver;
  private readonly engramBridge: EngramBridge | null;

  constructor(
    registry: AgentRegistry,
    contextBuilder: AgentContextBuilder,
    state: WorkflowState,
    taskManager: TaskManager | null,
    executor: StepExecutor,
    gateChecker: GateChecker,
    workflowResolver?: WorkflowResolver,
    engramBridge?: EngramBridge | null,
  ) {
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.state = state;
    this.taskManager = taskManager;
    this.executor = executor;
    this.gateChecker = gateChecker;
    this.workflowResolver = workflowResolver ?? { resolve: () => { throw new Error("No workflow resolver"); } };
    this.engramBridge = engramBridge ?? null;
  }

  async start(
    workflow: WorkflowDefinition,
    taskDescription: string,
    taskId?: string,
  ): Promise<WorkflowRun> {
    const runId = this.generateRunId();

    const steps: WorkflowRun["steps"] = {};
    for (const step of workflow.steps) {
      steps[step.name] = {
        status: "pending",
        output: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: 0,
        engramMemoryId: null,
      };
    }

    const run: WorkflowRun = {
      id: runId,
      workflowName: workflow.name,
      taskId: taskId ?? null,
      taskDescription,
      currentStep: workflow.steps[0]!.name,
      startedAt: nowISO(),
      completedAt: null,
      status: "running",
      steps,
    };

    this.state.save(run);

    if (taskId && this.taskManager) {
      this.taskManager.update(taskId, { workflowRun: runId, status: "in-progress" });
    }

    return this.executeLoop(workflow, run);
  }

  async resume(runId: string, stepOutput?: string): Promise<WorkflowRun> {
    const run = this.state.load(runId);
    if (run.status !== "paused") {
      throw new Error(`Cannot resume workflow with status: ${run.status}`);
    }

    if (stepOutput) {
      const currentStepState = run.steps[run.currentStep];
      if (currentStepState) {
        currentStepState.output = stepOutput;
        currentStepState.status = "completed";
        currentStepState.completedAt = nowISO();
      }

      const workflow = this.findWorkflowDefinition(run);
      const nextStep = this.getNextStep(workflow, run.currentStep);
      if (nextStep) {
        run.currentStep = nextStep;
      }
    }

    run.status = "running";
    this.state.save(run);

    const workflow = this.findWorkflowDefinition(run);
    return this.executeLoop(workflow, run);
  }

  abort(runId: string): WorkflowRun {
    const run = this.state.load(runId);
    run.status = "failed";
    run.completedAt = nowISO();
    this.state.save(run);
    return run;
  }

  getStatus(runId?: string): WorkflowRun | null {
    if (runId) {
      try {
        return this.state.load(runId);
      } catch {
        return null;
      }
    }
    return this.state.loadCurrent();
  }

  private async executeLoop(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
  ): Promise<WorkflowRun> {
    while (run.status === "running") {
      const stepDef = workflow.steps.find((s) => s.name === run.currentStep);
      if (!stepDef) {
        run.status = "failed";
        break;
      }

      const stepState = run.steps[run.currentStep]!;

      const engramContext = await this.engramBridge?.beforeStep(
        stepDef.name, run.taskDescription,
      ) ?? "";

      const previousOutputs = this.collectInputs(stepDef, run);
      const agent = this.registry.get(stepDef.agent);
      const variables: Record<string, string> = {
        taskDescription: run.taskDescription,
        engramContext,
        ...previousOutputs,
      };
      const prepared = await this.contextBuilder.prepare(agent, variables);

      stepState.status = "running";
      stepState.startedAt = nowISO();
      this.state.save(run);

      const output = await this.executor.execute(prepared);

      const gateResult = await this.checkGate(stepDef, output, agent);

      const previousStepName = this.getPreviousStep(workflow, run.currentStep);
      const parentMemoryId = previousStepName
        ? run.steps[previousStepName]?.engramMemoryId ?? null
        : null;

      if (gateResult === "passed") {
        stepState.status = "completed";
        stepState.output = output;
        stepState.completedAt = nowISO();
        stepState.durationMs = computeDurationMs(stepState.startedAt);
        stepState.engramMemoryId = await this.engramBridge?.afterStep(
          stepDef.name, output, "completed", parentMemoryId,
        ) ?? null;

        const nextStep = this.getNextStep(workflow, run.currentStep);
        if (nextStep) {
          run.currentStep = nextStep;
        } else {
          run.status = "completed";
          run.completedAt = nowISO();
          if (run.taskId && this.taskManager) {
            this.taskManager.update(run.taskId, { status: "done" });
          }
        }
      } else if (gateResult === "failed") {
        stepState.engramMemoryId = await this.engramBridge?.afterStep(
          stepDef.name, output, "failed", parentMemoryId,
        ) ?? null;

        stepState.attempt++;
        if (stepState.attempt >= stepDef.maxAttempts) {
          stepState.status = "failed";
          run.status = "failed";
          run.completedAt = nowISO();
        } else if (stepDef.onFail) {
          stepState.output = output;
          run.currentStep = stepDef.onFail;
          const failTarget = run.steps[stepDef.onFail];
          if (failTarget) {
            failTarget.status = "pending";
          }
        } else {
          stepState.status = "failed";
          run.status = "failed";
          run.completedAt = nowISO();
        }
      } else if (gateResult === "paused") {
        stepState.output = output;
        run.status = "paused";
        this.state.save(run);
        return run;
      }

      this.state.save(run);
    }

    this.state.save(run);
    return run;
  }

  private collectInputs(
    stepDef: StepDefinition,
    run: WorkflowRun,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const ref of stepDef.input) {
      const dotIndex = ref.indexOf(".");
      if (dotIndex === -1) continue;

      const stepName = ref.slice(0, dotIndex);
      const stepState = run.steps[stepName];
      if (stepState?.output) {
        result[stepName] = stepState.output;
      }
    }

    return result;
  }

  private async checkGate(
    stepDef: StepDefinition,
    output: string,
    agent: { permissions: { shellCommands: string[] } },
  ): Promise<"passed" | "failed" | "paused"> {
    switch (stepDef.gate) {
      case "none":
        return "passed";

      case "user-approve": {
        const approved = await this.gateChecker.requestUserApproval(
          stepDef.name,
          output,
        );
        return approved ? "passed" : "paused";
      }

      case "tests-pass": {
        const command = agent.permissions.shellCommands[0] ?? "npm test";
        const passed = await this.gateChecker.checkTestsPass(command);
        return passed ? "passed" : "failed";
      }

      case "review-pass": {
        const passed = this.gateChecker.checkReviewPass(output);
        return passed ? "passed" : "failed";
      }
    }
  }

  private getNextStep(
    workflow: WorkflowDefinition,
    currentStepName: string,
  ): string | null {
    const index = workflow.steps.findIndex((s) => s.name === currentStepName);
    if (index === -1 || index >= workflow.steps.length - 1) return null;
    return workflow.steps[index + 1]!.name;
  }

  private getPreviousStep(
    workflow: WorkflowDefinition,
    currentStepName: string,
  ): string | null {
    const index = workflow.steps.findIndex((s) => s.name === currentStepName);
    if (index <= 0) return null;
    return workflow.steps[index - 1]!.name;
  }

  private findWorkflowDefinition(run: WorkflowRun): WorkflowDefinition {
    return this.workflowResolver.resolve(run.workflowName);
  }

  private generateRunId(): string {
    const date = todayDate();
    const existing = this.state.list()
      .filter((r) => r.id.startsWith(`run-${date}`));
    const seq = String(existing.length + 1).padStart(3, "0");
    return `run-${date}-${seq}`;
  }
}
