import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { settingsTemplate } from "../src/cli/settings-template.js";
import { buildSettingsJson } from "../src/lib/settings-template.js";

interface SettingsShape {
  hooks: {
    SessionStart: Array<{ hooks: Array<{ command: string }> }>;
    SessionEnd: Array<{ hooks: Array<{ command: string }> }>;
    TaskCompleted: Array<{ hooks: Array<{ command: string }> }>;
  };
  permissions: { allow: string[]; deny: string[] };
  statusLine: { type: string; command: string };
}

describe("settings-template CLI command", () => {
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

  it("prints valid JSON with hooks/permissions/statusLine sections", () => {
    settingsTemplate();
    const out = captured();
    const parsed = JSON.parse(out) as SettingsShape;
    expect(parsed.hooks).toBeDefined();
    expect(parsed.permissions).toBeDefined();
    expect(parsed.statusLine).toBeDefined();
  });

  it("includes SessionStart, SessionEnd, and TaskCompleted hooks", () => {
    settingsTemplate();
    const parsed = JSON.parse(captured()) as SettingsShape;
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionEnd).toHaveLength(1);
    expect(parsed.hooks.TaskCompleted).toHaveLength(1);
  });

  it("emits absolute paths in every hook command (no node_modules/ relatives)", () => {
    settingsTemplate();
    const parsed = JSON.parse(captured()) as SettingsShape;
    const allCommands = [
      parsed.hooks.SessionStart[0]!.hooks[0]!.command,
      parsed.hooks.SessionEnd[0]!.hooks[0]!.command,
      parsed.hooks.TaskCompleted[0]!.hooks[0]!.command,
      parsed.statusLine.command,
    ];
    for (const cmd of allCommands) {
      expect(cmd.startsWith("node /")).toBe(true);
      expect(cmd).not.toContain("node_modules");
      const path = cmd.replace(/^node /, "");
      expect(isAbsolute(path)).toBe(true);
    }
  });

  it("emits canonical paths (no .. segments after resolve)", () => {
    settingsTemplate();
    const parsed = JSON.parse(captured()) as SettingsShape;
    const path = parsed.hooks.SessionStart[0]!.hooks[0]!.command.replace(/^node /, "");
    expect(resolve(path)).toBe(path);
  });

  it("resolves to actual files on disk (sanity: hooks exist in dist/)", () => {
    settingsTemplate();
    const parsed = JSON.parse(captured()) as SettingsShape;
    const sessionStartPath = parsed.hooks.SessionStart[0]!.hooks[0]!.command.replace(/^node /, "");
    expect(existsSync(sessionStartPath)).toBe(true);
  });

  it("is idempotent — two calls produce identical output", () => {
    settingsTemplate();
    settingsTemplate();
    expect(logOutput).toHaveLength(2);
    expect(logOutput[0]).toBe(logOutput[1]);
  });

  it("buildSettingsJson library export matches CLI output", () => {
    const libOutput = buildSettingsJson();
    settingsTemplate();
    expect(captured()).toBe(libOutput);
  });
});
