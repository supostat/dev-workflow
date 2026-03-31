import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface ConventionsInfo {
  fileStructure: string[];
  naming: string[];
  codeStyle: string[];
  patterns: string[];
  git: string[];
  testing: string[];
}

const SKIP_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", "out", "target",
  "__pycache__", "coverage",
]);

function findAllFiles(projectRoot: string, filename: string, maxDepth: number = 4): string[] {
  const found: string[] = [];

  function scan(directory: string, depth: number): void {
    if (depth > maxDepth) return;
    const filePath = join(directory, filename);
    if (existsSync(filePath)) found.push(filePath);

    if (depth < maxDepth) {
      let entries;
      try { entries = readdirSync(directory, { withFileTypes: true }); }
      catch { return; }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        scan(join(directory, entry.name), depth + 1);
      }
    }
  }

  scan(projectRoot, 0);
  return found;
}

function readJsonOrNull(filepath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filepath)) return null;
    return JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileOrNull(filepath: string): string | null {
  try {
    if (!existsSync(filepath)) return null;
    return readFileSync(filepath, "utf-8");
  } catch {
    return null;
  }
}

function detectFromTsconfigs(projectRoot: string, conventions: ConventionsInfo): void {
  const tsconfigPaths = findAllFiles(projectRoot, "tsconfig.json");

  for (const tsconfigPath of tsconfigPaths) {
    const tsconfig = readJsonOrNull(tsconfigPath);
    if (!tsconfig) continue;

    const compilerOptions = tsconfig["compilerOptions"] as Record<string, unknown> | undefined;
    if (!compilerOptions) continue;

    if (compilerOptions["strict"] === true) conventions.codeStyle.push("TypeScript strict mode enabled");
    if (compilerOptions["noUncheckedIndexedAccess"] === true) conventions.codeStyle.push("noUncheckedIndexedAccess: indexed access requires undefined check");
    if (compilerOptions["noUnusedLocals"] === true) conventions.codeStyle.push("No unused local variables allowed");
    if (compilerOptions["noUnusedParameters"] === true) conventions.codeStyle.push("No unused parameters allowed");
    if (compilerOptions["exactOptionalPropertyTypes"] === true) conventions.codeStyle.push("Exact optional property types");

    const module = compilerOptions["module"] as string | undefined;
    if (module) conventions.codeStyle.push(`Module system: ${module}`);

    const rootDir = compilerOptions["rootDir"] as string | undefined;
    const outDir = compilerOptions["outDir"] as string | undefined;
    if (rootDir && outDir) {
      conventions.fileStructure.push(`Source in ${rootDir}/, output in ${outDir}/`);
    }

    break; // first tsconfig is enough for conventions
  }
}

function detectFromRust(projectRoot: string, conventions: ConventionsInfo): void {
  const cargoPaths = findAllFiles(projectRoot, "Cargo.toml");

  for (const cargoPath of cargoPaths) {
    const content = readFileOrNull(cargoPath);
    if (!content) continue;

    const edition = content.match(/^edition\s*=\s*"(\d+)"/m);
    if (edition) {
      conventions.codeStyle.push(`Rust edition: ${edition[1]}`);
      break;
    }
  }

  // rustfmt
  const rustfmtPaths = [
    join(projectRoot, "rustfmt.toml"),
    join(projectRoot, ".rustfmt.toml"),
  ];
  for (const rustfmtPath of rustfmtPaths) {
    const content = readFileOrNull(rustfmtPath);
    if (!content) continue;

    const rules: string[] = [];
    const edition = content.match(/edition\s*=\s*"?(\d+)"?/);
    if (edition) rules.push(`edition ${edition[1]}`);
    const maxWidth = content.match(/max_width\s*=\s*(\d+)/);
    if (maxWidth) rules.push(`max width ${maxWidth[1]}`);
    const tabSpaces = content.match(/tab_spaces\s*=\s*(\d+)/);
    if (tabSpaces) rules.push(`tab spaces ${tabSpaces[1]}`);
    const useSmallHeuristics = content.match(/use_small_heuristics\s*=\s*"?(\w+)"?/);
    if (useSmallHeuristics) rules.push(`heuristics: ${useSmallHeuristics[1]}`);

    if (rules.length > 0) {
      conventions.codeStyle.push(`rustfmt: ${rules.join(", ")}`);
    } else {
      conventions.codeStyle.push("rustfmt configured");
    }
    break;
  }

  // clippy
  const clippyPaths = [
    join(projectRoot, "clippy.toml"),
    join(projectRoot, ".clippy.toml"),
  ];
  for (const clippyPath of clippyPaths) {
    if (existsSync(clippyPath)) {
      conventions.codeStyle.push("Clippy configured");
      break;
    }
  }

  // cargo-deny
  if (existsSync(join(projectRoot, "deny.toml"))) {
    conventions.codeStyle.push("cargo-deny: dependency audit configured");
  }
}

function detectFromEditorconfig(projectRoot: string, conventions: ConventionsInfo): void {
  const editorConfigPath = join(projectRoot, ".editorconfig");
  const content = readFileOrNull(editorConfigPath);
  if (!content) return;

  const indentStyle = content.match(/indent_style\s*=\s*(\w+)/);
  const indentSize = content.match(/indent_size\s*=\s*(\w+)/);
  if (indentStyle) {
    const size = indentSize ? `, size ${indentSize[1]}` : "";
    conventions.codeStyle.push(`Indent: ${indentStyle[1]}${size}`);
  }

  const endOfLine = content.match(/end_of_line\s*=\s*(\w+)/);
  if (endOfLine) conventions.codeStyle.push(`Line endings: ${endOfLine[1]}`);
}

function detectFromPackageJsons(projectRoot: string, conventions: ConventionsInfo): void {
  const packagePaths = findAllFiles(projectRoot, "package.json");

  for (const packagePath of packagePaths) {
    const packageJson = readJsonOrNull(packagePath);
    if (!packageJson) continue;

    const scripts = packageJson["scripts"] as Record<string, string> | undefined;
    if (scripts) {
      if (scripts["lint"]) conventions.codeStyle.push(`Lint: ${scripts["lint"]}`);
      if (scripts["test"]) conventions.testing.push(`Test: ${scripts["test"]}`);
      if (scripts["build"]) conventions.patterns.push(`Build: ${scripts["build"]}`);
      if (scripts["format"]) conventions.codeStyle.push(`Format: ${scripts["format"]}`);
      if (scripts["check"]) conventions.codeStyle.push(`Check: ${scripts["check"]}`);
    }

    const type = packageJson["type"] as string | undefined;
    if (type === "module") conventions.patterns.push("ESM modules (type: module)");
  }
}

function detectFromPrettier(projectRoot: string, conventions: ConventionsInfo): void {
  const names = [".prettierrc", ".prettierrc.json", ".prettierrc.yml"];
  for (const name of names) {
    const paths = findAllFiles(projectRoot, name, 1);
    for (const configPath of paths) {
      const config = readJsonOrNull(configPath);
      if (!config) continue;

      const rules: string[] = [];
      if (config["semi"] === false) rules.push("no semicolons");
      if (config["singleQuote"] === true) rules.push("single quotes");
      if (config["tabWidth"]) rules.push(`tab width: ${config["tabWidth"]}`);
      if (config["trailingComma"]) rules.push(`trailing comma: ${config["trailingComma"]}`);
      if (config["printWidth"]) rules.push(`print width: ${config["printWidth"]}`);

      if (rules.length > 0) {
        conventions.codeStyle.push(`Prettier: ${rules.join(", ")}`);
      }
      return;
    }
  }
}

function detectFromBiome(projectRoot: string, conventions: ConventionsInfo): void {
  const biomePath = join(projectRoot, "biome.json");
  if (!existsSync(biomePath)) return;
  conventions.codeStyle.push("Biome configured (formatter + linter)");
}

function detectTestPatterns(projectRoot: string, conventions: ConventionsInfo): void {
  const vitestPaths = findAllFiles(projectRoot, "vitest.config.ts", 2);
  const vitestJsPaths = findAllFiles(projectRoot, "vitest.config.js", 2);
  if (vitestPaths.length > 0 || vitestJsPaths.length > 0) {
    conventions.testing.push("Test framework: Vitest");
  }

  const jestPaths = findAllFiles(projectRoot, "jest.config.ts", 2);
  const jestJsPaths = findAllFiles(projectRoot, "jest.config.js", 2);
  if (jestPaths.length > 0 || jestJsPaths.length > 0) {
    conventions.testing.push("Test framework: Jest");
  }

  // Rust tests
  const cargoPaths = findAllFiles(projectRoot, "Cargo.toml");
  for (const cargoPath of cargoPaths) {
    const content = readFileOrNull(cargoPath);
    if (content && content.includes("[dev-dependencies]")) {
      conventions.testing.push("Rust: dev-dependencies configured (test deps)");
      break;
    }
  }

  const testsDirExists = findAllFiles(projectRoot, "tests", 2).length > 0
    || existsSync(join(projectRoot, "tests"))
    || existsSync(join(projectRoot, "__tests__"));

  if (testsDirExists) conventions.testing.push("Tests in dedicated directory");
}

function detectGitConventions(projectRoot: string, conventions: ConventionsInfo): void {
  if (existsSync(join(projectRoot, ".gitignore"))) {
    conventions.git.push(".gitignore configured");
  }
  if (existsSync(join(projectRoot, ".husky"))) {
    conventions.git.push("Husky git hooks");
  }
  if (existsSync(join(projectRoot, ".commitlintrc.json")) || existsSync(join(projectRoot, ".commitlintrc.yml"))) {
    conventions.git.push("Commitlint configured");
  }

  // Lefthook
  const lefthookPaths = ["lefthook.yml", "lefthook.yaml", ".lefthook.yml"];
  for (const name of lefthookPaths) {
    const content = readFileOrNull(join(projectRoot, name));
    if (!content) continue;

    conventions.git.push("Lefthook git hooks");

    const hooks: string[] = [];
    if (content.includes("pre-commit:")) hooks.push("pre-commit");
    if (content.includes("pre-push:")) hooks.push("pre-push");
    if (content.includes("commit-msg:")) hooks.push("commit-msg");
    if (content.includes("post-checkout:")) hooks.push("post-checkout");
    if (content.includes("post-merge:")) hooks.push("post-merge");

    if (hooks.length > 0) {
      conventions.git.push(`Git hooks: ${hooks.join(", ")}`);
    }
    break;
  }
}

function deduplicate(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

export function detectConventions(projectRoot: string): ConventionsInfo {
  const conventions: ConventionsInfo = {
    fileStructure: [],
    naming: [],
    codeStyle: [],
    patterns: [],
    git: [],
    testing: [],
  };

  detectFromTsconfigs(projectRoot, conventions);
  detectFromRust(projectRoot, conventions);
  detectFromEditorconfig(projectRoot, conventions);
  detectFromPackageJsons(projectRoot, conventions);
  detectFromPrettier(projectRoot, conventions);
  detectFromBiome(projectRoot, conventions);
  detectTestPatterns(projectRoot, conventions);
  detectGitConventions(projectRoot, conventions);

  conventions.fileStructure = deduplicate(conventions.fileStructure);
  conventions.naming = deduplicate(conventions.naming);
  conventions.codeStyle = deduplicate(conventions.codeStyle);
  conventions.patterns = deduplicate(conventions.patterns);
  conventions.git = deduplicate(conventions.git);
  conventions.testing = deduplicate(conventions.testing);

  return conventions;
}

export function renderConventionsMarkdown(projectName: string, conventions: ConventionsInfo): string {
  const today = new Date().toISOString().slice(0, 10);
  const sections: string[] = [
    `---`,
    `updated: ${today}`,
    `tags: [conventions, ${projectName}]`,
    `---`,
    `# ${projectName} — Conventions`,
  ];

  const categories: Array<[string, string[]]> = [
    ["File Structure", conventions.fileStructure],
    ["Naming", conventions.naming],
    ["Code Style", conventions.codeStyle],
    ["Patterns", conventions.patterns],
    ["Git", conventions.git],
    ["Testing", conventions.testing],
  ];

  for (const [title, items] of categories) {
    sections.push("", `## ${title}`);
    if (items.length > 0) {
      for (const item of items) {
        sections.push(`- ${item}`);
      }
    }
  }

  return sections.join("\n") + "\n";
}
