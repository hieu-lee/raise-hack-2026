import type { IssueCategory, IssueSeverity } from "../../types/report";
import "./IssueBadge.css";

const severityLabels: Record<IssueSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low"
};

const categoryLabels: Record<IssueCategory, string> = {
  token_misuse: "Token misuse",
  new_pattern_candidate: "New pattern",
  accidental_regression: "Regression",
  acceptable_exception: "Exception"
};

export function IssueBadge({
  value,
  kind
}: {
  value: IssueSeverity | IssueCategory;
  kind: "severity" | "category";
}) {
  const label =
    kind === "severity"
      ? severityLabels[value as IssueSeverity]
      : categoryLabels[value as IssueCategory];
  return (
    <span className={`issue-badge issue-badge--${kind} issue-badge--${value}`}>
      {kind === "severity" ? "Severity: " : "Category: "}
      {label}
    </span>
  );
}
