import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gcEngramTraces, DEFAULT_TRACE_MAX_FILES } from "../src/lib/engram-trace.js";

describe("gcEngramTraces", () => {
  let runsDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["ENGRAM_TRACE_FILE"];
    delete process.env["ENGRAM_TRACE_FILE"];
    runsDir = mkdtempSync(join(tmpdir(), "engram-trace-gc-"));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env["ENGRAM_TRACE_FILE"];
    } else {
      process.env["ENGRAM_TRACE_FILE"] = originalEnv;
    }
  });

  function makeTrace(name: string, mtimeMs: number): string {
    const path = join(runsDir, name);
    writeFileSync(path, '{"ts":"x","method":"y"}\n', "utf-8");
    const t = mtimeMs / 1000;
    utimesSync(path, t, t);
    return path;
  }

  it("deletes a trace older than maxAgeMs", () => {
    const oldPath = makeTrace("run-old.engram-trace.jsonl", Date.now() - 40 * 24 * 60 * 60 * 1000);
    const newPath = makeTrace("run-new.engram-trace.jsonl", Date.now() - 1 * 24 * 60 * 60 * 1000);

    const deleted = gcEngramTraces(runsDir, { maxAgeMs: 30 * 24 * 60 * 60 * 1000 });

    expect(deleted).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
  });

  it("deletes files beyond maxFiles cap (keeps newest N)", () => {
    const now = Date.now();
    // Create 5 traces with descending mtimes (newest first by index 0)
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      paths.push(makeTrace(`run-${i}.engram-trace.jsonl`, now - i * 60 * 1000));
    }

    const deleted = gcEngramTraces(runsDir, { maxFiles: 3, maxAgeMs: Infinity });

    expect(deleted).toBe(2);
    // Newest 3 (indexes 0, 1, 2 with smallest delta from now) preserved
    expect(existsSync(paths[0]!)).toBe(true);
    expect(existsSync(paths[1]!)).toBe(true);
    expect(existsSync(paths[2]!)).toBe(true);
    // Oldest 2 deleted
    expect(existsSync(paths[3]!)).toBe(false);
    expect(existsSync(paths[4]!)).toBe(false);
  });

  it("skips the file pointed to by ENGRAM_TRACE_FILE (in-flight write)", () => {
    const active = makeTrace("run-active.engram-trace.jsonl", Date.now() - 50 * 24 * 60 * 60 * 1000);
    const stale = makeTrace("run-stale.engram-trace.jsonl", Date.now() - 50 * 24 * 60 * 60 * 1000);
    process.env["ENGRAM_TRACE_FILE"] = active;

    const deleted = gcEngramTraces(runsDir);

    expect(deleted).toBe(1);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it("ignores non-trace files in the runs directory", () => {
    writeFileSync(join(runsDir, "run-state.json"), "{}", "utf-8");
    writeFileSync(join(runsDir, "README.md"), "notes", "utf-8");
    makeTrace("run-stale.engram-trace.jsonl", Date.now() - 50 * 24 * 60 * 60 * 1000);

    const deleted = gcEngramTraces(runsDir);

    expect(deleted).toBe(1);
    expect(existsSync(join(runsDir, "run-state.json"))).toBe(true);
    expect(existsSync(join(runsDir, "README.md"))).toBe(true);
  });

  it("returns 0 on missing directory (no throw)", () => {
    const nonexistent = join(runsDir, "does-not-exist");
    expect(gcEngramTraces(nonexistent)).toBe(0);
  });

  it("DEFAULT_TRACE_MAX_FILES is 100 (sanity)", () => {
    expect(DEFAULT_TRACE_MAX_FILES).toBe(100);
  });

  it("preserves files within both bounds (under cap AND fresh)", () => {
    const now = Date.now();
    const fresh = makeTrace("run-fresh.engram-trace.jsonl", now - 1000);
    const deleted = gcEngramTraces(runsDir, { maxFiles: 100, maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
    expect(deleted).toBe(0);
    expect(existsSync(fresh)).toBe(true);
  });
});
