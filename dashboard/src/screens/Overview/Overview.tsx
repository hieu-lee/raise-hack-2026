import { ScoreCard } from "../../components/ScoreCard/ScoreCard";
import { SummaryBar } from "../../components/SummaryBar/SummaryBar";
import { useIssueNames, issueLabel } from "../../hooks/useIssueNames";
import { severityOrder, sortIssues } from "../../lib/filtering/filtering";
import type { IssueCategory, IssueSeverity, ScanReport } from "../../types/report";
import "./Overview.css";

type OverviewProps = {
  apiBaseUrl?: string;
  mutationToken?: string;
  report: ScanReport;
  mode?: "live" | "fixture";
};

const categoryLabels: Record<IssueCategory, string> = {
  token_misuse: "Token misuse",
  new_pattern_candidate: "New pattern",
  accidental_regression: "Regression",
  acceptable_exception: "Exception"
};

const severityLabels: Record<IssueSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low"
};

const topRoutes = (report: ScanReport) =>
  [
    ...report.issues.reduce(
      (counts, issue) => counts.set(issue.routeId, (counts.get(issue.routeId) ?? 0) + 1),
      new Map<string, number>()
    )
  ]
    .sort(([routeA, countA], [routeB, countB]) => countB - countA || routeA.localeCompare(routeB))
    .slice(0, 4);

const tokenCount = (report: ScanReport) =>
  Object.values(report.tokens?.counts ?? {}).reduce((sum, count) => sum + count, 0);

const issueHref = (runId: string, issueId: string) => {
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  params.set("issue", issueId);
  return `?${params.toString()}#/issues`;
};

export function Overview({ apiBaseUrl, mutationToken, report, mode = "fixture" }: OverviewProps) {
  const issueNames = useIssueNames(
    apiBaseUrl,
    report.runId,
    report.issues,
    mode === "live",
    mutationToken
  );
  const hasTokenMetadata = Boolean(report.tokens?.counts);
  const tokens = tokenCount(report);
  const topFindings = sortIssues(report.issues, "severity").slice(0, 3);
  const routeCount =
    report.configSummary?.routes ??
    new Set(report.pages?.map((page) => page.routeId).filter(Boolean)).size;
  const severityItems = severityOrder.map((severity) => ({
    label: severityLabels[severity],
    value: report.summary.countsBySeverity[severity] ?? 0,
    tone: severity
  }));
  const categoryItems = (
    Object.entries(report.summary.countsByCategory) as Array<[IssueCategory, number]>
  ).map(([category, value]) => ({ label: categoryLabels[category], value }));

  return (
    <section className="overview">
      {mode === "fixture" ? (
        <p className="overview__banner">Fixture mode: showing committed handoff data.</p>
      ) : null}

      <section className="overview__hero" aria-labelledby="overview-title">
        <div>
          <p className="overview__eyebrow">{report.projectName}</p>
          <h1 id="overview-title">Design drift overview</h1>
          <p>
            DriftRadar groups token misuse, repeated patterns, regressions, and documented
            exceptions so design and engineering can reconcile the same evidence.
          </p>
        </div>
        <ScoreCard
          label="Drift score"
          value={report.summary.driftScore}
          detail={`${report.summary.totalIssues} open findings across ${routeCount} routes`}
          tone={
            report.summary.driftScore <= 40
              ? "critical"
              : report.summary.driftScore <= 70
                ? "high"
                : report.summary.driftScore <= 85
                  ? "medium"
                  : "good"
          }
        />
      </section>

      {report.summary.totalIssues === 0 ? (
        <section className="overview__empty">
          <h2>No drift found</h2>
          <p>This run did not produce issues. Keep the report for a clean baseline.</p>
        </section>
      ) : (
        <>
          <section className="overview__cards" aria-label="Scan score cards">
            <ScoreCard
              label="Total issues"
              value={report.summary.totalIssues}
              detail="Matches report summary"
            />
            <ScoreCard
              label="Routes scanned"
              value={routeCount}
              detail={`${report.pages?.length ?? 0} captures`}
            />
            <ScoreCard
              label="Tokens loaded"
              value={hasTokenMetadata ? tokens : "Missing"}
              detail={
                hasTokenMetadata
                  ? `${report.tokens?.sourceFiles?.length ?? 0} source file`
                  : "Token metadata unavailable"
              }
              tone={hasTokenMetadata ? "good" : "low"}
            />
          </section>

          <section className="overview__grid">
            <SummaryBar title="Severity counts" items={severityItems} />
            <SummaryBar title="Category counts" items={categoryItems} />
          </section>

          <section className="overview__grid overview__grid--routes">
            <section className="overview__panel">
              <h2>Top affected routes</h2>
              <ol className="overview__route-list">
                {topRoutes(report).map(([route, count]) => (
                  <li key={route}>
                    <span>{route}</span>
                    <strong>{count} findings</strong>
                  </li>
                ))}
              </ol>
            </section>

            <section className="overview__panel">
              <h2>Highest-priority findings</h2>
              <ol className="overview__finding-list">
                {topFindings.map((issue) => (
                  <li key={issue.id}>
                    <a href={issueHref(report.runId, issue.id)}>{issueLabel(issue, issueNames)}</a>
                    <span>
                      {severityLabels[issue.severity]} · {Math.round(issue.confidence * 100)}% ·{" "}
                      {issue.routeId}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </section>
        </>
      )}
    </section>
  );
}
