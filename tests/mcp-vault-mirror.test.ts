import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";

vi.mock("../src/lib/engram.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/engram.js")>(
    "../src/lib/engram.js",
  );
  return {
    ...actual,
    engramSearch: vi.fn(async () => []),
    engramStore: vi.fn(async () => "mem-test-id"),
    engramJudge: vi.fn(async () => undefined),
  };
});

import { engramSearch, engramStore } from "../src/lib/engram.js";
import { mirrorVaultRecord } from "../src/mcp/vault-mirror.js";

const PROJECT_ROOT = "/tmp/fake-project";
const PROJECT_NAME = "test-project";

function makeArgs(overrides: Partial<Parameters<typeof mirrorVaultRecord>[0]> = {}): Parameters<typeof mirrorVaultRecord>[0] {
  return {
    type: "adr",
    title: "Sample decision",
    content: "Original body of the decision record.",
    filepath: join(PROJECT_ROOT, ".dev-vault", "architecture", "2026-05-01-sample-decision.md"),
    projectRoot: PROJECT_ROOT,
    projectName: PROJECT_NAME,
    autoTags: [],
    ...overrides,
  };
}

describe("mirrorVaultRecord", () => {
  beforeEach(() => {
    vi.mocked(engramSearch).mockClear();
    vi.mocked(engramStore).mockClear();
    vi.mocked(engramSearch).mockResolvedValue([]);
    vi.mocked(engramStore).mockResolvedValue("mem-test-id");
  });

  it("stores ADR with memory_type=decision and full tag set", async () => {
    const result = await mirrorVaultRecord(makeArgs({ type: "adr" }));

    expect(result).toEqual({ stored: true, skipped: false, memoryId: "mem-test-id" });
    expect(vi.mocked(engramStore)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(engramStore).mock.calls[0]!;
    expect(callArgs[3]).toBe("decision");
    const tags = callArgs[4]!;
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain(`vault-type:adr`);
    expect(tags).toContain(`vault-source:.dev-vault/architecture/2026-05-01-sample-decision.md`);
    expect(tags.find((t) => t.startsWith("vault-content-hash:"))).toMatch(
      /^vault-content-hash:[a-f0-9]{12}$/,
    );
    expect(tags).toContain(PROJECT_NAME);
  });

  it("stores bug as memory_type=antipattern", async () => {
    const result = await mirrorVaultRecord(makeArgs({
      type: "bug",
      filepath: join(PROJECT_ROOT, ".dev-vault", "bugs", "2026-05-01-sample.md"),
    }));

    expect(result.stored).toBe(true);
    expect(vi.mocked(engramStore).mock.calls[0]![3]).toBe("antipattern");
  });

  it("stores debt as memory_type=antipattern", async () => {
    const result = await mirrorVaultRecord(makeArgs({
      type: "debt",
      filepath: join(PROJECT_ROOT, ".dev-vault", "debt", "2026-05-01-sample.md"),
    }));

    expect(result.stored).toBe(true);
    expect(vi.mocked(engramStore).mock.calls[0]![3]).toBe("antipattern");
  });

  it("returns no-op for unknown type", async () => {
    const result = await mirrorVaultRecord(makeArgs({ type: "unknown" }));

    expect(result).toEqual({ stored: false, skipped: false, memoryId: null });
    expect(vi.mocked(engramSearch)).not.toHaveBeenCalled();
    expect(vi.mocked(engramStore)).not.toHaveBeenCalled();
  });

  it("does NOT skip when source matches but content-hash differs (false-positive guard)", async () => {
    const sourceTag = `vault-source:.dev-vault/architecture/2026-05-01-sample-decision.md`;
    vi.mocked(engramSearch).mockResolvedValueOnce([
      {
        id: "existing-mem",
        memory_type: "decision",
        context: "ADR recorded",
        action: "body",
        result: "stored",
        score: 0.5,
        tags: JSON.stringify([sourceTag, `vault-content-hash:${"a".repeat(12)}`]),
        project: PROJECT_NAME,
      },
    ]);

    const result = await mirrorVaultRecord(makeArgs());

    // The existing memory's fake hash "aaaa..." won't match real content hash → store fires.
    // Proves client-side AND-filter rejects partial matches.
    expect(result.stored).toBe(true);
    expect(vi.mocked(engramStore)).toHaveBeenCalledOnce();
  });

  it("treats different content as amend (stores new memory) when source matches but hash differs", async () => {
    const sourceTag = `vault-source:.dev-vault/architecture/2026-05-01-sample-decision.md`;
    vi.mocked(engramSearch).mockResolvedValueOnce([
      {
        id: "old-revision",
        memory_type: "decision",
        context: "ADR recorded",
        action: "old body",
        result: "stored",
        score: 0.5,
        tags: JSON.stringify([sourceTag, "vault-content-hash:abc123abc123"]),
        project: PROJECT_NAME,
      },
    ]);

    const result = await mirrorVaultRecord(makeArgs({ content: "Brand new body that hashes differently." }));

    expect(result.stored).toBe(true);
    expect(result.skipped).toBe(false);
    expect(vi.mocked(engramStore)).toHaveBeenCalledOnce();
  });

  it("returns stored=false when engramStore returns null (engram down)", async () => {
    vi.mocked(engramStore).mockResolvedValueOnce(null);

    const result = await mirrorVaultRecord(makeArgs());

    expect(result).toEqual({ stored: false, skipped: false, memoryId: null });
  });

  it("computes relativePath correctly when filepath is outside projectRoot", async () => {
    await mirrorVaultRecord(makeArgs({
      filepath: "/some/other/place/2026-05-01-sample-decision.md",
      projectRoot: "/tmp/fake-project",
    }));

    const callArgs = vi.mocked(engramStore).mock.calls[0]!;
    const tags = callArgs[4]!;
    // relative() produces "../some/other/place/..." for paths outside projectRoot
    expect(tags).toContain("vault-source:../../some/other/place/2026-05-01-sample-decision.md");
  });

  it("inherits proxy auto-tags (step/branch/task/run) from caller", async () => {
    await mirrorVaultRecord(makeArgs({
      autoTags: ["step:code", "branch:main", "task:task-042", "run:run-test-id"],
    }));

    const tags = vi.mocked(engramStore).mock.calls[0]![4]!;
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain("step:code");
    expect(tags).toContain("branch:main");
    expect(tags).toContain("task:task-042");
    expect(tags).toContain("run:run-test-id");
    expect(tags).toContain("vault-type:adr");
    expect(tags.find((t) => /^vault-source:.+\.md$/.test(t))).toBeDefined();
    expect(tags.find((t) => /^vault-content-hash:[a-f0-9]{12}$/.test(t))).toBeDefined();
  });

  it("idempotency check uses client-side AND filter regardless of engramSearch results", async () => {
    // Same content fingerprint → compute hash deterministically
    const args = makeArgs({ content: "deterministic body for hash test" });
    // Run once to capture the actual hash from the store call
    await mirrorVaultRecord(args);
    const realTags = vi.mocked(engramStore).mock.calls[0]![4]!;
    const hashTag = realTags.find((t) => t.startsWith("vault-content-hash:"));
    expect(hashTag).toBeDefined();
    const realHash = hashTag!.slice("vault-content-hash:".length);

    // Reset mocks, this time engramSearch returns a memory with EXACT matching tags
    vi.mocked(engramStore).mockClear();
    const sourceTag = `vault-source:${args.filepath.replace(PROJECT_ROOT + "/", "")}`;
    vi.mocked(engramSearch).mockResolvedValueOnce([
      {
        id: "exact-match",
        memory_type: "decision",
        context: "ADR recorded",
        action: "deterministic body for hash test",
        result: "stored",
        score: 0.5,
        tags: JSON.stringify([PROJECT_NAME, "vault-type:adr", sourceTag, `vault-content-hash:${realHash}`]),
        project: PROJECT_NAME,
      },
    ]);

    const result = await mirrorVaultRecord(args);

    expect(result).toEqual({ stored: false, skipped: true, memoryId: "exact-match" });
    expect(vi.mocked(engramStore)).not.toHaveBeenCalled();
  });
});
