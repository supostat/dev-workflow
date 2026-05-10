import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StepDefinition, WorkflowDefinition } from "../workflow/types.js";

const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const BUILTIN_STEP_FILES: Record<string, string> = {
  reader: "templates/claude/commands/workflow/steps/read.md",
  planner: "templates/claude/commands/workflow/steps/plan.md",
  "plan-reviewer": "templates/claude/commands/workflow/steps/plan-review.md",
  coder: "templates/claude/commands/workflow/steps/coder.md",
  reviewer: "templates/claude/commands/workflow/steps/review.md",
  tester: "templates/claude/commands/workflow/steps/test.md",
  verifier: "templates/claude/commands/workflow/steps/verify.md",
  committer: "templates/claude/commands/workflow/steps/commit.md",
  preflight: "templates/claude/commands/workflow/steps/preflight.md",
  "vault-updates": "templates/claude/commands/workflow/steps/vault-updates.md",
};

const PLAN_FIX_STEP_FILE = "templates/claude/commands/workflow/steps/plan-fix.md";

const ORCHESTRATOR_AGENTS: ReadonlySet<string> = new Set(["preflight", "vault-updates"]);

const EXPLORE_AGENTS: ReadonlySet<string> = new Set([
  "reader",
  "planner",
  "plan-reviewer",
  "reviewer",
  "verifier",
]);

const FULL_AGENTS: ReadonlySet<string> = new Set(["coder", "committer"]);

const SEPARATOR = "═════════════════════════════════════════════════════════════";
const SUBSEPARATOR = "─────────────────────────────────────────────────────────────";

const SAFE_MERMAID_ID = /^[A-Za-z0-9_-]+$/;
const ALLOWED_STEP_FILE_PREFIXES = [
  ".dev-vault/workflow-steps/",
  "templates/claude/commands/workflow/steps/",
];

function escapeMermaidId(value: string): string {
  if (!SAFE_MERMAID_ID.test(value)) {
    throw new Error(
      `renderGraphMermaid: unsafe step name '${value}' (allowed: A-Z, a-z, 0-9, '_', '-')`,
    );
  }
  return value;
}

function validateStepFilePath(path: string): void {
  if (path.length === 0) {
    throw new Error("renderShow --bodies: rejected unsafe stepFile '' (empty path)");
  }
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`renderShow --bodies: rejected unsafe stepFile '${path}' (absolute path)`);
  }
  const segments = path.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new Error(`renderShow --bodies: rejected unsafe stepFile '${path}' (parent traversal)`);
  }
  const normalized = path.replace(/\\/g, "/");
  const allowed = ALLOWED_STEP_FILE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!allowed) {
    throw new Error(
      `renderShow --bodies: rejected unsafe stepFile '${path}' (must start with one of: ${ALLOWED_STEP_FILE_PREFIXES.join(", ")})`,
    );
  }
}

export type ResolvedSubagent = "Explore" | "Full" | "bash" | "orchestrator" | "unknown";

export interface RenderShowOptions {
  bodies?: boolean;
}

interface ResolvedStepFile {
  path: string;
  source: string;
}

interface ResolvedSubagentInfo {
  subagent: ResolvedSubagent;
  provenance: string;
}

function resolveStepFile(step: StepDefinition): ResolvedStepFile {
  if (step.stepFile !== undefined) {
    return { path: step.stepFile, source: "explicit (stepFile)" };
  }
  if (step.name === "plan-fix") {
    return {
      path: join(PACKAGE_ROOT, PLAN_FIX_STEP_FILE),
      source: "builtin-table (plan-fix special)",
    };
  }
  const builtin = BUILTIN_STEP_FILES[step.agent];
  if (builtin !== undefined) {
    return { path: join(PACKAGE_ROOT, builtin), source: "builtin-table" };
  }
  return { path: "(unresolved)", source: "unknown" };
}

/**
 * Resolve a step file path safely for filesystem reading (used by `--bodies`).
 *
 * For explicit `step.stepFile` values, validate against ADR-2026-04-22 loader rules
 * (no parent traversal, no absolute paths, must start with allowed prefix) and resolve
 * relative to PACKAGE_ROOT for builtin-prefixed paths or process.cwd() for .dev-vault/.
 *
 * For builtin-table entries (no `stepFile`), return the absolute path as-is — these are
 * trusted, derived from a static table of in-package templates.
 *
 * Returns null when the step file is unresolved (custom agent, no stepFile).
 */
function resolveStepFileForRead(step: StepDefinition): string | null {
  if (step.stepFile !== undefined) {
    validateStepFilePath(step.stepFile);
    if (step.stepFile.startsWith("templates/claude/commands/workflow/steps/")) {
      return join(PACKAGE_ROOT, step.stepFile);
    }
    return join(process.cwd(), step.stepFile);
  }
  if (step.name === "plan-fix") {
    return join(PACKAGE_ROOT, PLAN_FIX_STEP_FILE);
  }
  const builtin = BUILTIN_STEP_FILES[step.agent];
  if (builtin !== undefined) {
    return join(PACKAGE_ROOT, builtin);
  }
  return null;
}

function resolveSubagent(step: StepDefinition): ResolvedSubagentInfo {
  if (step.subagent !== undefined) {
    return { subagent: step.subagent, provenance: "explicit" };
  }
  if (ORCHESTRATOR_AGENTS.has(step.agent)) {
    return { subagent: "orchestrator", provenance: "(orchestrator-only)" };
  }
  if (EXPLORE_AGENTS.has(step.agent)) {
    return { subagent: "Explore", provenance: `by agent="${step.agent}"` };
  }
  if (FULL_AGENTS.has(step.agent)) {
    return { subagent: "Full", provenance: `by agent="${step.agent}"` };
  }
  if (step.agent === "tester") {
    return { subagent: "bash", provenance: `by agent="${step.agent}"` };
  }
  return { subagent: "unknown", provenance: "(custom agent — unresolved)" };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    return `[${value.join(", ")}]`;
  }
  if (typeof value === "string" && value.length === 0) return "(none)";
  return String(value);
}

function formatSubagentLabel(info: ResolvedSubagentInfo): string {
  if (info.subagent === "orchestrator") return "orchestrator-only, no subagent";
  return info.subagent;
}

function workflowKind(wf: WorkflowDefinition): string {
  // Builtin names from src/workflow/builtin.ts BUILTIN_WORKFLOWS map
  const builtinNames = new Set(["dev", "hotfix", "review", "test", "intake"]);
  return builtinNames.has(wf.name) ? "built-in" : "custom";
}

function formatStepFileBody(stepIndex: number, name: string, absolutePath: string): string {
  const lines: string[] = [];
  let body: string;
  let bytes = 0;
  try {
    body = readFileSync(absolutePath, "utf-8");
    bytes = Buffer.byteLength(body, "utf-8");
  } catch {
    lines.push(`▼ [${stepIndex}] ${name} — ${absolutePath}`);
    lines.push(SUBSEPARATOR);
    lines.push("(file not readable)");
    lines.push(SUBSEPARATOR);
    return lines.join("\n");
  }
  lines.push(`▼ [${stepIndex}] ${name} — ${absolutePath} (${bytes} bytes)`);
  lines.push(SUBSEPARATOR);
  const bodyLines = body.split("\n");
  // Drop trailing empty line introduced by terminal newline
  if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
  const width = String(bodyLines.length).length;
  for (let i = 0; i < bodyLines.length; i++) {
    const num = String(i + 1).padStart(width, " ");
    lines.push(`${num} ${bodyLines[i]}`);
  }
  lines.push(SUBSEPARATOR);
  return lines.join("\n");
}

export function renderShow(wf: WorkflowDefinition, options: RenderShowOptions = {}): string {
  const lines: string[] = [];
  lines.push(SEPARATOR);
  lines.push(`  Workflow: ${wf.name} (${workflowKind(wf)})`);
  lines.push(SEPARATOR);
  lines.push(`Description: ${wf.description}`);
  lines.push(`Match: ${formatValue(wf.match)}`);
  lines.push("");
  lines.push(`Steps (${wf.steps.length}):`);
  lines.push("");

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i]!;
    const subagentInfo = resolveSubagent(step);
    const stepFileInfo = resolveStepFile(step);
    const subagentLabel = formatSubagentLabel(subagentInfo);
    const headerSuffix = subagentInfo.subagent === "orchestrator"
      ? `(orchestrator, ${step.agent})`
      : `(${subagentInfo.subagent}, ${step.agent})`;
    lines.push(`[${i}] ${step.name} ${headerSuffix}`);
    lines.push(`    Step file: ${stepFileInfo.path}`);
    lines.push(`    Subagent: ${subagentLabel}`);
    lines.push(`    Gate: ${step.gate}`);
    lines.push(`    OnFail: ${step.onFail !== null ? `→ ${step.onFail}` : "(abort)"}`);
    lines.push(`    Input: ${formatValue(step.input)}`);
    lines.push(`    Output block: ${step.outputBlock !== undefined ? step.outputBlock : "(default)"}`);
    lines.push(`    Max attempts: ${step.maxAttempts}`);
    lines.push("");
  }

  if (options.bodies === true) {
    lines.push(SEPARATOR);
    lines.push("Step file bodies:");
    lines.push(SEPARATOR);
    lines.push("");
    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i]!;
      const readablePath = resolveStepFileForRead(step);
      if (readablePath === null) {
        const displayInfo = resolveStepFile(step);
        lines.push(`▼ [${i}] ${step.name} — ${displayInfo.path}`);
        lines.push(SUBSEPARATOR);
        lines.push("(file not readable)");
        lines.push(SUBSEPARATOR);
      } else {
        lines.push(formatStepFileBody(i, step.name, readablePath));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function hasPlanReviewer(wf: WorkflowDefinition): boolean {
  return wf.steps.some((step) => step.agent === "plan-reviewer");
}

function hasFixCoder(wf: WorkflowDefinition): boolean {
  return wf.steps.some((step) => step.agent === "coder" && step.name.endsWith("-fix"));
}

export function renderGraphMermaid(wf: WorkflowDefinition): string {
  const lines: string[] = ["flowchart TD"];

  for (let i = 0; i < wf.steps.length - 1; i++) {
    const from = escapeMermaidId(wf.steps[i]!.name);
    const to = escapeMermaidId(wf.steps[i + 1]!.name);
    lines.push(`    ${from} --> ${to}`);
  }

  for (const step of wf.steps) {
    if (step.onFail !== null) {
      const stepId = escapeMermaidId(step.name);
      const onFailId = escapeMermaidId(step.onFail);
      lines.push(`    ${stepId} -.->|onFail| ${onFailId}`);
    }
  }

  if (hasPlanReviewer(wf) && hasFixCoder(wf)) {
    lines.push(
      "    %% Runtime Next: directive can route plan-review → *-fix (whitelist: agent=coder + name ends with -fix)",
    );
  }

  return lines.join("\n");
}

export function renderGraphAscii(wf: WorkflowDefinition): string {
  const lines: string[] = [];
  const NAME_WIDTH = 15;

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i]!;
    const subagentInfo = resolveSubagent(step);
    const padded = step.name.padEnd(NAME_WIDTH, " ");
    const detailParts: string[] = [];
    if (step.gate !== "none") detailParts.push(`gate: ${step.gate}`);
    if (step.input.length > 0) detailParts.push(`input: ${formatValue(step.input)}`);
    const detailSuffix = detailParts.length > 0 ? `    ${detailParts.join("    ")}` : "";
    lines.push(
      `[${i}] ${padded}   (${subagentInfo.subagent}, ${step.agent})${detailSuffix}`,
    );
    if (i < wf.steps.length - 1) {
      lines.push("       │ next");
    }
    if (step.onFail !== null) {
      lines.push(`       │ onFail → ${step.onFail}`);
    }
  }

  lines.push("");
  lines.push("Legend:");
  lines.push("  next     — sequential edge");
  lines.push("  onFail   — failure redirect to named step");
  lines.push("  Next:    — runtime override (plan-reviewer → coder ending in -fix only)");

  return lines.join("\n");
}

interface EffectiveConfig {
  agent: string;
  gate: string;
  onFail: string | null;
  maxAttempts: number;
  input?: string[];
  outputBlock?: string;
  subagent?: string;
  stepFile?: string;
  gateCommand?: string;
}

function buildEffectiveConfig(step: StepDefinition): EffectiveConfig {
  const config: EffectiveConfig = {
    agent: step.agent,
    gate: step.gate,
    onFail: step.onFail,
    maxAttempts: step.maxAttempts,
  };
  if (step.input.length > 0) config.input = step.input;
  if (step.outputBlock !== undefined) config.outputBlock = step.outputBlock;
  if (step.subagent !== undefined) config.subagent = step.subagent;
  if (step.stepFile !== undefined) config.stepFile = step.stepFile;
  if (step.gateCommand !== undefined) config.gateCommand = step.gateCommand;
  return config;
}

export function renderEffective(wf: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${wf.name} (${workflowKind(wf)})`);
  lines.push("");

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i]!;
    const stepFileInfo = resolveStepFile(step);
    const subagentInfo = resolveSubagent(step);
    const effective = buildEffectiveConfig(step);
    lines.push(`[${i}] ${step.name}`);
    lines.push(`    Resolved step file: ${stepFileInfo.path}  (${stepFileInfo.source})`);
    lines.push(`    Resolved subagent: ${subagentInfo.subagent}  (${subagentInfo.provenance})`);
    lines.push(`    Effective config: ${JSON.stringify(effective)}`);
    lines.push("");
  }

  return lines.join("\n");
}
