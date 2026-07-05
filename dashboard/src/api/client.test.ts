import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_URL,
  FIXTURE_ROOT,
  assetUrlFor,
  fetchExportMarkdown,
  loadDashboardData,
  runIdFromSearch
} from "./client";
import type { DriftReport } from "../types/report";

const report: DriftReport = {
  schemaVersion: 1,
  runId: "demo-run",
  projectName: "Demo",
  createdAt: "2026-07-03T13:00:00.000Z",
  configSummary: { routes: 1, viewports: 1, states: ["default"], tokenFiles: 1 },
  summary: {
    totalIssues: 0,
    countsByCategory: {},
    countsBySeverity: {},
    driftScore: 0
  },
  tokens: { counts: { colors: 1 } },
  pages: [],
  issues: []
};

describe("dashboard API client", () => {
  it("loads the newest live run when the API is available", async () => {
    const calls: string[] = [];
    const fetcher = mockFetch(calls, {
      [`${DEFAULT_API_BASE_URL}/api/health`]: { status: "ok" },
      [`${DEFAULT_API_BASE_URL}/api/runs`]: {
        runs: [
          { runId: "older", createdAt: "2026-07-05T09:00:00.000Z" },
          { runId: "newest", createdAt: "2026-07-05T09:05:00.000Z" }
        ]
      },
      [`${DEFAULT_API_BASE_URL}/api/runs/newest/report`]: { ...report, runId: "newest" }
    });

    const data = await loadDashboardData({ fetcher });

    expect(data.connection.mode).toBe("live");
    expect(data.report?.runId).toBe("newest");
    expect(calls).toEqual([
      `${DEFAULT_API_BASE_URL}/api/health`,
      `${DEFAULT_API_BASE_URL}/api/runs`,
      `${DEFAULT_API_BASE_URL}/api/runs/newest/report`
    ]);
  });

  it("uses the requested run id from options", async () => {
    const fetcher = mockFetch([], {
      [`${DEFAULT_API_BASE_URL}/api/health`]: { status: "ok" },
      [`${DEFAULT_API_BASE_URL}/api/runs`]: { runs: [{ runId: "newest" }] },
      [`${DEFAULT_API_BASE_URL}/api/runs/requested/report`]: { ...report, runId: "requested" }
    });

    const data = await loadDashboardData({ fetcher, runId: "requested" });

    expect(data.connection.runId).toBe("requested");
    expect(data.report?.runId).toBe("requested");
  });

  it("falls back to the committed fixture when health fails", async () => {
    const fetcher = mockFetch([], {
      [`${DEFAULT_API_BASE_URL}/api/health`]: undefined,
      [`${FIXTURE_ROOT}/report.json`]: { ...report, runId: "frontend-handoff-run" }
    });

    const data = await loadDashboardData({ fetcher });

    expect(data.connection.mode).toBe("fixture");
    expect(data.report?.runId).toBe("frontend-handoff-run");
  });

  it("can load fixture data without probing the live API", async () => {
    const calls: string[] = [];
    const fetcher = mockFetch(calls, {
      [`${FIXTURE_ROOT}/report.json`]: { ...report, runId: "frontend-handoff-run" }
    });

    const data = await loadDashboardData({ fetcher, fixtureOnly: true });

    expect(data.connection.mode).toBe("fixture");
    expect(data.report?.runId).toBe("frontend-handoff-run");
    expect(calls).toEqual([`${FIXTURE_ROOT}/report.json`]);
  });

  it("returns no-runs without falling back when live API has no runs", async () => {
    const fetcher = mockFetch([], {
      [`${DEFAULT_API_BASE_URL}/api/health`]: { status: "ok" },
      [`${DEFAULT_API_BASE_URL}/api/runs`]: { runs: [] },
      [`${FIXTURE_ROOT}/report.json`]: report
    });

    const data = await loadDashboardData({ fetcher });

    expect(data.connection.mode).toBe("no-runs");
    expect(data.report).toBeUndefined();
  });

  it("does not hide live report failures behind fixture data", async () => {
    const fetcher = mockFetch([], {
      [`${DEFAULT_API_BASE_URL}/api/health`]: { status: "ok" },
      [`${DEFAULT_API_BASE_URL}/api/runs`]: { runs: [{ runId: "missing" }] },
      [`${DEFAULT_API_BASE_URL}/api/runs/missing/report`]: undefined,
      [`${FIXTURE_ROOT}/report.json`]: { ...report, runId: "frontend-handoff-run" }
    });

    const data = await loadDashboardData({ fetcher });

    expect(data.connection.mode).toBe("disconnected");
    expect(data.report).toBeUndefined();
  });

  it("resolves live and fixture asset URLs", () => {
    expect(
      assetUrlFor(
        { mode: "live", apiBaseUrl: "http://localhost:4317/", runId: "demo run" },
        "screenshots/buttons/desktop/default.png"
      )
    ).toBe(
      "http://localhost:4317/api/runs/demo%20run/assets/screenshots/buttons/desktop/default.png"
    );

    expect(
      assetUrlFor(
        { mode: "fixture", apiBaseUrl: DEFAULT_API_BASE_URL, runId: "frontend-handoff-run" },
        "screenshots/buttons/desktop/default.png"
      )
    ).toBe(`${FIXTURE_ROOT}/screenshots/buttons/desktop/default.png`);
  });

  it("fetches export markdown as text", async () => {
    const fetcher = mockFetch([], {
      [`${FIXTURE_ROOT}/pr-comments.md`]: "# PR comments"
    });

    await expect(
      fetchExportMarkdown(
        {
          mode: "fixture",
          apiBaseUrl: DEFAULT_API_BASE_URL,
          runId: "frontend-handoff-run"
        },
        fetcher
      )
    ).resolves.toBe("# PR comments");
  });

  it("generates export markdown from the report when fixture markdown is missing", async () => {
    const fetcher = mockFetch([], {
      [`${FIXTURE_ROOT}/pr-comments.md`]: undefined
    });

    await expect(
      fetchExportMarkdown(
        {
          mode: "fixture",
          apiBaseUrl: DEFAULT_API_BASE_URL,
          runId: "frontend-handoff-run"
        },
        fetcher,
        {
          ...report,
          issues: [
            {
              id: "issue-1",
              title: "Button color drift",
              category: "token_misuse",
              severity: "high",
              confidence: 0.9,
              routeId: "buttons",
              viewport: "desktop",
              state: "default",
              elementId: "button-primary",
              selectorHint: ".button-primary",
              property: "color",
              observedValue: "#1f6fe5",
              expectedValue: "var(--color-primary-600)",
              reasoning: "Literal color is near a token.",
              evidence: {
                screenshotPath: "screenshots/buttons/desktop/default.png"
              },
              suggestedFix: {
                type: "replace-css",
                humanInstruction: "Use the primary color token."
              },
              status: "open"
            }
          ]
        }
      )
    ).resolves.toContain("Use the primary color token.");
  });

  it("parses a run id from URL search params", () => {
    expect(runIdFromSearch("?runId=abc-123")).toBe("abc-123");
    expect(runIdFromSearch("?screen=overview")).toBeUndefined();
  });
});

function mockFetch(calls: string[], responses: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const key = typeof url === "string" ? url : url.toString();
    calls.push(key);
    const value = responses[key];

    if (value === undefined) {
      return new Response("not found", { status: 404 });
    }

    if (typeof value === "string") {
      return new Response(value, { status: 200 });
    }

    return Response.json(value);
  }) as typeof fetch;
}
