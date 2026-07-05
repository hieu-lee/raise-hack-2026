import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportSchema } from "../contracts/schemas.js";
import type { DriftIssue, ObservationRecord, PageCapture, TokenSet } from "../contracts/types.js";
import { writeRunArtifacts } from "./run-storage.js";

describe("run storage", () => {
  it("writes report artifacts and observations jsonl", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "driftradar-run-"));

    try {
      const report = await writeRunArtifacts({
        outputDir,
        runId: "test-run",
        projectName: "Storage fixture",
        createdAt: "2026-07-03T13:00:00.000Z",
        configSummary: { routes: 1, viewports: 1, states: ["default"], tokenFiles: 1 },
        tokens,
        pages,
        observations,
        issues
      });

      expect(reportSchema.parse(report).summary.totalIssues).toBe(1);

      const runDir = join(outputDir, "runs", "test-run");
      await expect(readFile(join(runDir, "manifest.json"), "utf8")).resolves.toContain(
        '"status": "complete"'
      );
      await expect(readFile(join(runDir, "tokens.json"), "utf8")).resolves.toContain("Primary");
      await expect(readFile(join(runDir, "issues.json"), "utf8")).resolves.toContain(
        "replace_with_token"
      );

      const jsonl = await readFile(join(runDir, "observations.jsonl"), "utf8");
      expect(jsonl.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(jsonl).elementId).toBe("home-button");
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });

  it("rejects path-unsafe run ids", async () => {
    await expect(
      writeRunArtifacts({
        outputDir: "/tmp/driftradar-invalid-run",
        runId: "../escape",
        projectName: "Storage fixture",
        createdAt: "2026-07-03T13:00:00.000Z",
        configSummary: { routes: 1, viewports: 1, states: ["default"], tokenFiles: 1 },
        tokens,
        pages,
        observations: [],
        issues: []
      })
    ).rejects.toThrow(/Invalid run ID/);
  });
});

const tokens: TokenSet = {
  sourceFiles: [{ path: "tokens.css", modifiedTime: "2026-07-03T12:00:00.000Z" }],
  colors: [
    {
      name: "Primary",
      cssVariable: "--color-primary-600",
      originalValue: "#1d4ed8",
      oklch: "oklch(0.52 0.19 260)",
      hex: "#1d4ed8"
    }
  ],
  spacing: [],
  radii: [],
  typography: [],
  shadows: []
};

const pages: PageCapture[] = [
  {
    routeId: "home",
    viewport: "desktop",
    state: "default",
    screenshotPath: "screenshots/home/desktop/default.png",
    capturedAt: "2026-07-03T12:01:00.000Z",
    browser: { name: "chromium", version: "stable" }
  }
];

const observations: ObservationRecord[] = [
  {
    routeId: "home",
    viewport: "desktop",
    state: "default",
    elementId: "home-button",
    selectorHint: ".primary",
    role: "button",
    tagName: "button",
    textSample: "Buy",
    boundingBox: { x: 1, y: 2, width: 80, height: 32 },
    computed: {
      color: "#1e64d8",
      backgroundColor: "transparent",
      borderColor: "#1e64d8",
      fontFamily: "Inter",
      fontSize: "16px",
      fontWeight: "600",
      lineHeight: "24px",
      letterSpacing: "0px",
      margin: "0px",
      padding: "8px 12px",
      gap: "8px",
      borderRadius: "6px",
      boxShadow: "none",
      opacity: "1",
      cursor: "pointer"
    }
  }
];

const issues: DriftIssue[] = [
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
      tokenDistance: 1.2,
      relatedIssueIds: []
    },
    reasoning: "The color is visually near the primary token but uses a literal value.",
    suggestedFix: {
      type: "pending",
      humanInstruction: "pending"
    },
    status: "open"
  }
];
