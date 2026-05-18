import { describe, it, expect, afterEach } from "vitest";
import { parseFrontmatter } from "../src/lib/frontmatter.js";

describe("parseFrontmatter — parsing", () => {
  it("parses scalar fields", () => {
    const { fields, body } = parseFrontmatter("---\ntitle: Hello\nstatus: open\n---\nBody text");
    expect(fields["title"]).toBe("Hello");
    expect(fields["status"]).toBe("open");
    expect(body).toBe("Body text");
  });

  it("parses a bracket array field into a trimmed string list", () => {
    const { fields } = parseFrontmatter("---\ntags: [alpha, beta , gamma]\n---\n");
    expect(fields["tags"]).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns the raw input as body when there is no frontmatter block", () => {
    const raw = "No frontmatter here\njust text";
    const { fields, body } = parseFrontmatter(raw);
    expect(body).toBe(raw);
    expect(Object.keys(fields)).toHaveLength(0);
  });
});

describe("parseFrontmatter — prototype-pollution defense", () => {
  afterEach(() => {
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("skips a __proto__ key instead of polluting Object.prototype", () => {
    const { fields } = parseFrontmatter("---\n__proto__: polluted\ntitle: safe\n---\n");
    expect(fields["title"]).toBe("safe");
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("skips a constructor key", () => {
    const { fields } = parseFrontmatter("---\nconstructor: polluted\ntitle: safe\n---\n");
    expect(fields["title"]).toBe("safe");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("skips a prototype key", () => {
    const { fields } = parseFrontmatter("---\nprototype: polluted\ntitle: safe\n---\n");
    expect(fields["title"]).toBe("safe");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("skips a reserved key even when supplied as a bracket array", () => {
    const { fields } = parseFrontmatter("---\n__proto__: [a, b]\ntitle: safe\n---\n");
    expect(fields["title"]).toBe("safe");
    expect(({} as Record<string, unknown>)["a"]).toBeUndefined();
  });

  it("produces a null-prototype fields object on the no-frontmatter early-return path", () => {
    const { fields } = parseFrontmatter("plain text, no block");
    expect(Object.getPrototypeOf(fields)).toBeNull();
  });

  it("produces a null-prototype fields object on the main parse path", () => {
    const { fields } = parseFrontmatter("---\ntitle: x\n---\n");
    expect(Object.getPrototypeOf(fields)).toBeNull();
  });
});

describe("parseFrontmatter — tolerant degradation", () => {
  it("skips non-key-value lines without throwing", () => {
    const { fields } = parseFrontmatter("---\ntitle: ok\nthis line has no colon key\n---\n");
    expect(fields["title"]).toBe("ok");
    expect(Object.keys(fields)).toHaveLength(1);
  });

  it("does not throw on an unterminated frontmatter block", () => {
    expect(() => parseFrontmatter("---\ntitle: dangling\nno closing marker")).not.toThrow();
    const { fields, body } = parseFrontmatter("---\ntitle: dangling\nno closing marker");
    expect(Object.keys(fields)).toHaveLength(0);
    expect(body).toContain("---");
  });
});
