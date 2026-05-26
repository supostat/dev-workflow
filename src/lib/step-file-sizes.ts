import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countTokens } from "./tokens.js";
import { PACKAGE_ROOT } from "./package-root.js";

export interface StepSize {
  tokens: number;
  chars: number;
}

export type StepSizes = Record<string, StepSize>;

const MARKDOWN_EXTENSION = ".md";

/**
 * Token-count every Markdown step body in `stepsDir`. The step name is the file
 * name without its `.md` extension; non-Markdown entries are ignored. Pure: the
 * only inputs are the directory contents, so build-time codegen and the
 * drift-guard test share one source of truth.
 */
export function computeStepSizes(stepsDir: string): StepSizes {
  const sizes: StepSizes = {};
  for (const entry of readdirSync(stepsDir)) {
    if (!entry.endsWith(MARKDOWN_EXTENSION)) continue;
    const stepName = entry.slice(0, -MARKDOWN_EXTENSION.length);
    const body = readFileSync(join(stepsDir, entry), "utf-8");
    sizes[stepName] = { tokens: countTokens(body), chars: body.length };
  }
  return sizes;
}

// Pipeline step name → step-file basename for the builtin `dev` workflow.
// Identity except `code` (its body is coder.md). Source of truth:
// templates/workflows/dev.yaml step.name + the dispatcher agent→step-file table
// in templates/claude/skills/workflow__dev/SKILL.md ("Step resolution").
// `principles.md` is a shared include, not a step, so it is intentionally absent.
// Update this constant if the builtin dev pipeline's step files change.
const STEP_FILE_BASENAME_BY_STEP: Record<string, string> = {
  preflight: "preflight", read: "read", plan: "plan", "plan-review": "plan-review",
  "plan-fix": "plan-fix", code: "coder", review: "review", test: "test",
  verify: "verify", commit: "commit", "vault-updates": "vault-updates",
};

/**
 * Re-key a basename-keyed `StepSizes` (output of `computeStepSizes`) to be keyed
 * by pipeline step name via `STEP_FILE_BASENAME_BY_STEP`. The `code` step maps
 * to coder.md's body; shared includes such as `principles.md` are dropped.
 *
 * Build-time only — fail-fast: a mapped basename absent from `byBasename` means a
 * step file was renamed or deleted, which must break the build rather than ship a
 * JSON that silently reports 0 tokens for that step.
 */
export function stepSizesByName(byBasename: StepSizes): StepSizes {
  const byName: StepSizes = {};
  for (const [stepName, basename] of Object.entries(STEP_FILE_BASENAME_BY_STEP)) {
    const size = byBasename[basename];
    if (size === undefined) {
      throw new Error(
        `stepSizesByName: step "${stepName}" maps to missing step-file basename "${basename}". ` +
          `Update STEP_FILE_BASENAME_BY_STEP or the dev pipeline's step files.`,
      );
    }
    byName[stepName] = size;
  }
  return byName;
}

// Read via readFileSync from dist/ — NEVER a static JSON import (tsc doesn't
// copy .json to dist; Node16-ESM would break in the published package).
const SHIPPED_SIZES_PATH = join(PACKAGE_ROOT, "dist", "generated", "step-sizes.json");

/**
 * Parse a generated step-sizes file. Fail-safe: any read or parse error yields
 * an empty map so the instrumentation degrades to 0-token records and never
 * bubbles. Exported for direct fail-safe coverage.
 */
export function parseSizesFile(path: string): StepSizes {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StepSizes;
  } catch {
    return {};
  }
}

let shippedSizesCache: StepSizes | null = null;

function loadShippedSizes(): StepSizes {
  if (shippedSizesCache === null) shippedSizesCache = parseSizesFile(SHIPPED_SIZES_PATH);
  return shippedSizesCache;
}

export function getStepBodyTokens(step: string): number {
  return loadShippedSizes()[step]?.tokens ?? 0;
}

export function getStepBodyChars(step: string): number {
  return loadShippedSizes()[step]?.chars ?? 0;
}
