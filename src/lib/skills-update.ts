import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { hashFile } from "./spec-hash.js";
import { walkFiles } from "./fs-walk.js";

export interface SkillsUpdateResult {
  added: number;
  skipped: number;
}

/**
 * Update skills directory additively. Per-file logic:
 *
 *  - Target missing → copy (counts as added).
 *  - Target exists, sha256(template) === sha256(target) → no-op / skip
 *    (file is byte-identical to bundled version, nothing is written).
 *  - Target exists, hashes differ → SKIP, emit stderr warning
 *    `note: skipping user-modified skill <relative-path>`, count as skipped.
 *
 * Used by `dev-workflow update` to honour the "never overwrite user-modified
 * files" invariant from the commands-to-skills spec. The same invariant could
 * apply to commands and agents but is currently scoped to skills only.
 */
export function updateSkillsAdditively(
  templateDir: string,
  targetDir: string,
): SkillsUpdateResult {
  const result: SkillsUpdateResult = { added: 0, skipped: 0 };
  if (!existsSync(templateDir)) return result;

  for (const filepath of walkFiles(templateDir)) {
    const rel = relative(templateDir, filepath);
    const target = join(targetDir, rel);

    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(filepath, target);
      result.added++;
      continue;
    }

    if (hashFile(filepath) === hashFile(target)) {
      // Bundled and on-disk versions are byte-identical — no work to do.
      continue;
    }

    process.stderr.write(`note: skipping user-modified skill ${rel}\n`);
    result.skipped++;
  }

  return result;
}
