import { describe, it, expect } from "vitest";
import { interpolate } from "../src/lib/interpolate.js";

describe("interpolate", () => {
  it("substitutes a single {{key}} placeholder", () => {
    expect(interpolate("Hello {{name}}", { name: "Igor" })).toBe("Hello Igor");
  });

  it("substitutes multiple distinct placeholders", () => {
    expect(interpolate("{{a}}-{{b}}-{{c}}", { a: "1", b: "2", c: "3" })).toBe("1-2-3");
  });

  it("substitutes the same placeholder multiple times", () => {
    expect(interpolate("{{x}} and {{x}} again", { x: "foo" })).toBe("foo and foo again");
  });

  it("replaces missing keys with empty string (silent default)", () => {
    expect(interpolate("Before {{missing}} after", {})).toBe("Before  after");
  });

  it("preserves template text that has no placeholders", () => {
    expect(interpolate("plain text with no vars", { unused: "x" })).toBe("plain text with no vars");
  });

  it("handles empty template", () => {
    expect(interpolate("", { any: "value" })).toBe("");
  });

  it("handles empty variables map", () => {
    expect(interpolate("{{key}}", {})).toBe("");
  });

  it("does NOT recurse — value containing {{other}} is NOT re-interpolated", () => {
    // Critical property: single-pass substitution. If user input
    // contained {{secret}} it would NOT pull in the `secret` variable
    // from variables map. Defense-in-depth against injection.
    expect(interpolate("Hello {{a}}", { a: "{{b}}", b: "leaked" })).toBe("Hello {{b}}");
  });

  it("ignores placeholders with non-word characters (only [a-zA-Z0-9_])", () => {
    expect(interpolate("{{ key }}", { key: "x" })).toBe("{{ key }}"); // space
    expect(interpolate("{{foo-bar}}", { "foo-bar": "x" })).toBe("{{foo-bar}}"); // dash
    expect(interpolate("{{foo.bar}}", { "foo.bar": "x" })).toBe("{{foo.bar}}"); // dot
  });

  it("substitutes placeholders with underscores and digits in keys", () => {
    expect(interpolate("{{snake_case}} {{key1}} {{_leading}}", {
      snake_case: "a", key1: "b", _leading: "c",
    })).toBe("a b c");
  });

  it("substitutes placeholders containing only digits", () => {
    expect(interpolate("{{123}}", { "123": "x" })).toBe("x");
  });

  it("preserves regex special characters in template", () => {
    const template = "Email: user@example.com (cost: $5.00) — see [docs](url) +1";
    expect(interpolate(template, {})).toBe(template);
  });

  it("preserves regex special characters in values", () => {
    expect(interpolate("Value: {{v}}", { v: "$100 — *star* + ^anchor$" }))
      .toBe("Value: $100 — *star* + ^anchor$");
  });

  it("substitutes empty-string value (key exists but empty)", () => {
    expect(interpolate("[{{x}}]", { x: "" })).toBe("[]");
  });

  it("handles multiline templates and values", () => {
    const template = "Line 1\n{{body}}\nLine 3";
    const value = "para 1\npara 2\npara 3";
    expect(interpolate(template, { body: value }))
      .toBe("Line 1\npara 1\npara 2\npara 3\nLine 3");
  });

  it("does NOT match triple-brace pattern as a single placeholder", () => {
    // {{{x}}} → opens with {{, captures "x", closes with first }} → result is x}
    expect(interpolate("{{{x}}}", { x: "val" })).toBe("{val}");
  });

  it("handles consecutive placeholders without separator", () => {
    expect(interpolate("{{a}}{{b}}{{c}}", { a: "1", b: "2", c: "3" })).toBe("123");
  });
});
