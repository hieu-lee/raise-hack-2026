// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { DEFAULT_API_BASE_URL, FIXTURE_ROOT } from "./api/client";

let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("starts each route at the top of the page", async () => {
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

      window.location.hash = "#/export";
      window.dispatchEvent(new HashChangeEvent("hashchange"));

      await waitFor(() =>
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps fixture mode while navigating from run to walkthrough", async () => {
    const originalFetch = globalThis.fetch;
    const user = userEvent.setup();
    globalThis.fetch = (async (url: string | URL | Request) => {
      const key = typeof url === "string" ? url : url.toString();
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
            countsBySeverity: { critical: 1 },
            driftScore: 44
          },
          tokens: { counts: { colors: 1 } },
          pages: [],
          issues: [
            {
              id: "issue-1",
              title: "Focus ring regressed",
              category: "accidental_regression",
              severity: "critical",
              confidence: 0.95,
              routeId: "forms",
              viewport: "desktop",
              state: "focus",
              elementId: "primary-action",
              selectorHint: ".primary-action:focus",
              property: "outline-color",
              observedValue: "#ff4d4f",
              expectedValue: "var(--color-focus-ring)",
              reasoning: "The focus ring uses an alert color instead of the shared focus token.",
              suggestedFix: {
                type: "replace-css",
                cssAfter: "outline-color: var(--color-focus-ring);",
                humanInstruction: "Use the shared focus-ring token."
              },
              status: "open"
            }
          ]
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      window.history.replaceState(null, "", "/?fixture=1#/");
      render(<App />);
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Fixture Project" })).toBeTruthy()
      );

      await user.click(
        within(screen.getByRole("navigation", { name: /Dashboard/i })).getByRole("link", {
          name: /Walkthrough/i
        })
      );

      expect(window.location.href).toContain("?fixture=1#/walkthrough");
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: /Replay the review in five minutes/i })
        ).toBeTruthy()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
