// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriftReport } from "../../lib/report-types";
import { ExportScreen } from "./ExportScreen";
import { generateExportMarkdown, loadExportMarkdown } from "./export-markdown";

const report: DriftReport = {
  schemaVersion: 1,
  runId: "run-1",
  projectName: "Sample app",
  createdAt: "2026-07-03T12:00:00.000Z",
  configSummary: { routes: 1 },
  summary: {
    totalIssues: 1,
    countsByCategory: { token_misuse: 1 },
    countsBySeverity: { high: 1 },
    driftScore: 44
  },
  pages: [],
  issues: [
    {
      id: "issue-1",
      title: "Button uses literal blue",
      category: "token_misuse",
      severity: "high",
      confidence: 0.9,
      routeId: "buttons",
      viewport: "desktop",
      state: "default",
      elementId: "button-1",
      selectorHint: ".button",
      property: "color",
      observedValue: "#1f6fe5",
      expectedValue: "var(--color-primary-600)",
      evidence: { screenshotPath: "screenshots/buttons/desktop/default.png" },
      reasoning: "The color is close to the token but hardcoded.",
      suggestedFix: {
        type: "replace_css",
        cssBefore: "background: #1f6fe5;",
        cssAfter: "background: var(--color-primary-600);",
        humanInstruction: "Use the primary token."
      },
      status: "open"
    }
  ]
};

describe("export markdown", () => {
  it("generates fallback markdown with reasoning and suggested fix", () => {
    const markdown = generateExportMarkdown(report);

    expect(markdown).toContain("Button uses literal blue");
    expect(markdown).toContain("Severity: high");
    expect(markdown).toContain("Route: buttons");
    expect(markdown).toContain("The color is close to the token but hardcoded.");
    expect(markdown).toContain("Use the primary token.");
    expect(markdown).toContain("background: var(--color-primary-600);");
  });

  it("loads live markdown when endpoint succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("live markdown"));

    await expect(loadExportMarkdown({ fetcher, mode: "live", report })).resolves.toEqual({
      markdown: "live markdown",
      source: "live"
    });
    expect(fetcher).toHaveBeenCalledWith("http://localhost:4317/api/runs/run-1/export/pr-comments");
  });

  it("falls back when fixture export is unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    const result = await loadExportMarkdown({ fetcher, mode: "fixture", report });

    expect(result.source).toBe("fallback");
    expect(result.markdown).toContain("Button uses literal blue");
  });
});

describe("ExportScreen", () => {
  afterEach(cleanup);

  it("renders fixture markdown, summaries, copy, and rerun commands", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const fetcher = vi.fn().mockResolvedValue(new Response("fixture markdown"));

    render(<ExportScreen fetcher={fetcher} mode="fixture" report={report} />);

    expect(await screen.findByText("Markdown source: fixture")).toBeTruthy();
    expect(screen.getByLabelText("PR comment preview").textContent).toContain("fixture markdown");
    expect(screen.getByLabelText("Severity summary").textContent).toContain("high: 1");
    expect(screen.getByLabelText("Category summary").textContent).toContain("token_misuse: 1");

    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fixture markdown");
    expect(screen.getByLabelText("Rerun commands").textContent).toContain("pnpm demo:backend");
  });

  it("shows the next report fallback immediately while export reloads", () => {
    const fetcher = vi.fn(
      () =>
        new Promise<Response>(() => {
          // keep the export request pending
        })
    );
    const nextReport: DriftReport = {
      ...report,
      runId: "run-2",
      issues: [
        {
          ...report.issues[0],
          id: "issue-2",
          title: "Focus ring regressed",
          routeId: "forms"
        }
      ]
    };

    const { rerender } = render(<ExportScreen fetcher={fetcher} mode="live" report={report} />);
    expect(screen.getByLabelText("PR comment preview").textContent).toContain(
      "Button uses literal blue"
    );

    rerender(<ExportScreen fetcher={fetcher} mode="live" report={nextReport} />);

    expect(screen.getByLabelText("PR comment preview").textContent).toContain(
      "Focus ring regressed"
    );
    expect(screen.getByLabelText("PR comment preview").textContent).not.toContain(
      "Button uses literal blue"
    );
  });
});
