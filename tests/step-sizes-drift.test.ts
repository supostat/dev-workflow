import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import { computeStepSizes, stepSizesByName } from "../src/lib/step-file-sizes.js";

describe("docs-invariant: committed step-sizes snapshot", () => {
  it("src/generated/step-sizes.json deep-equals a fresh step-name-keyed computeStepSizes of the step bodies", () => {
    const stepsDir = join(
      PACKAGE_ROOT,
      "templates",
      "claude",
      "skills",
      "workflow__dev",
      "steps",
    );
    const committed = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "src", "generated", "step-sizes.json"), "utf-8"),
    );

    expect(committed).toEqual(stepSizesByName(computeStepSizes(stepsDir)));
  });
});
