import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { detectContext } from "../lib/context.js";
import { writeFileSafe } from "../lib/fs-helpers.js";

interface VaultExport {
  version: 1;
  projectName: string;
  exportedAt: string;
  files: Record<string, string>;
}

function collectFiles(directory: string, basePath: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(directory)) return files;

  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith(".md") || entry.name.endsWith(".json")) {
        const relativePath = relative(basePath, fullPath);
        files[relativePath] = readFileSync(fullPath, "utf-8");
      }
    }
  }

  scan(directory);
  return files;
}

export function exportVault(args: string[]): void {
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

  const outputPath = args[0] ?? "vault-export.json";
  const files = collectFiles(context.vaultPath, context.vaultPath);

  const exportData: VaultExport = {
    version: 1,
    projectName: context.projectName,
    exportedAt: new Date().toISOString(),
    files,
  };

  writeFileSync(outputPath, JSON.stringify(exportData, null, 2), "utf-8");
  console.log(`Exported ${Object.keys(files).length} files → ${outputPath}`);
}

export function importVault(args: string[]): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const inputPath = args[0];
  if (!inputPath || !existsSync(inputPath)) {
    console.error("Usage: dev-workflow import <vault-export.json>");
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(inputPath, "utf-8");
  const exportData = JSON.parse(raw) as VaultExport;

  if (exportData.version !== 1) {
    console.error(`Unsupported export version: ${exportData.version}`);
    process.exitCode = 1;
    return;
  }

  let imported = 0;
  for (const [relativePath, content] of Object.entries(exportData.files)) {
    const targetPath = join(context.vaultPath, relativePath);
    writeFileSafe(targetPath, content);
    imported++;
  }

  console.log(`Imported ${imported} files from ${exportData.projectName} (${exportData.exportedAt})`);
}
