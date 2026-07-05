import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixtureReport from "../../../public/fixtures/frontend-handoff-run/report.json";
import type { DriftReport } from "../../types/report";
import { IssueDetail } from "./IssueDetail";

const report = fixtureReport as DriftReport;
const resolveAssetUrl = (path: string) => `/fixtures/frontend-handoff-run/${path}`;
const issueNames = Object.fromEntries(report.issues.map((issue) => [issue.id, issue.title]));

describe("IssueDetail", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders evidence metadata and unified diff", () => {
    render(
      <IssueDetail
        issue={report.issues[0]}
        issueNames={issueNames}
        resolveAssetUrl={resolveAssetUrl}
        runId={report.runId}
      />
    );

    expect(screen.getByText("#1f6fe5")).toBeInTheDocument();
    expect(screen.getByText("var(--color-primary-600)")).toBeInTheDocument();
    expect(screen.getByText("background: #1f6fe5;")).toBeInTheDocument();
    expect(screen.getByText("background: var(--color-primary-600);")).toBeInTheDocument();
  });

  it("renders issues without CSS snippets as actionable text", () => {
    const issue = report.issues.find((candidate) => candidate.id === "issue-dark-exception")!;
    render(
      <IssueDetail
        issue={issue}
        issueNames={issueNames}
        resolveAssetUrl={resolveAssetUrl}
        runId={report.runId}
      />
    );

    expect(screen.getByText(/Keep the exception documented/i)).toBeInTheDocument();
    expect(screen.getByText("No patch available.")).toBeInTheDocument();
  });

  it("shows a fallback when expected value is omitted", () => {
    const issue = { ...report.issues[0], expectedValue: undefined };
    render(
      <IssueDetail issue={issue} issueNames={issueNames} resolveAssetUrl={resolveAssetUrl} runId={report.runId} />
    );

    const detail = screen.getByRole("region", { name: /Issue detail/i });
    expect(within(detail).getByText("—")).toBeInTheDocument();
  });

  it("mounts Dev 5 review actions", async () => {
    const user = userEvent.setup();
    render(
      <IssueDetail
        issue={report.issues[0]}
        issueNames={issueNames}
        resolveAssetUrl={resolveAssetUrl}
        runId={report.runId}
      />
    );

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(screen.getByLabelText("Review status: Reviewed")).toBeInTheDocument();
  });

  it("calls apply fix API when enabled", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IssueDetail
        apiBaseUrl="http://localhost:4317"
        applyEnabled
        issue={report.issues[0]}
        issueNames={issueNames}
        resolveAssetUrl={resolveAssetUrl}
        runId={report.runId}
      />
    );

    await user.click(screen.getByRole("button", { name: /Apply fix/i }));

    await waitForApply(fetchMock);
    vi.unstubAllGlobals();
  });

  it("navigates related issues", async () => {
    const user = userEvent.setup();
    const onNavigateIssue = vi.fn();
    const issue = {
      ...report.issues[0],
      evidence: { ...report.issues[0].evidence!, relatedIssueIds: ["issue-dark-exception"] }
    };

    render(
      <IssueDetail
        issue={issue}
        issueNames={issueNames}
        onNavigateIssue={onNavigateIssue}
        resolveAssetUrl={resolveAssetUrl}
        runId={report.runId}
      />
    );

    await user.click(screen.getByRole("button", { name: /Dark preview surface/i }));
    expect(onNavigateIssue).toHaveBeenCalledWith("issue-dark-exception");
  });

  it("renders all backend categories readably", () => {
    for (const issue of report.issues) {
      const { unmount } = render(
        <IssueDetail
          issue={issue}
          issueNames={issueNames}
          resolveAssetUrl={resolveAssetUrl}
          runId={report.runId}
        />
      );
      const detail = screen.getByRole("region", { name: /Issue detail/i });
      expect(within(detail).getByRole("heading", { name: issue.title })).toBeInTheDocument();
      expect(within(detail).getByText(issue.reasoning)).toBeInTheDocument();
      unmount();
    }
  });
});

async function waitForApply(fetchMock: ReturnType<typeof vi.fn>) {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}
