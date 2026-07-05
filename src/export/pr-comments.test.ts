import { describe, expect, it } from "vitest";
import type { DriftReport } from "../contracts/types.js";
import { renderPrComments } from "./pr-comments.js";

describe("PR comment export", () => {
  it("groups useful suggestions by route", () => {
    const markdown = renderPrComments(report);

    expect(markdown).toContain("## DriftRadar report: Export fixture");
    expect(markdown).toContain("### high");
    expect(markdown).toContain("#### home");
    expect(markdown).toContain("Paste this into the PR");
    expect(markdown).toContain("Confidence: 91%");
    expect(markdown).toContain("Observed: `#1e64d8`");
    expect(markdown).toContain("Expected: `#1d4ed8`");
    expect(markdown).toContain("Screenshot: `screenshots/home/desktop/default.png`");
    expect(markdown).toContain("Replace #1e64d8 with --color-primary-600");
    expect(markdown).toContain("+ color: var(--color-primary-600);");
  });
});

const report: DriftReport = {
  schemaVersion: 1,
  runId: "export-run",
  projectName: "Export fixture",
  createdAt: "2026-07-03T13:00:00.000Z",
  configSummary: { routes: 1, viewports: 1, states: ["default"], tokenFiles: 1 },
  summary: {
    totalIssues: 1,
    countsByCategory: {
      token_misuse: 1,
      new_pattern_candidate: 0,
      accidental_regression: 0,
      acceptable_exception: 0
    },
    countsBySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
    driftScore: 84
  },
  tokens: {
    counts: { colors: 1, spacing: 0, radii: 0, typography: 0, shadows: 0 },
    sourceFiles: [{ path: "tokens.css", modifiedTime: "2026-07-03T12:00:00.000Z" }]
  },
  pages: [],
  issues: [
    {
      id: "issue-token-color",
      title: "Button color misses primary token",
      category: "token_misuse",
      severity: "high",
      confidence: 0.91,
      routeId: "home",
      viewport: "desktop",
      state: "default",
      elementId: "home-button",
      selectorHint: ".primary",
      property: "color",
      observedValue: "#1e64d8",
      expectedValue: "#1d4ed8",
      nearestToken: "--color-primary-600",
      evidence: {
        screenshotPath: "screenshots/home/desktop/default.png",
        relatedIssueIds: []
      },
      reasoning: "The color is visually near the primary token but uses a literal value.",
      suggestedFix: {
        type: "replace_with_token",
        cssBefore: "color: #1e64d8;",
        cssAfter: "color: var(--color-primary-600);",
        humanInstruction: "Replace #1e64d8 with --color-primary-600 on .primary."
      },
      status: "open"
    }
  ]
};
