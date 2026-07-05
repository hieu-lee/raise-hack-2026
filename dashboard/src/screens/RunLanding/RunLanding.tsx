import type { DashboardConnection } from "../../api/client";
import type { DriftReport } from "../../types/report";
import "./RunLanding.css";

interface RunLandingProps {
  connection: DashboardConnection;
  loading?: boolean;
  report?: DriftReport;
}

export function RunLanding({ connection, loading = false, report }: RunLandingProps) {
  if (loading) {
    return (
      <SetupPanel title="Loading API" body="Checking the local DriftRadar backend and fixture." />
    );
  }

  if (!report) {
    const title = connection.mode === "no-runs" ? "No scan runs found" : "Disconnected";
    return (
      <SetupPanel
        title={title}
        body={connection.message ?? "Start the backend or restore the frontend fixture."}
      />
    );
  }

  const pageCount = report.pages?.length ?? 0;
  const screenshotCount = report.pages?.filter((page) => page.screenshotPath).length ?? 0;
  const tokenCount = Object.values(report.tokens?.counts ?? {}).reduce(
    (sum, count) => sum + count,
    0
  );
  const routeCount =
    report.configSummary?.routes ??
    new Set(report.pages?.map((page) => page.routeId).filter(Boolean)).size;

  return (
    <section className="run-landing" aria-labelledby="run-landing-title">
      {connection.mode === "fixture" ? (
        <div className="run-landing__notice" role="status">
          Fixture mode: start <code>pnpm demo:serve</code> for live data.
        </div>
      ) : null}
      <div className="run-landing__hero">
        <div className="run-landing__hero-copy">
          <p className="run-landing__eyebrow">AI-native design-system gate</p>
          <h1 id="run-landing-title">{report.projectName}</h1>
          <p className="run-landing__lede">
            DriftRadar scans live UI surfaces, compares them with local tokens, and uses AI to
            propagate new style direction into reviewable fixes.
          </p>
          <div className="run-landing__actions">
            <a className="button button--primary" href="#/issues">
              Triage issues
            </a>
            <a className="button" href="#/walkthrough">
              Start walkthrough
            </a>
            <a className="button" href="#/overview">
              See summary
            </a>
          </div>
        </div>
        <dl className="run-landing__metadata">
          <div>
            <dt>Run ID</dt>
            <dd>{report.runId}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(report.createdAt)}</dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>v{report.schemaVersion}</dd>
          </div>
        </dl>
      </div>
      <div className="run-landing__stats" aria-label="Scan summary">
        <Stat label="Total issues" value={report.summary.totalIssues} />
        <Stat label="Drift risk" value={100 - report.summary.driftScore} />
        <Stat label="Routes scanned" value={routeCount} />
        <Stat label="Page captures" value={pageCount} />
        <Stat label="Screenshots" value={screenshotCount} />
        <Stat label="Tokens loaded" value={tokenCount} />
      </div>
    </section>
  );
}

function SetupPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="setup-panel" aria-labelledby="setup-title">
      <h1 id="setup-title">{title}</h1>
      <p>{body}</p>
      <ol>
        <li>
          Run <code>pnpm install</code>
        </li>
        <li>
          Run <code>pnpm demo:backend</code>
        </li>
        <li>
          Run <code>pnpm demo:serve</code>
        </li>
        <li>
          In another terminal, run <code>pnpm --dir dashboard dev</code>
        </li>
      </ol>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="run-landing__stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
