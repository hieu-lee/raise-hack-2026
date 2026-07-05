import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import fixtureReport from "../../../public/fixtures/frontend-handoff-run/report.json";
import type { DriftReport } from "../../types/report";
import { IssueWorkbench } from "./IssueWorkbench";

const report = fixtureReport as DriftReport;
const resolveAssetUrl = (path: string) => `/fixtures/frontend-handoff-run/${path}`;

const workbenchProps = {
  apiBaseUrl: "http://localhost:4317",
  connectionMode: "fixture" as const,
  report,
  resolveAssetUrl
};

describe("IssueWorkbench", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("hides copilot in fixture mode", () => {
    render(<IssueWorkbench {...workbenchProps} connectionMode="fixture" />);
    expect(screen.queryByLabelText(/Drift copilot/i)).not.toBeInTheDocument();
  });

  it("shows copilot in live mode", () => {
    render(<IssueWorkbench {...workbenchProps} connectionMode="live" />);
    expect(screen.getByRole("button", { name: /Open copilot/i })).toBeInTheDocument();
  });

  it("starts on the highest-priority sorted issue", () => {
    render(<IssueWorkbench {...workbenchProps} />);

    const detail = screen.getByRole("region", { name: /Issue detail/i });
    expect(
      within(detail).getByRole("heading", { name: /Focus ring regressed/i })
    ).toBeInTheDocument();
  });

  it("selects issues and updates the detail panel", async () => {
    const user = userEvent.setup();
    render(<IssueWorkbench {...workbenchProps} />);

    await user.click(screen.getByRole("button", { name: /Repeated 44px pill radius/i }));

    const detail = screen.getByRole("region", { name: /Issue detail/i });
    expect(
      within(detail).getByRole("heading", { name: /Repeated 44px pill radius/i })
    ).toBeInTheDocument();
    expect(within(detail).getByText(/Promote the repeated 44px radius/i)).toBeInTheDocument();
    expect(window.location.search).toContain("runId=frontend-handoff-run");
    expect(window.location.search).toContain("issue=issue-pill-radius");
  });

  it("filters deterministically and selects the first visible issue when needed", async () => {
    const user = userEvent.setup();
    render(<IssueWorkbench {...workbenchProps} />);

    await user.selectOptions(screen.getByLabelText("Severity"), "critical");

    expect(screen.getByText("1/4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Primary button uses/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Focus ring regressed/i })).toBeInTheDocument();
  });

  it("updates a stale selected issue param when filters hide it", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?issue=issue-token-blue#/issues");

    render(<IssueWorkbench {...workbenchProps} />);

    await user.selectOptions(screen.getByLabelText("Severity"), "low");

    expect(screen.getByRole("heading", { name: /Dark preview surface/i })).toBeInTheDocument();
    expect(window.location.search).toContain("issue=issue-dark-exception");
  });

  it("normalizes the run id for an initially selected visible issue", async () => {
    window.history.replaceState(null, "", "/?issue=issue-token-blue#/issues");

    render(<IssueWorkbench {...workbenchProps} />);

    expect(screen.getByRole("heading", { name: /Primary button uses/i })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain("runId=frontend-handoff-run"));
    expect(window.location.search).toContain("issue=issue-token-blue");
  });

  it("loads filters from URL params and persists changes", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      "",
      "/?runId=demo-run&severity=critical&sort=confidence#/issues"
    );

    render(<IssueWorkbench {...workbenchProps} />);

    expect(screen.getByLabelText("Severity")).toHaveValue("critical");
    expect(screen.getByLabelText("Sort")).toHaveValue("confidence");
    expect(screen.getByText("1/4")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Category"), "token_misuse");

    expect(window.location.search).toContain("runId=frontend-handoff-run");
    expect(window.location.search).toContain("severity=critical");
    expect(window.location.search).toContain("category=token_misuse");
    expect(window.location.hash).toBe("#/issues");
  });

  it("supports keyboard row selection", async () => {
    const user = userEvent.setup();
    render(<IssueWorkbench {...workbenchProps} />);

    const firstRow = screen.getByRole("button", { name: /Focus ring regressed/i });
    firstRow.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("heading", { name: /Primary button uses/i })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("heading", { name: /Repeated 44px pill radius/i })).toBeInTheDocument();
  });

  it("updates row review status from detail actions", async () => {
    const user = userEvent.setup();
    render(<IssueWorkbench {...workbenchProps} />);

    await user.click(screen.getByRole("button", { name: "Accept exception" }));

    const selectedRow = screen.getByRole("button", { name: /Focus ring regressed/i });
    expect(
      within(selectedRow).getByLabelText("Review status: Accepted exception")
    ).toBeInTheDocument();
  });

  it("shows a no-results state", async () => {
    const user = userEvent.setup();
    render(<IssueWorkbench {...workbenchProps} />);

    await user.type(screen.getByRole("searchbox"), "does-not-exist");

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a finding" })).toBeInTheDocument();
  });
});
