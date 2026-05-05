import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

export function readSpecTemplate(): string {
  const templatePath = join(PACKAGE_ROOT, "templates", "project", "spec-md.example");
  return readFileSync(templatePath, "utf-8");
}
