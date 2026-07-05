import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import fixtureReport from "../../../public/fixtures/frontend-handoff-run/report.json";
import type { ScanReport } from "../../types/report";
import { Overview } from "./Overview";

const report = fixtureReport as ScanReport;

describe("Overview", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("renders summary counts directly from the report", () => {
    render(<Overview report={report} />);

    const severity = screen.getByLabelText("Severity counts");
    expect(within(severity).getByText("Critical")).toBeInTheDocument();
    expect(within(severity).getAllByText("1")).toHaveLength(4);
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("4 open findings across 5 routes")).toBeInTheDocument();
  });

  it("shows highest-priority findings by severity then confidence", () => {
    window.history.pushState(null, "", "?runId=frontend-handoff-run");
    render(<Overview report={report} />);

    const findings = within(
      screen.getByText("Highest-priority findings").closest("section")!
    ).getAllByRole("listitem");
    expect(findings[0]).toHaveTextContent("Focus ring regressed from the system color");
    expect(findings[1]).toHaveTextContent("Primary button uses a near-token blue literal");
    expect(findings[0]).toHaveTextContent("92%");
    expect(within(findings[0]).getByRole("link")).toHaveAttribute(
      "href",
      "?runId=frontend-handoff-run&issue=issue-focus-ring#/issues"
    );
  });

  it("does not carry stale issue filters into finding links", () => {
    window.history.pushState(null, "", "?runId=frontend-handoff-run&severity=low&q=button");
    render(<Overview report={report} />);

    expect(screen.getByRole("link", { name: /Focus ring regressed/i })).toHaveAttribute(
      "href",
      "?runId=frontend-handoff-run&issue=issue-focus-ring#/issues"
    );
  });

  it("uses the report run id in finding links when the URL has no run id", () => {
    render(<Overview report={report} />);

    expect(screen.getByRole("link", { name: /Focus ring regressed/i })).toHaveAttribute(
      "href",
      "?runId=frontend-handoff-run&issue=issue-focus-ring#/issues"
    );
  });

  it("shows a token metadata fallback", () => {
    render(<Overview report={{ ...report, tokens: undefined }} />);

    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Token metadata unavailable")).toBeInTheDocument();
  });

  it("does not treat zero token counts as missing metadata", () => {
    render(
      <Overview report={{ ...report, tokens: { ...report.tokens, counts: { colors: 0 } } }} />
    );

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
  });

  it("shows high drift scores as healthy", () => {
    render(<Overview report={{ ...report, summary: { ...report.summary, driftScore: 100 } }} />);

    expect(screen.getByText("100").closest("article")).toHaveClass("score-card--good");
  });

  it("renders the zero-issue state", () => {
    render(
      <Overview
        report={{
          ...report,
          summary: {
            ...report.summary,
            totalIssues: 0,
            countsByCategory: {
              token_misuse: 0,
              new_pattern_candidate: 0,
              accidental_regression: 0,
              acceptable_exception: 0
            },
            countsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 }
          },
          issues: []
        }}
      />
    );

    expect(screen.getByText("No drift found")).toBeInTheDocument();
  });
});
