import { join } from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";

export function templatesRoot(): void {
  console.log(join(PACKAGE_ROOT, "templates"));
}
