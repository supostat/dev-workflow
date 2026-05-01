import { createHash } from "node:crypto";
import { relative } from "node:path";
import { engramSearch, engramStore } from "../lib/engram.js";

const TYPE_TO_MEMORY_TYPE: Record<string, string> = {
  adr: "decision",
  bug: "antipattern",
  debt: "antipattern",
};

export interface VaultMirrorResult {
  stored: boolean;
  skipped: boolean;
  memoryId: string | null;
}

export interface VaultMirrorArgs {
  type: string;
  title: string;
  content: string;
  filepath: string;
  projectRoot: string;
  projectName: string;
  /**
   * Auto-tags inherited from the engram proxy (step:/branch:/task:/run:).
   * Computed by the caller via buildAutoTags(loadPipelineContext(ctx)).
   * Empty when called outside an active workflow run.
   */
  autoTags: string[];
}

export async function mirrorVaultRecord(args: VaultMirrorArgs): Promise<VaultMirrorResult> {
  const memoryType = TYPE_TO_MEMORY_TYPE[args.type];
  if (!memoryType) {
    return { stored: false, skipped: false, memoryId: null };
  }

  const contentHash = createHash("sha256").update(args.content).digest("hex").slice(0, 12);
  const relativePath = relative(args.projectRoot, args.filepath);
  const sourceTag = `vault-source:${relativePath}`;
  const hashTag = `vault-content-hash:${contentHash}`;

  const existing = await engramSearch(relativePath, args.projectName, 5, [sourceTag]);
  // Dedup: substring-match on memory.tags string. Works for both CSV
  // (legacy daemon records) and JSON-stringified arrays (post-fix). Per-tag
  // validation rejects `,` and `\n` in individual tag values, so the
  // sourceTag string appears literally inside both representations and
  // matches via substring search. After engram-team's auto-migration on
  // daemon startup, all records will be JSON; the substring match remains
  // correct.
  const matches = existing.filter(
    (memory) => memory.tags.includes(sourceTag) && memory.tags.includes(hashTag),
  );
  if (matches.length > 0) {
    return { stored: false, skipped: true, memoryId: matches[0]!.id };
  }

  const tags = [
    args.projectName,
    `vault-type:${args.type}`,
    sourceTag,
    hashTag,
    ...args.autoTags,
  ];

  const memoryId = await engramStore(
    `${args.type.toUpperCase()} recorded: ${args.title}`,
    args.content.slice(0, 500),
    `Recorded in ${relativePath}`,
    memoryType,
    tags,
    args.projectName,
  );

  return { stored: memoryId !== null, skipped: false, memoryId };
}
