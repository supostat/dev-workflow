import { describe, it, expect } from "vitest";
import { renderTemplate, listTemplates } from "../src/lib/templates.js";

describe("renderTemplate", () => {
  it("renders vault/stack with variables", () => {
    const result = renderTemplate("vault/stack", { projectName: "TestProject" });

    expect(result).toContain("# TestProject — Stack");
    expect(result).toContain("tags: [stack, TestProject]");
    expect(result).toMatch(/updated: \d{4}-\d{2}-\d{2}/);
  });

  it("renders vault/knowledge with variables", () => {
    const result = renderTemplate("vault/knowledge", { projectName: "MyApp" });

    expect(result).toContain("# MyApp — Knowledge");
    expect(result).toContain("## Gotchas");
  });

  it("renders records/branch with all variables", () => {
    const result = renderTemplate("records/branch", {
      projectName: "MyApp",
      branch: "feature/auth",
      parent: "main",
      goal: "Implement authentication",
    });

    expect(result).toContain("branch: feature/auth");
    expect(result).toContain("parent: main");
    expect(result).toContain("Implement authentication");
  });

  it("renders records/daily with project and branch", () => {
    const result = renderTemplate("records/daily", {
      projectName: "MyApp",
      branch: "feature/auth",
    });

    expect(result).toContain("projects: [MyApp]");
    expect(result).toContain("branches: [feature/auth]");
  });

  it("replaces missing variables with empty string", () => {
    const result = renderTemplate("records/bug", { projectName: "MyApp" });

    expect(result).toContain("tags: [bug, MyApp]");
    expect(result).not.toContain("{{");
  });

  it("injects today date automatically", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = renderTemplate("vault/stack", { projectName: "Test" });

    expect(result).toContain(`updated: ${today}`);
  });

  it("throws on unknown template", () => {
    expect(() => renderTemplate("nonexistent/template")).toThrow("Template not found");
  });
});

describe("listTemplates", () => {
  it("returns all builtin template names", () => {
    const templates = listTemplates();

    expect(templates).toContain("vault/stack");
    expect(templates).toContain("vault/conventions");
    expect(templates).toContain("vault/knowledge");
    expect(templates).toContain("vault/gameplan");
    expect(templates).toContain("records/branch");
    expect(templates).toContain("records/daily");
    expect(templates).toContain("records/adr");
    expect(templates).toContain("records/bug");
    expect(templates).toContain("records/debt");
  });
});
