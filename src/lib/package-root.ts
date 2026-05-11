import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
);
