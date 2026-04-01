import { describe, it, expect } from "vitest";
import { readStdin, hookSuccess } from "../src/hooks/stdin.js";

describe("readStdin", () => {
  it("returns empty object when stdin is TTY", async () => {
    const result = await readStdin();
    expect(result).toEqual({});
  });
});

describe("hookSuccess", () => {
  it("writes JSON with continue: true to stdout", () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    hookSuccess("test message");

    process.stdout.write = originalWrite;

    const output = JSON.parse(chunks[0]!) as { continue: boolean };
    expect(output.continue).toBe(true);
  });

  it("includes hookSpecificOutput when eventName provided", () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    hookSuccess("vault context here", "SessionStart");

    process.stdout.write = originalWrite;

    const output = JSON.parse(chunks[0]!) as {
      continue: boolean;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toBe("vault context here");
  });
});
