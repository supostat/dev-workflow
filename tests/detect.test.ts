import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectStack, renderStackMarkdown } from "../src/lib/stack-detect.js";
import { detectConventions, renderConventionsMarkdown } from "../src/lib/conventions-detect.js";

function createTempProject(): string {
  const projectRoot = join(tmpdir(), `dev-vault-detect-test-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

describe("detectStack", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("detects TypeScript and Node.js from package.json", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      devDependencies: { typescript: "^6.0.2" },
      engines: { node: ">=20" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.languages).toContain("TypeScript ^6.0.2");
    expect(stack.languages).toContain("Node.js >=20");
  });

  it("detects frameworks from dependencies", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      dependencies: { react: "^19.0.0", next: "^15.0.0" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.frameworks.some((f) => f.includes("React"))).toBe(true);
    expect(stack.frameworks.some((f) => f.includes("Next.js"))).toBe(true);
  });

  it("detects test framework", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      devDependencies: { vitest: "^4.1.2" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.testing.some((t) => t.includes("Vitest"))).toBe(true);
  });

  it("detects database from dependencies", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      dependencies: { "@prisma/client": "^5.0.0" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.database.some((d) => d.includes("Prisma"))).toBe(true);
  });

  it("detects infrastructure", () => {
    writeFileSync(join(projectRoot, "Dockerfile"), "FROM node:20", "utf-8");
    mkdirSync(join(projectRoot, ".github", "workflows"), { recursive: true });

    const stack = detectStack(projectRoot);

    expect(stack.infrastructure).toContain("Docker");
    expect(stack.infrastructure).toContain("GitHub Actions");
  });

  it("detects Python from requirements.txt", () => {
    writeFileSync(join(projectRoot, "requirements.txt"), "flask==3.0.0", "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.languages).toContain("Python");
  });

  it("detects Go from go.mod", () => {
    writeFileSync(join(projectRoot, "go.mod"), "module example.com/app", "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.languages).toContain("Go");
  });

  it("detects Rust from Cargo.toml", () => {
    writeFileSync(join(projectRoot, "Cargo.toml"), "[package]\nname = \"app\"", "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.languages).toContain("Rust");
  });

  it("detects Rust in subdirectory (deep scan)", () => {
    const cliDir = join(projectRoot, "cli");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "Cargo.toml"), '[package]\nname = "my-cli"\nedition = "2021"', "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.languages.some((l) => l.includes("Rust"))).toBe(true);
    expect(stack.languages.some((l) => l.includes("2021"))).toBe(true);
  });

  it("detects Node.js in nested packages directory", () => {
    const pkgDir = join(projectRoot, "packages", "api");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
      dependencies: { express: "^5.0.0" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.frameworks.some((f) => f.includes("Express"))).toBe(true);
  });

  it("skips node_modules during deep scan", () => {
    const nmDir = join(projectRoot, "node_modules", "some-pkg");
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, "package.json"), JSON.stringify({
      dependencies: { react: "^19.0.0" },
    }), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.frameworks).toHaveLength(0);
  });

  it("parses Rust Cargo.toml dependencies", () => {
    writeFileSync(join(projectRoot, "Cargo.toml"), [
      '[package]',
      'name = "app"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'clap = "4.0"',
      'tokio = { version = "1.0", features = ["full"] }',
      'serde = "1.0"',
    ].join("\n"), "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.frameworks.some((f) => f.includes("Clap"))).toBe(true);
    expect(stack.frameworks.some((f) => f.includes("Tokio"))).toBe(true);
    expect(stack.frameworks.some((f) => f.includes("Serde"))).toBe(true);
  });

  it("detects lefthook", () => {
    writeFileSync(join(projectRoot, "lefthook.yml"), "pre-commit:", "utf-8");

    const stack = detectStack(projectRoot);

    expect(stack.devTools.some((t) => t.includes("Lefthook"))).toBe(true);
  });

  it("returns empty for project with no markers", () => {
    const stack = detectStack(projectRoot);

    expect(stack.languages).toHaveLength(0);
    expect(stack.frameworks).toHaveLength(0);
  });

  it("renderStackMarkdown produces valid markdown", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      devDependencies: { typescript: "^6.0.0", vitest: "^4.0.0" },
      engines: { node: ">=20" },
    }), "utf-8");

    const stack = detectStack(projectRoot);
    const markdown = renderStackMarkdown("test-project", stack);

    expect(markdown).toContain("# test-project — Stack");
    expect(markdown).toContain("## Languages");
    expect(markdown).toContain("TypeScript");
    expect(markdown).toContain("## Testing");
    expect(markdown).toContain("Vitest");
  });
});

describe("detectConventions", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("detects TypeScript strict mode from tsconfig", () => {
    writeFileSync(join(projectRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noUnusedLocals: true },
    }), "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.codeStyle).toContain("TypeScript strict mode enabled");
    expect(conventions.codeStyle).toContain("No unused local variables allowed");
  });

  it("detects editorconfig settings", () => {
    writeFileSync(join(projectRoot, ".editorconfig"), [
      "root = true",
      "[*]",
      "indent_style = space",
      "indent_size = 2",
    ].join("\n"), "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.codeStyle.some((s) => s.includes("space") && s.includes("2"))).toBe(true);
  });

  it("detects prettier config", () => {
    writeFileSync(join(projectRoot, ".prettierrc"), JSON.stringify({
      semi: false,
      singleQuote: true,
      tabWidth: 2,
    }), "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.codeStyle.some((s) => s.includes("Prettier"))).toBe(true);
  });

  it("detects test framework", () => {
    writeFileSync(join(projectRoot, "vitest.config.ts"), "export default {}", "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.testing).toContain("Test framework: Vitest");
  });

  it("detects scripts from package.json", () => {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "vitest run", build: "tsc" },
    }), "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.codeStyle.some((s) => s.includes("eslint"))).toBe(true);
    expect(conventions.testing.some((s) => s.includes("vitest"))).toBe(true);
  });

  it("detects git conventions", () => {
    writeFileSync(join(projectRoot, ".gitignore"), "node_modules/", "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.git).toContain(".gitignore configured");
  });

  it("detects tsconfig in subdirectory (deep scan)", () => {
    const subDir = join(projectRoot, "packages", "api");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true },
    }), "utf-8");

    const conventions = detectConventions(projectRoot);

    expect(conventions.codeStyle).toContain("TypeScript strict mode enabled");
  });

  it("renderConventionsMarkdown produces valid markdown", () => {
    writeFileSync(join(projectRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true },
    }), "utf-8");

    const conventions = detectConventions(projectRoot);
    const markdown = renderConventionsMarkdown("test-project", conventions);

    expect(markdown).toContain("# test-project — Conventions");
    expect(markdown).toContain("## Code Style");
    expect(markdown).toContain("strict mode");
  });
});
