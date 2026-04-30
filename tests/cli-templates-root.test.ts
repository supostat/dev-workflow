import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { templatesRoot } from "../src/cli/templates-root.js";

describe("templates-root CLI command", () => {
  let logOutput: string[];
  let origLog: typeof console.log;

  beforeEach(() => {
    logOutput = [];
    origLog = console.log;
    console.log = ((msg: string) => { logOutput.push(String(msg)); return true; }) as typeof console.log;
  });

  afterEach(() => {
    console.log = origLog;
  });

  function captured(): string {
    return logOutput.join("\n");
  }

  it("prints an absolute path ending with /templates that exists as a directory", () => {
    templatesRoot();
    const out = captured();
    expect(isAbsolute(out)).toBe(true);
    expect(out.endsWith("/templates")).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).isDirectory()).toBe(true);
  });

  it("resolves to the actual bundled templates directory (sanity: vault/upgrade.md present)", () => {
    templatesRoot();
    const out = captured();
    expect(existsSync(join(out, "claude/commands/vault/upgrade.md"))).toBe(true);
  });

  it("returns a canonical path (no .. segments left after resolve)", () => {
    templatesRoot();
    const out = captured();
    expect(resolve(out)).toBe(out);
  });

  it("is idempotent — two calls produce identical output", () => {
    templatesRoot();
    templatesRoot();
    expect(logOutput).toHaveLength(2);
    expect(logOutput[0]).toBe(logOutput[1]);
  });
});
