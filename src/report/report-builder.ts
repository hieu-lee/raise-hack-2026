import { reportSchema } from "../contracts/schemas.js";
import type { DriftIssue, DriftReport, PageCapture, TokenSet } from "../contracts/types.js";
import { withSuggestedFix } from "./suggestions.js";

type ConfigSummary = DriftReport["configSummary"];

const categories: DriftIssue["category"][] = [
  "token_misuse",
  "new_pattern_candidate",
  "accidental_regression",
  "acceptable_exception"
];
const severities: DriftIssue["severity"][] = ["critical", "high", "medium", "low"];
const severityCost: Record<DriftIssue["severity"], number> = {
  critical: 30,
  high: 16,
  medium: 8,
  low: 2
};

export interface BuildReportInput {
  runId: string;
  projectName: string;
  createdAt: string;
  configSummary: ConfigSummary;
  tokens: TokenSet;
  pages: PageCapture[];
  issues: DriftIssue[];
}

export function buildReport(input: BuildReportInput): DriftReport {
  const issues = input.issues.map(withSuggestedFix);
  const report = {
    schemaVersion: 1 as const,
    runId: input.runId,
    projectName: input.projectName,
    createdAt: input.createdAt,
    configSummary: input.configSummary,
    summary: {
      totalIssues: issues.length,
      countsByCategory: countBy(issues, categories, "category"),
      countsBySeverity: countBy(issues, severities, "severity"),
      driftScore: driftScore(issues)
    },
    tokens: {
      counts: {
        colors: input.tokens.colors.length,
        spacing: input.tokens.spacing.length,
        radii: input.tokens.radii.length,
        typography: input.tokens.typography.length,
        shadows: input.tokens.shadows.length
      },
      sourceFiles: input.tokens.sourceFiles
    },
    pages: input.pages,
    issues
  };

  return reportSchema.parse(report);
}

function countBy<Key extends "category" | "severity">(
  issues: DriftIssue[],
  keys: DriftIssue[Key][],
  field: Key
): Record<DriftIssue[Key], number> {
  return Object.fromEntries(
    keys.map((key) => [key, issues.filter((issue) => issue[field] === key).length])
  ) as Record<DriftIssue[Key], number>;
}

function driftScore(issues: DriftIssue[]): number {
  const cost = issues.reduce((total, issue) => total + severityCost[issue.severity], 0);
  return Math.max(0, 100 - Math.min(100, cost));
}
