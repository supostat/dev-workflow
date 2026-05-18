import { spawn } from "node:child_process";

/**
 * Hardcoded allowlist for `custom-command` gate binaries. Restricts what
 * `gateCommand: "<bin> [args]"` from workflow YAML can invoke at runtime.
 *
 * Shells (bash, sh, zsh, fish) are deliberately excluded — allowing them would
 * re-enable RCE via child-shell interpretation of args (e.g. `bash -c "rm -rf $HOME"`).
 * For composite gate logic, users must move to a script file invoked via `node`.
 *
 * Adding a binary here requires a security review PR — these are all of the form
 * "tools that read project files and exit, with no shell-like interpolation surface".
 */
export const ALLOWED_GATE_BINARIES: ReadonlySet<string> = new Set([
  "npm", "pnpm", "yarn", "npx",
  "vitest", "jest",
  "tsc", "eslint", "prettier",
  "node",
]);

/**
 * Run a binary with literal args, inheriting parent stdio so the user sees
 * test/lint output in real time. No shell — args pass through verbatim.
 * Resolves to true iff the child exits with code 0; false on spawn error
 * (ENOENT, EACCES) or non-zero exit. Never throws — gate semantics handle
 * boolean. Allowlist rejection happens BEFORE this is called.
 */
export function runGateBinary(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}
