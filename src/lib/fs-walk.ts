import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";

/**
 * Recursively yield every file path under `dir`, depth-first.
 *
 * Directories are descended into; only regular file paths are yielded.
 * Caller is responsible for ensuring `dir` exists — this generator throws
 * the underlying `readdirSync` ENOENT if it does not.
 */
export function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}
