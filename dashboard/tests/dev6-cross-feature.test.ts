import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  countIssuesBy,
  dashboardRequiredLabels,
  expectScreenshotCropInsideImage,
  frontendExportPath,
  loadFrontendReport,
  sortForTopFindings
} from "../src/test/handoff-fixture.js";

describe("Dev 6 cross-feature frontend contract", () => {
  it("keeps landing and overview data consistent with derived report counts", async () => {
    const report = await loadFrontendReport();

    expect(report.projectName).toBeTruthy();
    expect(report.runId).toBe("frontend-handoff-run");
    expect(report.summary.driftScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.driftScore).toBeLessThanOrEqual(100);
    expect(report.summary.totalIssues).toBe(report.issues.length);
    expect(report.summary.countsByCategory).toEqual(countIssuesBy(report.issues, "category"));
    expect(report.summary.countsBySeverity).toEqual(countIssuesBy(report.issues, "severity"));
    expect(report.tokens.counts.colors).toBeGreaterThan(0);
    expect(new Set(report.pages.map((page) => page.routeId)).size).toBeGreaterThanOrEqual(4);
  });

  it("covers issue filters, details, review states, and top-finding sorting", async () => {
    const report = await loadFrontendReport();
    const categories = new Set(report.issues.map((issue) => issue.category));
    const severities = new Set(report.issues.map((issue) => issue.severity));

    expect(categories).toEqual(
      new Set([
        "token_misuse",
        "new_pattern_candidate",
        "accidental_regression",
        "acceptable_exception"
      ])
    );
    expect(severities).toEqual(new Set(["critical", "high", "medium", "low"]));
    expect(report.issues.some((issue) => issue.state === "focus")).toBe(true);
    expect(report.issues.some((issue) => issue.state === "dark")).toBe(true);
    expect(sortForTopFindings(report.issues)[0]).toMatchObject({
      id: "issue-focus-ring",
      severity: "critical"
    });

    for (const issue of report.issues) {
      expect(issue.status).toBe("open");
      expect(issue.title).toBeTruthy();
      expect(issue.routeId).toBeTruthy();
      expect(issue.selectorHint).toBeTruthy();
      expect(issue.property).toBeTruthy();
      expect(issue.reasoning).toMatch(/[a-z]/i);
      expect(issue.suggestedFix.humanInstruction).toMatch(/[a-z]/i);
    }
  });

  it("keeps screenshot evidence and export markdown usable for browser smoke", async () => {
    const report = await loadFrontendReport();
    const markdown = await readFile(frontendExportPath, "utf8");

    await Promise.all(report.issues.map((issue) => expectScreenshotCropInsideImage(issue)));
    for (const issue of report.issues) {
      expect(markdown).toContain(issue.title);
      expect(markdown).toContain(issue.severity);
      expect(markdown).toContain(issue.suggestedFix.humanInstruction);
    }
  });

  it("documents the landmarks that must stay keyboard and screen-reader reachable", () => {
    expect(dashboardRequiredLabels()).toEqual([
      "Primary navigation",
      "Issue filters",
      "Issue list",
      "Issue detail",
      "Screenshot evidence",
      "Suggested fix",
      "Review actions",
      "Export preview"
    ]);
  });
});
