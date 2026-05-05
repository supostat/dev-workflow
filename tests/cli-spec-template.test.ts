import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { specTemplate } from "../src/cli/spec-template.js";
import { readSpecTemplate } from "../src/lib/spec-template.js";

describe("spec-template CLI command", () => {
  let logOutput: string[];
  let origLog: typeof console.log;

  beforeEach(() => {
    logOutput = [];
    origLog = console.log;
    console.log = ((msg: string) => {
      logOutput.push(String(msg));
      return true;
    }) as typeof console.log;
  });

  afterEach(() => {
    console.log = origLog;
  });

  function captured(): string {
    return logOutput.join("\n");
  }

  it("prints all 4 main top-level headings (Stack, Conventions, Knowledge, Gameplan)", () => {
    specTemplate();
    const out = captured();
    expect(out).toMatch(/^# Stack$/m);
    expect(out).toMatch(/^# Conventions$/m);
    expect(out).toMatch(/^# Knowledge$/m);
    expect(out).toMatch(/^# Gameplan$/m);
  });

  it("contains the 3-step bootstrap blockquote with init / from-spec / workflow", () => {
    specTemplate();
    const out = captured();
    expect(out).toContain("Bootstrap order");
    expect(out).toContain("git init && dev-workflow init");
    expect(out).toContain("/vault:from-spec docs/SPEC.md");
    expect(out).toContain("/workflow:dev");
  });

  it("contains all Phase 1 (Stack) subsection names from the from-spec skeleton", () => {
    specTemplate();
    const out = captured();
    for (const heading of ["## Languages", "## Frameworks", "## Database", "## Testing", "## Infrastructure", "## Dev Tools"]) {
      expect(out).toContain(heading);
    }
  });

  it("contains all Phase 2 (Conventions) subsection names", () => {
    specTemplate();
    const out = captured();
    for (const heading of ["## File Structure", "## Naming", "## Code Style", "## Patterns", "## Git", "## Testing"]) {
      expect(out).toContain(heading);
    }
  });

  it("contains all Phase 3 (Knowledge) subsection names", () => {
    specTemplate();
    const out = captured();
    for (const heading of ["## Architecture", "## Data Model", "## API", "## Security", "## Gotchas"]) {
      expect(out).toContain(heading);
    }
  });

  it("contains all Phase 4 (Gameplan) subsection names with Done when criteria", () => {
    specTemplate();
    const out = captured();
    for (const heading of ["## Current Phase", "## Phases", "## Backlog"]) {
      expect(out).toContain(heading);
    }
    expect(out).toContain("**Done when:**");
  });

  it("has exactly 4 top-level headings (no extra # Dev Workflow or similar drift)", () => {
    specTemplate();
    const out = captured();
    const topLevelHeadings = out.split("\n").filter((line) => /^# [^#]/.test(line));
    expect(topLevelHeadings).toEqual(["# Stack", "# Conventions", "# Knowledge", "# Gameplan"]);
  });

  it("contains ## Testing in BOTH Stack and Conventions sections (regression: collision-aware)", () => {
    specTemplate();
    const out = captured();
    const occurrences = out.split("\n").filter((line) => line === "## Testing");
    expect(occurrences).toHaveLength(2);
  });

  it("is idempotent — two calls produce identical output", () => {
    specTemplate();
    specTemplate();
    expect(logOutput).toHaveLength(2);
    expect(logOutput[0]).toBe(logOutput[1]);
  });

  it("readSpecTemplate library export matches CLI output", () => {
    const libOutput = readSpecTemplate();
    specTemplate();
    expect(captured()).toBe(libOutput);
  });

  it("resolves to actual file on disk (sanity: bundled template exists)", () => {
    const content = readSpecTemplate();
    expect(content.length).toBeGreaterThan(0);
    expect(existsSync(new URL("../templates/project/spec-md.example", import.meta.url))).toBe(true);
  });
});
