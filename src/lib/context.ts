import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { ProjectContext } from "./types.js";

const VAULT_DIR = ".dev-vault";

function git(command: string, cwd: string): string {
  try {
    return execSync(`git ${command}`, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function resolveProjectRoot(startDir: string): string | null {
  let dir = startDir;
  const root = "/";

  while (dir !== root) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = join(dir, "..");
  }

  return null;
}

function resolveProjectName(projectRoot: string): string {
  const remote = git("remote get-url origin", projectRoot);
  if (remote) {
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match?.[1]) return match[1];
  }

  return basename(projectRoot);
}

function resolveParentBranch(projectRoot: string): string {
  const mainExists = git("rev-parse --verify main", projectRoot);
  if (mainExists) return "main";

  const masterExists = git("rev-parse --verify master", projectRoot);
  if (masterExists) return "master";

  return "main";
}

export function detectContext(cwd: string = process.cwd()): ProjectContext | null {
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) return null;

  const branch = git("branch --show-current", projectRoot) || "main";
  const remote = git("remote get-url origin", projectRoot) || null;

  return {
    projectName: resolveProjectName(projectRoot),
    branch,
    parentBranch: resolveParentBranch(projectRoot),
    vaultPath: join(projectRoot, VAULT_DIR),
    projectRoot,
    gitRemote: remote,
  };
}
