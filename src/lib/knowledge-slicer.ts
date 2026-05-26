// Canonical registry of knowledge.md sub-section addresses → their literal
// `## <header>` text. Used by VaultReader.readKnowledgeSection (slice) and the
// vault_read tool enum (one knowledge:<key> entry per key). Adding a key here
// is the single source of truth for a new addressable slice.
export const KNOWLEDGE_SUB_SECTIONS: ReadonlyMap<string, string> = new Map([
  ["architecture", "Architecture"],
  ["gotchas", "Gotchas"],
  ["security", "Security"],
  ["patterns", "Patterns"],
  ["engram", "Engram"],
]);

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Extract a single `## <header>` section body (header line included) from a
// markdown source. Returns null if the header is absent. Mirrors the boundary
// logic in VaultWriter.appendToSection (writer.ts) — divergent return contracts
// (writer computes an insertion offset, reader extracts text) prevent sharing.
//
// Both the header find and the next-section boundary are line-anchored to
// column-0 line starts (`^## ` with multiline flag), and the header is
// end-anchored (`$`) so a body bullet mentioning `## <header>` mid-line is not
// matched and a shorter header is not matched by a longer one's prefix.
//
// Inherited false-boundary limitation: the `^## ` next-section detection does
// NOT understand code fences. A line starting at column 0 with `## ` inside a
// fenced block is treated as a false section boundary and truncates the slice
// early. This is a KNOWN limitation, not fixed here — it is guarded by the
// fence-free invariant test that asserts knowledge.md carries no body `## ` line
// outside the canonical headers.
//
// Normalization note: sliced reads are `trimEnd() + "\n"` normalized (trailing
// whitespace collapsed to a single newline), unlike the whole-section
// VaultReader.readKnowledge() which returns file bytes verbatim. No current
// consumer relies on byte-exact slice output; documented for future callers.
export function sliceMarkdownSection(source: string, header: string): string | null {
  const headerMatch = source.match(new RegExp(`^## ${escapeRegExp(header)}$`, "m"));
  if (headerMatch?.index === undefined) return null;
  const startIndex = headerMatch.index;
  const afterHeader = startIndex + headerMatch[0].length;
  const nextMatch = source.slice(afterHeader).match(/^## /m);
  const end = nextMatch?.index === undefined ? source.length : afterHeader + nextMatch.index;
  return source.slice(startIndex, end).trimEnd() + "\n";
}
