import { describe, it, expect } from "vitest";
import { formatEngramHealthWarning } from "../src/hooks/engram-health-warning.js";
import { PENDING_JUDGMENTS_THRESHOLD } from "../src/lib/engram.js";

describe("formatEngramHealthWarning()", () => {
  it("returns null when health is null", () => {
    expect(formatEngramHealthWarning(null, PENDING_JUDGMENTS_THRESHOLD)).toBeNull();
  });

  it("returns null when pending is zero and models are fresh", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 0, modelsStale: false },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toBeNull();
  });

  it("returns null when pending equals threshold (boundary uses strict >)", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: PENDING_JUDGMENTS_THRESHOLD, modelsStale: false },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toBeNull();
  });

  it("reports pending count when just over the threshold", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: PENDING_JUDGMENTS_THRESHOLD + 1, modelsStale: false },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toContain(`${PENDING_JUDGMENTS_THRESHOLD + 1} pending judgments`);
    expect(warning).not.toContain("models stale");
  });

  it("reports stale models when pending is below threshold and models are stale", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 0, modelsStale: true },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toContain("models stale");
    expect(warning).not.toContain("pending judgments");
  });

  it("reports pending only when over threshold and models are fresh", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 75, modelsStale: false },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toContain("75 pending judgments");
    expect(warning).not.toContain("models stale");
  });

  it("reports both reasons joined by comma when pending exceeds threshold and models stale", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 175, modelsStale: true },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toContain("175 pending judgments, models stale");
  });

  it("includes leading newline so hook composition adds a visual separator", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 0, modelsStale: true },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning?.startsWith("\n")).toBe(true);
  });

  it("includes markdown warning emoji and remediation hint", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 0, modelsStale: true },
      PENDING_JUDGMENTS_THRESHOLD,
    );
    expect(warning).toContain("⚠️");
    expect(warning).toContain("Run `engram train`");
  });

  it("honours custom threshold parameter", () => {
    const warning = formatEngramHealthWarning(
      { pendingJudgments: 10, modelsStale: false },
      5,
    );
    expect(warning).toContain("10 pending judgments");
  });
});
