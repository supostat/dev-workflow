import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ConventionsInfo {
  fileStructure: string[];
  naming: string[];
  codeStyle: string[];
  patterns: string[];
  git: string[];
  testing: string[];
}

function readJsonOrNull(filepath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filepath)) return null;
    return JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectFromTsconfig(projectRoot: string, conventions: ConventionsInfo): void {
  const tsconfig = readJsonOrNull(join(projectRoot, "tsconfig.json"));
  if (!tsconfig) return;

  const compilerOptions = tsconfig["compilerOptions"] as Record<string, unknown> | undefined;
  if (!compilerOptions) return;

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
}

function detectFromEditorconfig(projectRoot: string, conventions: ConventionsInfo): void {
  const editorConfigPath = join(projectRoot, ".editorconfig");
  if (!existsSync(editorConfigPath)) return;

  const content = readFileSync(editorConfigPath, "utf-8");

  const indentStyle = content.match(/indent_style\s*=\s*(\w+)/);
  const indentSize = content.match(/indent_size\s*=\s*(\w+)/);
  if (indentStyle) {
    const size = indentSize ? `, size ${indentSize[1]}` : "";
    conventions.codeStyle.push(`Indent: ${indentStyle[1]}${size}`);
  }

  const endOfLine = content.match(/end_of_line\s*=\s*(\w+)/);
  if (endOfLine) conventions.codeStyle.push(`Line endings: ${endOfLine[1]}`);
}

function detectFromPackageJson(projectRoot: string, conventions: ConventionsInfo): void {
  const packageJson = readJsonOrNull(join(projectRoot, "package.json"));
  if (!packageJson) return;

  const scripts = packageJson["scripts"] as Record<string, string> | undefined;
  if (!scripts) return;

  if (scripts["lint"]) conventions.codeStyle.push(`Lint command: ${scripts["lint"]}`);
  if (scripts["test"]) conventions.testing.push(`Test command: ${scripts["test"]}`);
  if (scripts["build"]) conventions.patterns.push(`Build command: ${scripts["build"]}`);

  const type = packageJson["type"] as string | undefined;
  if (type === "module") conventions.patterns.push("ESM modules (type: module)");
}

function detectFromPrettier(projectRoot: string, conventions: ConventionsInfo): void {
  const paths = [".prettierrc", ".prettierrc.json", ".prettierrc.yml"];
  for (const path of paths) {
    const config = readJsonOrNull(join(projectRoot, path));
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
    break;
  }
}

function detectTestPatterns(projectRoot: string, conventions: ConventionsInfo): void {
  const vitestConfig = existsSync(join(projectRoot, "vitest.config.ts"))
    || existsSync(join(projectRoot, "vitest.config.js"));
  const jestConfig = existsSync(join(projectRoot, "jest.config.ts"))
    || existsSync(join(projectRoot, "jest.config.js"));

  if (vitestConfig) conventions.testing.push("Test framework: Vitest");
  if (jestConfig) conventions.testing.push("Test framework: Jest");

  const testDirExists = existsSync(join(projectRoot, "tests"))
    || existsSync(join(projectRoot, "__tests__"));
  const testColocated = existsSync(join(projectRoot, "src"));

  if (testDirExists) conventions.testing.push("Tests in dedicated directory");
  if (!testDirExists && testColocated) conventions.testing.push("Tests colocated with source");
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

  detectFromTsconfig(projectRoot, conventions);
  detectFromEditorconfig(projectRoot, conventions);
  detectFromPackageJson(projectRoot, conventions);
  detectFromPrettier(projectRoot, conventions);
  detectTestPatterns(projectRoot, conventions);
  detectGitConventions(projectRoot, conventions);

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
