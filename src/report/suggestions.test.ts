import { describe, expect, it } from "vitest";
import type { DriftIssue } from "../contracts/types.js";
import { withSuggestedFix } from "./suggestions.js";

describe("suggestions", () => {
  it("suggests token variables for token misuse", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      category: "token_misuse",
      nearestToken: "--color-primary-600",
      expectedValue: "#1d4ed8"
    });

    expect(issue.suggestedFix).toMatchObject({
      type: "replace_with_token",
      cssBefore: "color: #1e64d8;",
      cssAfter: "color: var(--color-primary-600);"
    });
  });

  it("suggests promotion for repeated new patterns", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      category: "new_pattern_candidate",
      property: "radius",
      observedValue: "44px",
      evidence: { ...baseIssue.evidence, occurrenceCount: 4 }
    });

    expect(issue.suggestedFix.type).toBe("promote_pattern");
    expect(issue.suggestedFix.humanInstruction).toContain("4 occurrences");
    expect(issue.suggestedFix.cssBefore).toBe("border-radius: 44px;");
  });

  it("omits CSS snippets for broad issue properties", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      property: "spacing",
      observedValue: "18px",
      expectedValue: "16px",
      nearestToken: "--space-4"
    });

    expect(issue.suggestedFix.cssBefore).toBeUndefined();
    expect(issue.suggestedFix.cssAfter).toBeUndefined();
    expect(issue.suggestedFix.humanInstruction).toContain("--space-4");
  });

  it("wraps regression token targets as CSS variables", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      category: "accidental_regression",
      expectedValue: undefined,
      nearestToken: "--color-primary-600"
    });

    expect(issue.suggestedFix).toMatchObject({
      type: "revert_regression",
      cssAfter: "color: var(--color-primary-600);"
    });
  });

  it("keeps concrete suggestions from upstream classifiers", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      suggestedFix: {
        type: "replace-css",
        cssBefore: "background: #1f6fe5;",
        cssAfter: "background: var(--color-primary-600);",
        humanInstruction: "Use the button background token."
      }
    });

    expect(issue.suggestedFix).toMatchObject({
      type: "replace-css",
      cssBefore: "background: #1f6fe5;",
      cssAfter: "background: var(--color-primary-600);"
    });
  });

  it("skips rebuild entirely for repo-aware fixes, even without a trailing-semicolon cssBefore", () => {
    // The rule classifier's own cssBefore for new_pattern_candidate never ends with a semicolon
    // (see drift-classifier.ts), which would normally make hasConcreteCssSnippet() false and
    // trigger a full rebuild via buildSuggestedFix() -- destroying sourceFile/tsxBefore/tsxAfter
    // in the process, since a rebuild replaces the whole suggestedFix object. Repo-aware evidence
    // must short-circuit that rebuild instead.
    const original: DriftIssue = {
      ...baseIssue,
      category: "new_pattern_candidate",
      property: "component-pattern",
      observedValue: "height: 192px",
      evidence: { ...baseIssue.evidence, occurrenceCount: 18 },
      suggestedFix: {
        type: "promote-pattern",
        cssBefore: "height: 192px",
        tsxBefore: '<div className="rounded-2xl border">',
        tsxAfter: '<div className="rounded-2xl border">\n<!-- patch styles in Card.tsx -->',
        sourceFile: "src/components/Card.tsx",
        humanInstruction: "Promote the repeated card height."
      }
    };

    const issue = withSuggestedFix(original);

    // Rebuild never ran: the exact same suggestedFix object comes back untouched.
    expect(issue.suggestedFix).toBe(original.suggestedFix);
    expect(issue.suggestedFix.type).toBe("promote-pattern");
  });

  it("normalizes non-pending raw classifier suggestions", () => {
    const issue = withSuggestedFix({
      ...baseIssue,
      observedValue: "backgroundColor: #1e64d8",
      suggestedFix: {
        type: "replace-with-token",
        cssBefore: "backgroundColor: #1e64d8",
        cssAfter: "var(--color-primary-600)",
        humanInstruction: "Replace the literal color value."
      }
    });

    expect(issue.suggestedFix).toMatchObject({
      type: "replace_with_token",
      cssBefore: "background-color: #1e64d8;",
      cssAfter: "background-color: var(--color-primary-600);"
    });
  });
});

const baseIssue: DriftIssue = {
  id: "issue-1",
  title: "Button color misses primary token",
  category: "token_misuse",
  severity: "high",
  confidence: 0.91,
  routeId: "home",
  viewport: "desktop",
  state: "default",
  elementId: "home-button",
  selectorHint: ".primary",
  property: "color",
  observedValue: "#1e64d8",
  expectedValue: "#1d4ed8",
  nearestToken: "--color-primary-600",
  evidence: {
    screenshotPath: "screenshots/home/desktop/default.png",
    relatedIssueIds: []
  },
  reasoning: "The color is visually near the primary token but uses a literal value.",
  suggestedFix: {
    type: "pending",
    humanInstruction: "pending"
  },
  status: "open"
};
