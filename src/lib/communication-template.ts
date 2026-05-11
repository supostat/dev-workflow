import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./package-root.js";

export function readCommunicationTemplate(): string {
  const templatePath = join(PACKAGE_ROOT, "templates", "project", "communication-yaml.example");
  return readFileSync(templatePath, "utf-8");
}
