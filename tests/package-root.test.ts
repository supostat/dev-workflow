import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";

describe("PACKAGE_ROOT helper", () => {
  it("is an absolute path to an existing directory", () => {
    expect(isAbsolute(PACKAGE_ROOT)).toBe(true);
    expect(existsSync(PACKAGE_ROOT)).toBe(true);
    expect(statSync(PACKAGE_ROOT).isDirectory()).toBe(true);
  });

  it("points to the dev-workflow package root (contains package.json with matching name)", () => {
    const pkgPath = join(PACKAGE_ROOT, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string };
    expect(pkg.name).toBe("@engramm/dev-workflow");
  });

  it("is canonicalized via realpathSync (idempotent under realpath)", () => {
    expect(realpathSync(PACKAGE_ROOT)).toBe(PACKAGE_ROOT);
  });

  it("contains no unresolved `..` segments", () => {
    expect(resolve(PACKAGE_ROOT)).toBe(PACKAGE_ROOT);
  });

  it("bundled templates/ directory resolves under it", () => {
    const templatesDir = join(PACKAGE_ROOT, "templates");
    expect(existsSync(templatesDir)).toBe(true);
    expect(statSync(templatesDir).isDirectory()).toBe(true);
  });
});
