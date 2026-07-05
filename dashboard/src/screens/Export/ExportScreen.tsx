import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "../../components/CopyButton/CopyButton";
import { DemoCallout } from "../../components/DemoCallout";
import type { DriftReport } from "../../lib/report-types";
import {
  countByCategory,
  countBySeverity,
  generateExportMarkdown,
  loadExportMarkdown
} from "./export-markdown";
import "./ExportScreen.css";

interface ExportScreenProps {
  report: DriftReport;
  mode: "live" | "fixture";
  apiBaseUrl?: string;
  fixtureBasePath?: string;
  fetcher?: typeof fetch;
}

type ExportSource = "live" | "fixture" | "fallback";

export function ExportScreen({
  report,
  mode,
  apiBaseUrl,
  fixtureBasePath,
  fetcher
}: ExportScreenProps) {
  const reportKey = `${report.runId}:${report.summary.totalIssues}:${report.issues.length}`;
  const fallbackMarkdown = useMemo(() => generateExportMarkdown(report), [report]);
  const [exportState, setExportState] = useState<{
    markdown: string;
    reportKey: string;
    source: ExportSource;
  }>(() => ({
    markdown: fallbackMarkdown,
    reportKey,
    source: "fallback"
  }));
  const currentExport =
    exportState.reportKey === reportKey
      ? exportState
      : { markdown: fallbackMarkdown, reportKey, source: "fallback" as const };
  const severityCounts = useMemo(() => countBySeverity(report.issues), [report.issues]);
  const categoryCounts = useMemo(() => countByCategory(report.issues), [report.issues]);

  useEffect(() => {
    let mounted = true;

    void loadExportMarkdown({ apiBaseUrl, fetcher, fixtureBasePath, mode, report }).then((next) => {
      if (!mounted) return;
      setExportState({ markdown: next.markdown, reportKey, source: next.source });
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, fetcher, fixtureBasePath, mode, report, reportKey]);

  function download() {
    const url = URL.createObjectURL(new Blob([currentExport.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.runId}-driftradar-pr-comments.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="export-screen" aria-labelledby="export-title">
      <DemoCallout kind="export" />
      <div className="export-screen__heading">
        <div>
          <h2 id="export-title">Export PR comment</h2>
          <p className="export-screen__source">Markdown source: {currentExport.source}</p>
        </div>
        <div className="export-screen__actions" aria-label="Export actions">
          <CopyButton getText={() => currentExport.markdown} label="Copy all" />
          <button onClick={download} type="button">
            Download markdown
          </button>
        </div>
      </div>

      <div className="export-screen__summaries">
        <section className="export-summary" aria-label="Severity summary">
          <p className="export-summary__title">Severity</p>
          {Object.entries(severityCounts).map(([severity, count]) => (
            <span className="export-summary__chip" key={severity}>
              {severity}: {count}
            </span>
          ))}
        </section>

        <section className="export-summary" aria-label="Category summary">
          <p className="export-summary__title">Category</p>
          {Object.entries(categoryCounts).map(([category, count]) => (
            <span className="export-summary__chip" key={category}>
              {category}: {count}
            </span>
          ))}
        </section>
      </div>

      <pre aria-label="PR comment preview" className="export-screen__preview dr-code-scroll">
        {currentExport.markdown}
      </pre>

      <section className="export-screen__rerun" aria-label="Rerun commands">
        <p className="export-summary__title">Rerun locally</p>
        <code>pnpm demo:backend</code>
        <code>pnpm demo:serve</code>
      </section>
    </section>
  );
}
