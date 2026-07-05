import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Issue } from "../../types/report";
import { emptyIssueFilters } from "../../lib/filtering/filtering";
import { filtersFromLocation, IssueFilters } from "./IssueFilters";

const issues = [
  {
    id: "issue-token-blue",
    title: "Primary button uses a near-token blue literal",
    category: "token_misuse",
    severity: "high",
    confidence: 0.9,
    routeId: "buttons",
    viewport: "desktop",
    state: "default",
    elementId: "button",
    selectorHint: ".primary-action",
    property: "color",
    observedValue: "#1f6fe5",
    expectedValue: "var(--color-primary-600)",
    reasoning: "literal value close to token",
    status: "open"
  },
  {
    id: "issue-focus-ring",
    title: "Focus ring regressed",
    category: "accidental_regression",
    severity: "critical",
    confidence: 0.92,
    routeId: "forms",
    viewport: "desktop",
    state: "focus",
    elementId: "field",
    selectorHint: ".primary-action:focus",
    property: "interaction",
    observedValue: "#ff4d4f",
    expectedValue: "var(--color-focus-ring)",
    reasoning: "isolated focus state",
    status: "open"
  }
] satisfies Issue[];

describe("IssueFilters", () => {
  it("emits updated filters and URL params", () => {
    const onChange = vi.fn();

    window.history.pushState(null, "", "?runId=demo&severity=low");
    render(<IssueFilters issues={issues} value={emptyIssueFilters()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("critical"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ severities: ["critical"] }),
      expect.any(URLSearchParams)
    );
    expect(onChange.mock.calls[0][1].toString()).toBe("runId=demo&severity=critical");
  });

  it("updates search text", () => {
    const onChange = vi.fn();

    render(<IssueFilters issues={issues} value={emptyIssueFilters()} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Search findings"), {
      target: { value: "focus" }
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "focus" }),
      expect.any(URLSearchParams)
    );
  });

  it("does not submit natively from the search field", () => {
    render(<IssueFilters issues={issues} value={emptyIssueFilters()} onChange={vi.fn()} />);

    expect(fireEvent.submit(screen.getByRole("form", { name: "Issue filters" }))).toBe(false);
  });

  it("shows stale selected filters so they can be removed", () => {
    const onChange = vi.fn();

    render(
      <IssueFilters
        issues={issues}
        value={{ ...emptyIssueFilters(), routes: ["missing"] }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText("missing"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ routes: [] }),
      expect.any(URLSearchParams)
    );
  });

  it("can read filters from location search", () => {
    expect(filtersFromLocation("?route=forms&sort=confidence")).toMatchObject({
      routes: ["forms"],
      sort: "confidence"
    });
  });
});
