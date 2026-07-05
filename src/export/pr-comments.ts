import type { DriftIssue, DriftReport } from "../contracts/types.js";

const severityRank: Record<DriftIssue["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function renderPrComments(report: DriftReport): string {
  if (report.issues.length === 0) {
    return `## DriftRadar report: ${report.projectName}\n\nNo design drift issues found.`;
  }

  const lines = [
    `## DriftRadar report: ${report.projectName}`,
    "",
    `Drift score: ${report.summary.driftScore}/100. ${report.summary.totalIssues} open issue(s).`,
    ""
  ];

  for (const [severity, routes] of groupedIssues(report.issues)) {
    lines.push(`### ${severity}`, "");

    for (const [routeId, issues] of routes) {
      lines.push(`#### ${routeId}`, "");

      for (const issue of issues) {
        lines.push(`- ${issue.title} (${issue.selectorHint})`);
        lines.push(`  - ${issue.suggestedFix.humanInstruction}`);

        if (issue.suggestedFix.cssBefore || issue.suggestedFix.cssAfter) {
          lines.push("  ```css");
          if (issue.suggestedFix.cssBefore) {
            lines.push(`  - ${issue.suggestedFix.cssBefore}`);
          }
          if (issue.suggestedFix.cssAfter) {
            lines.push(`  + ${issue.suggestedFix.cssAfter}`);
          }
          lines.push("  ```");
        }

        if (issue.suggestedFix.sourceFile) {
          lines.push(`  - Source: \`${issue.suggestedFix.sourceFile}\``);
        }

        if (issue.suggestedFix.tsxBefore || issue.suggestedFix.tsxAfter) {
          lines.push("  ```html");
          if (issue.suggestedFix.tsxBefore) {
            lines.push(issue.suggestedFix.tsxBefore);
          }
          if (
            issue.suggestedFix.tsxAfter &&
            issue.suggestedFix.tsxAfter !== issue.suggestedFix.tsxBefore
          ) {
            lines.push("  ---");
            lines.push(issue.suggestedFix.tsxAfter);
          }
          lines.push("  ```");
        }
      }

      lines.push("");
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function groupedIssues(issues: DriftIssue[]): [DriftIssue["severity"], [string, DriftIssue[]][]][] {
  const bySeverity = new Map<DriftIssue["severity"], Map<string, DriftIssue[]>>();

  for (const issue of issues) {
    const routes = bySeverity.get(issue.severity) ?? new Map<string, DriftIssue[]>();
    routes.set(issue.routeId, [...(routes.get(issue.routeId) ?? []), issue]);
    bySeverity.set(issue.severity, routes);
  }

  return [...bySeverity.entries()]
    .sort(([left], [right]) => severityRank[left] - severityRank[right])
    .map(([severity, routes]) => [
      severity,
      [...routes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([routeId, routeIssues]) => [
          routeId,
          [...routeIssues].sort((left, right) => left.title.localeCompare(right.title))
        ])
    ]);
}
