import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { detectContext } from "../lib/context.js";

interface SearchResult {
  file: string;
  line: number;
  context: string;
}

function searchDirectory(directory: string, query: string, basePath: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  function scan(dir: string): void {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.toLowerCase().includes(lowerQuery)) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            results.push({
              file: relative(basePath, fullPath),
              line: i + 1,
              context: lines.slice(start, end).join("\n"),
            });
          }
        }
      }
    }
  }

  scan(directory);
  return results;
}

export function search(query: string): void {
  if (!query) {
    console.error("Usage: dev-workflow search \"query\"");
    process.exitCode = 1;
    return;
  }

  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  if (!existsSync(context.vaultPath)) {
    console.error("No vault found. Run 'dev-workflow init'.");
    process.exitCode = 1;
    return;
  }

  const results = searchDirectory(context.vaultPath, query, context.vaultPath);

  if (results.length === 0) {
    console.log(`No results for "${query}".`);
    return;
  }

  console.log(`Search: "${query}" — ${results.length} matches\n`);

  const grouped = new Map<string, SearchResult[]>();
  for (const result of results) {
    const dir = result.file.split("/")[0] ?? result.file;
    const existing = grouped.get(dir) ?? [];
    existing.push(result);
    grouped.set(dir, existing);
  }

  for (const [group, groupResults] of grouped) {
    console.log(`### ${group}`);
    for (const result of groupResults) {
      console.log(`  ${result.file}:${result.line}`);
      const indented = result.context.split("\n").map((line) => `    ${line}`).join("\n");
      console.log(indented);
      console.log();
    }
  }
}
