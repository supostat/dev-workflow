import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeStepSizes, stepSizesByName } from "../lib/step-file-sizes.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

const STEPS_DIR = join(
  PACKAGE_ROOT,
  "templates",
  "claude",
  "skills",
  "workflow__dev",
  "steps",
);

const OUTPUT_TARGETS = [
  join(PACKAGE_ROOT, "src", "generated", "step-sizes.json"),
  join(PACKAGE_ROOT, "dist", "generated", "step-sizes.json"),
];

const sizes = stepSizesByName(computeStepSizes(STEPS_DIR));
const serialized = JSON.stringify(sizes, null, 2) + "\n";

for (const target of OUTPUT_TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized, "utf-8");
}

console.log(`step-sizes: indexed ${Object.keys(sizes).length} pipeline steps`);
