// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../api/client";
import type { DriftReport } from "../../types/report";
import { RunLanding } from "./RunLanding";

const report: DriftReport = {
  schemaVersion: 1,
  runId: "frontend-handoff-run",
  projectName: "DriftRadar sample app",
  createdAt: "2026-07-03T13:00:00.000Z",
  configSummary: { routes: 5, viewports: 2, states: ["default"], tokenFiles: 1 },
  summary: {
    totalIssues: 4,
    countsByCategory: {},
    countsBySeverity: {},
    driftScore: 44
  },
  tokens: { counts: { colors: 2, spacing: 1 } },
  pages: [
    { routeId: "buttons", viewport: "desktop", state: "default", screenshotPath: "a.png" },
    { routeId: "cards", viewport: "desktop", state: "default" }
  ],
  issues: []
};

describe("RunLanding", () => {
  afterEach(() => cleanup());

  it("renders the scan identity and stats for a live report", () => {
    render(
      <RunLanding
        connection={{ mode: "live", apiBaseUrl: DEFAULT_API_BASE_URL, runId: report.runId }}
        report={report}
      />
    );

    expect(screen.getByRole("heading", { name: "DriftRadar sample app" })).toBeTruthy();
    expect(screen.getByText("frontend-handoff-run")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByText("44")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View issues" }).getAttribute("href")).toBe("#/issues");
  });

  it("shows fixture mode when the live backend is unavailable", () => {
    render(
      <RunLanding
        connection={{
          mode: "fixture",
          apiBaseUrl: DEFAULT_API_BASE_URL,
          runId: report.runId,
          message: "fixture"
        }}
        report={report}
      />
    );

    expect(screen.getByRole("status").textContent).toContain("Fixture mode");
  });

  it("renders no-runs setup instructions without a report", () => {
    render(
      <RunLanding
        connection={{
          mode: "no-runs",
          apiBaseUrl: DEFAULT_API_BASE_URL,
          message: "No runs"
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "No scan runs found" })).toBeTruthy();
    expect(screen.getByText("pnpm demo:serve")).toBeTruthy();
  });

  it("renders disconnected setup instructions without a fixture", () => {
    render(
      <RunLanding
        connection={{
          mode: "disconnected",
          apiBaseUrl: DEFAULT_API_BASE_URL,
          message: "No data"
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Disconnected" })).toBeTruthy();
    expect(screen.getByText("pnpm --dir dashboard dev")).toBeTruthy();
  });
});
