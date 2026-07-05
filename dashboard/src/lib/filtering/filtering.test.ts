import { describe, expect, it } from "vitest";

import type { Issue } from "../../types/report";
import {
  emptyIssueFilters,
  filterIssues,
  filterOptionsFromIssues,
  issueFiltersToSearchParams,
  parseIssueFilters
} from "./filtering";

const issue = (overrides: Partial<Issue>): Issue => ({
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
  status: "open",
  ...overrides
});

const issues = [
  issue({
    id: "a",
    title: "Medium radius",
    category: "new_pattern_candidate",
    severity: "medium",
    confidence: 0.86,
    routeId: "cards",
    property: "radius"
  }),
  issue({
    id: "b",
    title: "Critical focus",
    category: "accidental_regression",
    severity: "critical",
    confidence: 0.92,
    routeId: "forms",
    state: "focus",
    property: "interaction"
  }),
  issue({
    id: "c",
    title: "High color",
    category: "token_misuse",
    severity: "high",
    confidence: 0.9,
    routeId: "buttons",
    property: "color"
  })
];

describe("filtering utilities", () => {
  it("parses and serializes shareable query params", () => {
    const filters = parseIssueFilters(
      new URLSearchParams(
        "severity=critical,high&category=token_misuse&route=buttons&q=blue&sort=confidence"
      )
    );

    expect(filters).toMatchObject({
      severities: ["critical", "high"],
      categories: ["token_misuse"],
      routes: ["buttons"],
      search: "blue",
      sort: "confidence"
    });
    expect(issueFiltersToSearchParams(filters).toString()).toBe(
      "severity=critical%2Chigh&category=token_misuse&route=buttons&q=blue&sort=confidence"
    );
    expect(
      issueFiltersToSearchParams({ ...filters, severities: ["high", "critical"] }).toString()
    ).toBe("severity=critical%2Chigh&category=token_misuse&route=buttons&q=blue&sort=confidence");
    expect(
      issueFiltersToSearchParams({
        ...filters,
        severities: ["high", "critical", "high"],
        routes: ["buttons", "buttons"]
      }).toString()
    ).toBe("severity=critical%2Chigh&category=token_misuse&route=buttons&q=blue&sort=confidence");
  });

  it("filters by field values and text search", () => {
    const filters = {
      ...emptyIssueFilters(),
      severities: ["critical" as const],
      search: "focus"
    };

    expect(filterIssues(issues, filters).map((match) => match.id)).toEqual(["b"]);
  });

  it("searches by issue id", () => {
    const idOnlyIssue = issue({
      id: "issue-needle",
      title: "Unrelated finding",
      reasoning: "No matching text"
    });

    expect(
      filterIssues([idOnlyIssue], { ...emptyIssueFilters(), search: "issue-needle" }).map(
        (match) => match.id
      )
    ).toEqual(["issue-needle"]);
  });

  it("sorts deterministically by severity and confidence", () => {
    expect(filterIssues(issues, emptyIssueFilters()).map((match) => match.id)).toEqual([
      "b",
      "c",
      "a"
    ]);
    expect(
      filterIssues(issues, { ...emptyIssueFilters(), sort: "title" }).map((match) => match.id)
    ).toEqual(["b", "c", "a"]);
  });

  it("returns no matches without inventing fallback results", () => {
    expect(filterIssues(issues, { ...emptyIssueFilters(), routes: ["missing"] })).toEqual([]);
  });

  it("derives stable option lists from issues", () => {
    expect(filterOptionsFromIssues(issues)).toEqual({
      severities: ["critical", "high", "medium"],
      categories: ["accidental_regression", "new_pattern_candidate", "token_misuse"],
      properties: ["color", "interaction", "radius"],
      routes: ["buttons", "cards", "forms"],
      states: ["default", "focus"]
    });
  });
});
