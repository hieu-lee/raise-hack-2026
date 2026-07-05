import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { reportSchema } from "../../../src/contracts/schemas.js";
import type { DriftIssue, DriftReport } from "../../../src/contracts/types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const frontendFixtureDir = join(repoRoot, "fixtures/golden/frontend-handoff-run");
export const frontendReportPath = join(frontendFixtureDir, "report.json");
export const frontendExportPath = join(frontendFixtureDir, "pr-comments.md");

const severityRank: Record<DriftIssue["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export async function loadFrontendReport(): Promise<DriftReport> {
  return reportSchema.parse(JSON.parse(await readFile(frontendReportPath, "utf8")));
}

export function countIssuesBy<K extends keyof DriftIssue>(
  issues: DriftIssue[],
  key: K
): Record<string, number> {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    const value = String(issue[key]);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function sortForTopFindings(issues: DriftIssue[]): DriftIssue[] {
  return [...issues].sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return right.confidence - left.confidence;
  });
}

export async function expectScreenshotCropInsideImage(issue: DriftIssue): Promise<void> {
  const screenshotPath = issue.evidence.screenshotPath;
  const cropBox = issue.evidence.cropBox;
  if (!screenshotPath || !cropBox) {
    throw new Error(`${issue.id} is missing screenshot crop evidence`);
  }

  const absolutePath = join(frontendFixtureDir, screenshotPath);
  await stat(absolutePath);
  const screenshot = PNG.sync.read(await readFile(absolutePath));

  if (cropBox.x < 0 || cropBox.y < 0) {
    throw new Error(`${issue.id} has a negative crop origin`);
  }
  if (cropBox.width <= 0 || cropBox.height <= 0) {
    throw new Error(`${issue.id} has an empty crop`);
  }
  if (
    cropBox.x + cropBox.width > screenshot.width ||
    cropBox.y + cropBox.height > screenshot.height
  ) {
    throw new Error(`${issue.id} crop exceeds ${screenshot.width}x${screenshot.height}`);
  }
}

export function dashboardRequiredLabels(): string[] {
  return [
    "Primary navigation",
    "Issue filters",
    "Issue list",
    "Issue detail",
    "Screenshot evidence",
    "Suggested fix",
    "Review actions",
    "Export preview"
  ];
}
