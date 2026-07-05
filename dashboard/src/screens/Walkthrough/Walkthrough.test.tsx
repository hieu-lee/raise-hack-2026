// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixtureReport from "../../../public/fixtures/frontend-handoff-run/report.json";
import type { DashboardConnection } from "../../api/client";
import type { DriftReport } from "../../types/report";
import { Walkthrough } from "./Walkthrough";

const report = fixtureReport as DriftReport;
const connection: DashboardConnection = {
  mode: "fixture",
  apiBaseUrl: "http://localhost:4317",
  runId: report.runId
};
const resolveAssetUrl = (path: string) => `/fixtures/frontend-handoff-run/${path}`;

describe("Walkthrough", () => {
  afterEach(() => cleanup());

  it("starts with captured evidence and proof metrics", () => {
    render(<Walkthrough connection={connection} report={report} resolveAssetUrl={resolveAssetUrl} />);

    expect(screen.getByRole("heading", { name: /Replay the review/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Focus ring regressed/i })).toBeInTheDocument();
    expect(screen.getByText("#ff4d4f")).toBeInTheDocument();
    expect(screen.getByText("Real replay proof")).toBeInTheDocument();
    expect(screen.getByText("Playwright screenshots")).toBeInTheDocument();
    expect(screen.getByText(/Subjective screenshot debate/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play guided demo reel/i })).toBeInTheDocument();
    expect(screen.getByText("Cached replay")).toBeInTheDocument();
    expect(screen.getByText("Voice is local TTS")).toBeInTheDocument();
    expect(screen.getByText("Run provenance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Captured regression/i })).toHaveAttribute(
      "aria-current",
      "step"
    );
  });

  it("walks through evidence, fix preview, and review packet handoff", async () => {
    const user = userEvent.setup();
    render(<Walkthrough connection={connection} report={report} resolveAssetUrl={resolveAssetUrl} />);

    expect(screen.getByText("#ff4d4f")).toBeInTheDocument();
    expect(screen.getByText("var(--color-focus-ring)")).toBeInTheDocument();
    expect(screen.getByText(".primary-action:focus")).toBeInTheDocument();
    expect(screen.getByText("screenshots/forms/desktop/focus.png")).toBeInTheDocument();
    expect(screen.getByText("Deterministic evidence")).toBeInTheDocument();
    expect(screen.getByText("AI assist layer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Drift risk")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("outline-color: var(--color-focus-ring);")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByRole("heading", { name: /Async design QA loses intent/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByRole("link", { name: /Open review packet/i })).toHaveAttribute(
      "href",
      "#/export"
    );
  });

  it("keeps captions available when browser voice is unsupported", async () => {
    const user = userEvent.setup();
    render(<Walkthrough connection={connection} report={report} resolveAssetUrl={resolveAssetUrl} />);

    await user.click(screen.getByRole("button", { name: /Play voice/i }));

    expect(screen.getByText(/Voice narration is unavailable/i)).toBeInTheDocument();
  });

  it("auto-advances the demo reel without requiring audio", async () => {
    vi.useFakeTimers();
    render(<Walkthrough connection={connection} report={report} resolveAssetUrl={resolveAssetUrl} />);

    fireEvent.click(screen.getByRole("button", { name: /Play guided demo reel/i }));
    expect(screen.getByRole("button", { name: /Pause demo reel/i })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2800);
    });
    expect(screen.getByRole("button", { name: /Triage the risk/i })).toHaveAttribute(
      "aria-current",
      "step"
    );

    vi.useRealTimers();
  });
});
