import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

interface StackInfo {
  languages: string[];
  frameworks: string[];
  database: string[];
  testing: string[];
  infrastructure: string[];
  devTools: string[];
}

const SKIP_DIRS = new Set([
  "node_modules", "vendor", "bower_components",
  "dist", "build", "out", "target",
  "__pycache__", "coverage",
]);

const MARKER_NAMES = new Set([
  "Cargo.toml", "package.json", "go.mod", "go.work",
  "pyproject.toml", "requirements.txt",
  "Gemfile", "composer.json", "pubspec.yaml",
]);

function findProjectMarkers(root: string, maxDepth: number = 4): string[] {
  const found: string[] = [];

  function scan(directory: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.isFile() && MARKER_NAMES.has(entry.name)) {
        found.push(join(directory, entry.name));
      }
    }

    if (depth < maxDepth) {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        scan(join(directory, entry.name), depth + 1);
      }
    }
  }

  scan(root, 0);
  return found;
}

function readJsonOrNull(filepath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileOrNull(filepath: string): string | null {
  try {
    return readFileSync(filepath, "utf-8");
  } catch {
    return null;
  }
}

function processPackageJson(filepath: string, stack: StackInfo): void {
  const packageJson = readJsonOrNull(filepath);
  if (!packageJson) return;

  const allDeps = {
    ...((packageJson["dependencies"] as Record<string, string>) ?? {}),
    ...((packageJson["devDependencies"] as Record<string, string>) ?? {}),
  };

  const devDeps = (packageJson["devDependencies"] as Record<string, string>) ?? {};
  const engines = (packageJson["engines"] as Record<string, string>) ?? {};

  if (devDeps["typescript"]) stack.languages.push(`TypeScript ${devDeps["typescript"]}`);
  if (engines["node"]) stack.languages.push(`Node.js ${engines["node"]}`);

  const frameworkMap: Record<string, string> = {
    "react": "React", "next": "Next.js", "vue": "Vue", "nuxt": "Nuxt",
    "svelte": "Svelte", "express": "Express", "fastify": "Fastify",
    "nestjs": "NestJS", "@nestjs/core": "NestJS", "hono": "Hono",
    "astro": "Astro", "remix": "Remix", "@remix-run/node": "Remix",
  };

  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (allDeps[dep]) stack.frameworks.push(`${name} ${allDeps[dep]}`);
  }

  const dbMap: Record<string, string> = {
    "prisma": "Prisma", "@prisma/client": "Prisma",
    "drizzle-orm": "Drizzle", "typeorm": "TypeORM",
    "mongoose": "Mongoose", "pg": "PostgreSQL (pg)",
    "mysql2": "MySQL", "better-sqlite3": "SQLite",
    "redis": "Redis", "ioredis": "Redis (ioredis)",
  };

  for (const [dep, name] of Object.entries(dbMap)) {
    if (allDeps[dep]) stack.database.push(`${name} ${allDeps[dep]}`);
  }

  const testMap: Record<string, string> = {
    "vitest": "Vitest", "jest": "Jest", "mocha": "Mocha",
    "playwright": "Playwright", "cypress": "Cypress",
    "@testing-library/react": "Testing Library",
  };

  for (const [dep, name] of Object.entries(testMap)) {
    if (allDeps[dep]) stack.testing.push(`${name} ${allDeps[dep]}`);
  }

  const toolMap: Record<string, string> = {
    "eslint": "ESLint", "prettier": "Prettier", "biome": "Biome",
    "turbo": "Turborepo", "nx": "Nx", "lerna": "Lerna",
  };

  for (const [dep, name] of Object.entries(toolMap)) {
    if (allDeps[dep]) stack.devTools.push(`${name} ${allDeps[dep]}`);
  }

  const packageManager = packageJson["packageManager"] as string | undefined;
  if (packageManager) stack.devTools.push(packageManager);

  const workspaces = packageJson["workspaces"] as unknown;
  if (workspaces) stack.devTools.push("Monorepo (workspaces)");
}

function extractSection(content: string, header: string): string {
  const headerIndex = content.indexOf(header);
  if (headerIndex === -1) return "";
  const start = headerIndex + header.length;
  const nextSection = content.indexOf("\n[", start);
  return nextSection === -1 ? content.slice(start) : content.slice(start, nextSection);
}

function processCargoToml(filepath: string, stack: StackInfo): void {
  const content = readFileOrNull(filepath);
  if (!content) return;

  const edition = content.match(/^edition\s*=\s*"(\d+)"/m);
  stack.languages.push(edition ? `Rust ${edition[1]} edition` : "Rust");

  const dependenciesSection = extractSection(content, "[dependencies]");

  const rustFrameworkMap: Record<string, string> = {
    "clap": "Clap (CLI)", "tokio": "Tokio (async runtime)",
    "serde": "Serde (serialization)", "axum": "Axum (web)",
    "actix-web": "Actix (web)", "rocket": "Rocket (web)",
    "reqwest": "Reqwest (HTTP)", "hyper": "Hyper (HTTP)",
    "tracing": "Tracing (observability)", "anyhow": "Anyhow (errors)",
    "thiserror": "Thiserror (errors)", "tonic": "Tonic (gRPC)",
    "warp": "Warp (web)",
  };

  const rustDbMap: Record<string, string> = {
    "diesel": "Diesel (ORM)", "sqlx": "SQLx",
    "sea-orm": "SeaORM", "rusqlite": "Rusqlite (SQLite)",
    "redis": "Redis",
  };

  const rustTestMap: Record<string, string> = {
    "assert_cmd": "assert_cmd", "predicates": "predicates",
    "insta": "Insta (snapshots)", "criterion": "Criterion (bench)",
    "proptest": "Proptest", "mockall": "Mockall",
  };

  for (const [dep, label] of Object.entries(rustFrameworkMap)) {
    if (dependenciesSection.includes(dep)) stack.frameworks.push(label);
  }

  for (const [dep, label] of Object.entries(rustDbMap)) {
    if (dependenciesSection.includes(dep)) stack.database.push(label);
  }

  const devDepsSection = extractSection(content, "[dev-dependencies]");
  for (const [dep, label] of Object.entries(rustTestMap)) {
    if (devDepsSection.includes(dep)) stack.testing.push(label);
  }

  if (content.includes("[workspace]")) {
    stack.devTools.push("Cargo workspace");
  }
}

function processGoMod(filepath: string, stack: StackInfo): void {
  const content = readFileOrNull(filepath);
  if (!content) return;

  stack.languages.push("Go");

  const goVersion = content.match(/^go\s+(\d+\.\d+)/m);
  if (goVersion) stack.languages.push(`Go ${goVersion[1]}`);
}

function processPyproject(filepath: string, stack: StackInfo): void {
  stack.languages.push("Python");

  const content = readFileOrNull(filepath);
  if (!content) return;

  if (content.includes("[tool.poetry]")) stack.devTools.push("Poetry");
  if (content.includes("[tool.pytest]")) stack.testing.push("pytest");
  if (content.includes("[tool.ruff]")) stack.devTools.push("Ruff (linter)");
  if (content.includes("[tool.mypy]")) stack.devTools.push("mypy (types)");
}

function processRequirementsTxt(filepath: string, stack: StackInfo): void {
  stack.languages.push("Python");

  const content = readFileOrNull(filepath);
  if (!content) return;

  const pyDepMap: Record<string, string> = {
    "django": "Django", "flask": "Flask", "fastapi": "FastAPI",
    "sqlalchemy": "SQLAlchemy (ORM)", "pytest": "pytest",
  };

  for (const [dep, label] of Object.entries(pyDepMap)) {
    if (content.toLowerCase().includes(dep)) stack.frameworks.push(label);
  }
}

function detectInfrastructure(projectRoot: string, stack: StackInfo): void {
  if (existsSync(join(projectRoot, "docker-compose.yml")) || existsSync(join(projectRoot, "docker-compose.yaml"))) {
    stack.infrastructure.push("Docker Compose");
  }
  if (existsSync(join(projectRoot, "Dockerfile"))) {
    stack.infrastructure.push("Docker");
  }
  if (existsSync(join(projectRoot, ".github", "workflows"))) {
    stack.infrastructure.push("GitHub Actions");
  }
  if (existsSync(join(projectRoot, "vercel.json"))) {
    stack.infrastructure.push("Vercel");
  }
  if (existsSync(join(projectRoot, "netlify.toml"))) {
    stack.infrastructure.push("Netlify");
  }
  if (existsSync(join(projectRoot, "lefthook.yml")) || existsSync(join(projectRoot, "lefthook.yaml"))) {
    stack.devTools.push("Lefthook (git hooks)");
  }
}

function deduplicate(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.split(" ")[0]!.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MARKER_PROCESSORS: Record<string, (filepath: string, stack: StackInfo) => void> = {
  "package.json": processPackageJson,
  "Cargo.toml": processCargoToml,
  "go.mod": processGoMod,
  "go.work": processGoMod,
  "pyproject.toml": processPyproject,
  "requirements.txt": processRequirementsTxt,
  "Gemfile": (_, stack) => { stack.languages.push("Ruby"); },
  "composer.json": (_, stack) => { stack.languages.push("PHP"); },
  "pubspec.yaml": (_, stack) => { stack.languages.push("Dart/Flutter"); },
};

export function detectStack(projectRoot: string): StackInfo {
  const stack: StackInfo = {
    languages: [],
    frameworks: [],
    database: [],
    testing: [],
    infrastructure: [],
    devTools: [],
  };

  const markers = findProjectMarkers(projectRoot);

  for (const markerPath of markers) {
    const markerName = basename(markerPath);
    const processor = MARKER_PROCESSORS[markerName];
    if (processor) {
      processor(markerPath, stack);
    }
  }

  detectInfrastructure(projectRoot, stack);

  stack.languages = deduplicate(stack.languages);
  stack.frameworks = deduplicate(stack.frameworks);
  stack.database = deduplicate(stack.database);
  stack.testing = deduplicate(stack.testing);
  stack.infrastructure = deduplicate(stack.infrastructure);
  stack.devTools = deduplicate(stack.devTools);

  return stack;
}

export function renderStackMarkdown(projectName: string, stack: StackInfo): string {
  const today = new Date().toISOString().slice(0, 10);
  const sections: string[] = [
    `---`,
    `updated: ${today}`,
    `tags: [stack, ${projectName}]`,
    `---`,
    `# ${projectName} — Stack`,
  ];

  const categories: Array<[string, string[]]> = [
    ["Languages", stack.languages],
    ["Frameworks", stack.frameworks],
    ["Database", stack.database],
    ["Testing", stack.testing],
    ["Infrastructure", stack.infrastructure],
    ["Dev Tools", stack.devTools],
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
