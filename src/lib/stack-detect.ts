import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface StackInfo {
  languages: string[];
  frameworks: string[];
  database: string[];
  testing: string[];
  infrastructure: string[];
  devTools: string[];
}

function readJsonOrNull(filepath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filepath)) return null;
    return JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectFromPackageJson(projectRoot: string, stack: StackInfo): void {
  const packageJson = readJsonOrNull(join(projectRoot, "package.json"));
  if (!packageJson) return;

  const allDeps = {
    ...((packageJson["dependencies"] as Record<string, string>) ?? {}),
    ...((packageJson["devDependencies"] as Record<string, string>) ?? {}),
  };

  const devDeps = (packageJson["devDependencies"] as Record<string, string>) ?? {};
  const engines = (packageJson["engines"] as Record<string, string>) ?? {};

  if (devDeps["typescript"]) {
    stack.languages.push(`TypeScript ${devDeps["typescript"]}`);
  }

  if (engines["node"]) {
    stack.languages.push(`Node.js ${engines["node"]}`);
  }

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
  if (packageManager) {
    stack.devTools.push(packageManager);
  }
}

function detectFromTsconfig(projectRoot: string, stack: StackInfo): void {
  const tsconfig = readJsonOrNull(join(projectRoot, "tsconfig.json"));
  if (!tsconfig) return;

  const compilerOptions = tsconfig["compilerOptions"] as Record<string, unknown> | undefined;
  if (compilerOptions?.["target"]) {
    stack.languages.push(`Target: ${compilerOptions["target"]}`);
  }
}

function detectFromPython(projectRoot: string, stack: StackInfo): void {
  if (existsSync(join(projectRoot, "requirements.txt"))) {
    stack.languages.push("Python");
  }
  if (existsSync(join(projectRoot, "pyproject.toml"))) {
    stack.languages.push("Python (pyproject.toml)");
  }
}

function detectFromGo(projectRoot: string, stack: StackInfo): void {
  if (existsSync(join(projectRoot, "go.mod"))) {
    stack.languages.push("Go");
  }
}

function detectFromRust(projectRoot: string, stack: StackInfo): void {
  if (existsSync(join(projectRoot, "Cargo.toml"))) {
    stack.languages.push("Rust");
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

export function detectStack(projectRoot: string): StackInfo {
  const stack: StackInfo = {
    languages: [],
    frameworks: [],
    database: [],
    testing: [],
    infrastructure: [],
    devTools: [],
  };

  detectFromPackageJson(projectRoot, stack);
  detectFromTsconfig(projectRoot, stack);
  detectFromPython(projectRoot, stack);
  detectFromGo(projectRoot, stack);
  detectFromRust(projectRoot, stack);
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
