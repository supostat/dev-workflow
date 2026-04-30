import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSocketPath } from "../src/lib/engram.js";

describe("resolveSocketPath", () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let tempDir: string;
  let originalEnvSocket: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync("/tmp/engram-resolver-test-");
    originalEnvSocket = process.env["ENGRAM_SOCKET_PATH"];
    originalHome = process.env["HOME"];
    delete process.env["ENGRAM_SOCKET_PATH"];
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    if (originalEnvSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEnvSocket;
    }
    if (originalHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = originalHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses ENGRAM_SOCKET_PATH when set, ignoring cwd-local and HOME", () => {
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/explicit-override.sock";
    // Even if a cwd-local socket exists, ENV wins.
    mkdirSync(join(tempDir, ".engram"), { recursive: true });
    writeFileSync(join(tempDir, ".engram", "engram.sock"), "");
    expect(resolveSocketPath()).toBe("/tmp/explicit-override.sock");
  });

  it("treats empty ENV string as unset", () => {
    process.env["ENGRAM_SOCKET_PATH"] = "";
    process.env["HOME"] = "/tmp/fake-home";
    // No cwd-local socket, ENV is empty string → falls through to HOME.
    expect(resolveSocketPath()).toBe("/tmp/fake-home/.engram/engram.sock");
  });

  it("returns cwd-local socket when it exists and ENV is unset", () => {
    mkdirSync(join(tempDir, ".engram"), { recursive: true });
    const projectSock = join(tempDir, ".engram", "engram.sock");
    writeFileSync(projectSock, "");
    expect(resolveSocketPath()).toBe(projectSock);
  });

  it("falls back to HOME when neither ENV nor cwd-local socket exists", () => {
    process.env["HOME"] = "/tmp/fake-home";
    // No .engram/ in tempDir.
    expect(resolveSocketPath()).toBe("/tmp/fake-home/.engram/engram.sock");
  });

  it("falls back to /tmp when HOME is unset and no cwd-local socket", () => {
    delete process.env["HOME"];
    expect(resolveSocketPath()).toBe("/tmp/.engram/engram.sock");
  });

  it("re-evaluates per call (cwd change between calls is reflected)", () => {
    const firstDir = mkdtempSync("/tmp/engram-resolver-first-");
    const secondDir = mkdtempSync("/tmp/engram-resolver-second-");
    try {
      mkdirSync(join(firstDir, ".engram"), { recursive: true });
      writeFileSync(join(firstDir, ".engram", "engram.sock"), "");
      mkdirSync(join(secondDir, ".engram"), { recursive: true });
      writeFileSync(join(secondDir, ".engram", "engram.sock"), "");

      cwdSpy.mockReturnValue(firstDir);
      expect(resolveSocketPath()).toBe(join(firstDir, ".engram", "engram.sock"));

      cwdSpy.mockReturnValue(secondDir);
      expect(resolveSocketPath()).toBe(join(secondDir, ".engram", "engram.sock"));
    } finally {
      rmSync(firstDir, { recursive: true, force: true });
      rmSync(secondDir, { recursive: true, force: true });
    }
  });
});
