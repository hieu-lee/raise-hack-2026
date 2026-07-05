// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { DEFAULT_API_BASE_URL, FIXTURE_ROOT } from "./api/client";

describe("App", () => {
  it("renders the fixture-backed run landing when live API is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const key = typeof url === "string" ? url : url.toString();
      if (key === `${DEFAULT_API_BASE_URL}/api/health`) {
        return new Response("not found", { status: 404 });
      }
      if (key === `${FIXTURE_ROOT}/report.json`) {
        return Response.json({
          schemaVersion: 1,
          runId: "frontend-handoff-run",
          projectName: "Fixture Project",
          createdAt: "2026-07-03T13:00:00.000Z",
          configSummary: { routes: 1 },
          summary: {
            totalIssues: 1,
            countsByCategory: {},
            countsBySeverity: {},
            driftScore: 44
          },
          tokens: { counts: { colors: 1 } },
          pages: [],
          issues: []
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      window.location.hash = "#/";
      render(<App />);
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Fixture Project" })).toBeTruthy()
      );
      expect(screen.getByText("Fixture")).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
