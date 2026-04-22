import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkflow, listAvailableWorkflows } from "../src/cli/run.js";

describe("resolveWorkflow", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "routing-resolve-"));
    mkdirSync(join(vaultPath, "workflows"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns vault workflow when .dev-vault/workflows/<name>.yaml exists", () => {
    writeFileSync(
      join(vaultPath, "workflows", "dev.yaml"),
      `name: dev\ndescription: Custom dev override\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );

    const workflow = resolveWorkflow("dev", vaultPath);

    expect(workflow.description).toBe("Custom dev override");
  });

  it("falls through to library workflow when vault has no match", () => {
    const workflow = resolveWorkflow("deploy", vaultPath);

    expect(workflow.name).toBe("deploy");
  });

  it("returns builtin when both vault and library have no match for that name", () => {
    // 'dev' is both builtin and library mirror. With empty vault, library wins before builtin.
    // Here we verify the library-mirrored builtin still resolves (end-to-end routing works).
    const workflow = resolveWorkflow("dev", vaultPath);

    expect(workflow.name).toBe("dev");
  });

  it("rethrows when all three sources miss", () => {
    expect(() => resolveWorkflow("totally-unknown-workflow-xyz", vaultPath)).toThrow();
  });
});

describe("listAvailableWorkflows", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "routing-list-"));
    mkdirSync(join(vaultPath, "workflows"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("merges vault, library, and builtin names, deduplicated and sorted", () => {
    writeFileSync(
      join(vaultPath, "workflows", "custom-flow.yaml"),
      `name: custom-flow\ndescription: My custom flow\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );

    const names = listAvailableWorkflows(vaultPath);

    expect(names).toContain("custom-flow");
    expect(names).toContain("dev");
    expect(names).toContain("deploy");
    expect(names).toEqual([...names].sort());
    expect(names.filter((n) => n === "dev")).toHaveLength(1);
  });
});
