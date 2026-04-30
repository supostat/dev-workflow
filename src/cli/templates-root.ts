import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

export function templatesRoot(): void {
  console.log(join(PACKAGE_ROOT, "templates"));
}
