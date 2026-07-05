import { ScoreCard } from "../../components/ScoreCard/ScoreCard";
import { SummaryBar } from "../../components/SummaryBar/SummaryBar";
import {
  fetchStylePropagationPlan,
  type StylePropagationPlan
} from "../../api/mutations";
import { useIssueNames, issueLabel } from "../../hooks/useIssueNames";
import { severityOrder, sortIssues } from "../../lib/filtering/filtering";
import type { IssueCategory, IssueSeverity, ScanReport } from "../../types/report";
import { useEffect, useState } from "react";
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
  const [stylePlan, setStylePlan] = useState<StylePropagationPlan | undefined>();
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

  useEffect(() => {
    let ignore = false;
    if (!apiBaseUrl || mode !== "live") {
      setStylePlan(undefined);
      return;
    }

    void fetchStylePropagationPlan(apiBaseUrl, report.runId, mutationToken).then((plan) => {
      if (!ignore) setStylePlan(plan);
    });

    return () => {
      ignore = true;
    };
  }, [apiBaseUrl, mode, mutationToken, report.runId]);

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
          label="Drift risk"
          value={100 - report.summary.driftScore}
          detail={`${report.summary.totalIssues} open findings across ${routeCount} routes. Lower is healthier.`}
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

      <StylePropagationPanel plan={stylePlan} mode={mode} />

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

function StylePropagationPanel({
  mode,
  plan
}: {
  mode: "live" | "fixture";
  plan?: StylePropagationPlan;
}) {
  if (mode !== "live") {
    return (
      <section className="overview__panel overview__style-agent">
        <div>
          <p className="overview__eyebrow">Style propagation agent</p>
          <h2>Live API required</h2>
          <p>
            Start the DriftRadar API with an OpenAI key to compare recent git style changes and
            generate a source-backed propagation plan.
          </p>
        </div>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className="overview__panel overview__style-agent">
        <p className="overview__eyebrow">Style propagation agent</p>
        <h2>Reading recent style changes…</h2>
      </section>
    );
  }

  const topOpportunity = plan.opportunities[0];
  return (
    <section className="overview__panel overview__style-agent">
      <div className="overview__style-agent-header">
        <div>
          <p className="overview__eyebrow">Style propagation agent</p>
          <h2>{plan.theme}</h2>
          <p>{plan.summary}</p>
        </div>
        <span className={`overview__agent-badge overview__agent-badge--${plan.source}`}>
          {plan.source === "openai" ? "OpenAI backed" : "Deterministic fallback"}
        </span>
      </div>

      <ol className="overview__proof-chain" aria-label="Style propagation proof chain">
        <li>
          <span>1</span>
          <strong>Read git style diff</strong>
          <small>
            {plan.baseRef} → {plan.headRef}
          </small>
        </li>
        <li>
          <span>2</span>
          <strong>Infer design direction</strong>
          <small>{plan.source === "openai" ? "OpenAI structured output" : "Local fallback"}</small>
        </li>
        <li>
          <span>3</span>
          <strong>Map stale surfaces</strong>
          <small>{plan.opportunities.length} propagation targets</small>
        </li>
        <li>
          <span>4</span>
          <strong>Hand off fixes</strong>
          <small>Review, apply, export PR packet</small>
        </li>
      </ol>

      {topOpportunity ? (
        <article className="overview__opportunity">
          <div>
            <strong>{topOpportunity.component}</strong>
            <span>{Math.round(topOpportunity.confidence * 100)}% confidence</span>
          </div>
          <p>{topOpportunity.recommendedChange}</p>
          <p className="overview__opportunity-rationale">{topOpportunity.rationale}</p>
          {topOpportunity.targetFiles.length ? (
            <ul>
              {topOpportunity.targetFiles.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}

      <div className="overview__agent-columns">
        <div>
          <h3>Evidence</h3>
          <ul>
            {(plan.evidence.length ? plan.evidence : [`${plan.baseRef} → ${plan.headRef}`]).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>
        </div>
        <div>
          <h3>Next actions</h3>
          <ul>
            {plan.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
