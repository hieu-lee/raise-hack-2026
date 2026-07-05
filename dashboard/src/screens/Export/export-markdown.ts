import type { DriftIssue, DriftReport, IssueCategory, IssueSeverity } from "../../lib/report-types";

const severityOrder: IssueSeverity[] = ["critical", "high", "medium", "low"];

export function generateExportMarkdown(report: DriftReport): string {
  const lines = [
    `# DriftRadar report for ${report.projectName}`,
    "",
    `Run: \`${report.runId}\``,
    `Drift risk: ${100 - report.summary.driftScore}/100`,
    `Total issues: ${report.summary.totalIssues}`,
    "",
    "## Review packet outcome",
    "",
    "- Paste this into the PR to replace the design QA sync.",
    "- Each finding includes severity, route, source hint, screenshot evidence, observed value, expected value, confidence, and suggested fix.",
    "- Deterministic scan evidence is listed separately from reviewer-facing rationale.",
    ""
  ];

  if (report.issues.length === 0) {
    lines.push("No design drift issues were found.");
    return `${lines.join("\n")}\n`;
  }

  for (const issue of [...report.issues].sort(bySeverityThenTitle)) {
    lines.push(`## ${issue.title}`);
    lines.push("");
    lines.push(`- Severity: ${issue.severity}`);
    lines.push(`- Category: ${issue.category}`);
    lines.push(`- Route: ${issue.routeId}`);
    lines.push(`- State: ${issue.state}`);
    lines.push(`- Confidence: ${Math.round(issue.confidence * 100)}%`);
    if (issue.selectorHint) lines.push(`- Source hint: \`${issue.selectorHint}\``);
    lines.push(`- Observed: \`${issue.observedValue}\``);
    if (issue.expectedValue) lines.push(`- Expected: \`${issue.expectedValue}\``);
    if (issue.evidence?.screenshotPath) lines.push(`- Screenshot: \`${issue.evidence.screenshotPath}\``);
    if (issue.evidence?.tokenDistance !== undefined) {
      lines.push(`- Token distance: ${issue.evidence.tokenDistance}`);
    }
    if (issue.reasoning) lines.push(`- Reviewer rationale: ${issue.reasoning}`);
    if (issue.suggestedFix?.humanInstruction)
      lines.push(`- Suggested fix: ${issue.suggestedFix.humanInstruction}`);
    if (issue.suggestedFix?.cssBefore) lines.push(`- Before: \`${issue.suggestedFix.cssBefore}\``);
    if (issue.suggestedFix?.cssAfter) lines.push(`- After: \`${issue.suggestedFix.cssAfter}\``);
    lines.push("");
  }

  return lines.join("\n");
}

export async function loadExportMarkdown(input: {
  mode: "live" | "fixture";
  report: DriftReport;
  apiBaseUrl?: string;
  fixtureBasePath?: string;
  fetcher?: typeof fetch;
}): Promise<{ markdown: string; source: "live" | "fixture" | "fallback" }> {
  const fetcher = input.fetcher ?? fetch;
  const path =
    input.mode === "live"
      ? `${input.apiBaseUrl ?? "http://localhost:4317"}/api/runs/${input.report.runId}/export/pr-comments`
      : `${input.fixtureBasePath ?? "/fixtures/frontend-handoff-run"}/pr-comments.md`;

  try {
    const response = await fetcher(path);
    if (!response.ok) throw new Error(`Export returned ${response.status}`);
    return { markdown: await response.text(), source: input.mode };
  } catch {
    return { markdown: generateExportMarkdown(input.report), source: "fallback" };
  }
}

export function countBySeverity(issues: DriftIssue[]): Record<IssueSeverity, number> {
  return countBy(issues, ["critical", "high", "medium", "low"], (issue) => issue.severity);
}

export function countByCategory(issues: DriftIssue[]): Record<IssueCategory, number> {
  return countBy(
    issues,
    ["token_misuse", "new_pattern_candidate", "accidental_regression", "acceptable_exception"],
    (issue) => issue.category
  );
}

function countBy<T extends string>(
  items: DriftIssue[],
  keys: T[],
  keyFor: (issue: DriftIssue) => T
): Record<T, number> {
  return Object.fromEntries(
    keys.map((key) => [key, items.filter((issue) => keyFor(issue) === key).length])
  ) as Record<T, number>;
}

function bySeverityThenTitle(a: DriftIssue, b: DriftIssue) {
  return (
    severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity) ||
    a.title.localeCompare(b.title)
  );
}
