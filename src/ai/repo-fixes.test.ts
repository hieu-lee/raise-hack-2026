import { describe, expect, it } from "vitest";
import type { DriftIssue } from "../contracts/types.js";
import { suggestRepoFix } from "./repo-fixes.js";

const baseIssue: DriftIssue = {
  id: "issue_token",
  title: "Primary button uses a near-token blue literal",
  category: "token_misuse",
  severity: "high",
  confidence: 0.9,
  routeId: "buttons",
  viewport: "desktop",
  state: "default",
  elementId: "buttons-primary-action",
  selectorHint: ".primary-action",
  property: "color",
  observedValue: "#1f6fe5",
  expectedValue: "var(--color-primary-600)",
  nearestToken: "--color-primary-600",
  evidence: {
    screenshotPath: "screenshots/buttons/desktop/default.png",
    occurrenceCount: 2,
    relatedIssueIds: []
  },
  reasoning: "literal blue",
  suggestedFix: {
    type: "replace-css",
    cssBefore: "background: #1f6fe5;",
    cssAfter: "background: var(--color-primary-600);",
    humanInstruction: "Replace literal"
  },
  status: "open"
};

describe("repo-fixes", () => {
  it("finds sample-app CSS and markup for selector hints", async () => {
    const fix = await suggestRepoFix(baseIssue, ["sample-app"]);
    expect(fix?.sourceFile).toContain("sample-app/styles.css");
    expect(fix?.cssBefore).toContain("background: #1f6fe5");
    expect(fix?.tsxBefore).toContain("primary-action");
  });

  it("finds Tailwind utility-class JSX markup from a compound selector hint", async () => {
    const tailwindIssue: DriftIssue = {
      ...baseIssue,
      id: "issue_tailwind_pattern",
      category: "new_pattern_candidate",
      selectorHint: "div.rounded-2xl.border.border-gray-200",
      property: "component-pattern",
      observedValue: "height: 328px",
      expectedValue: undefined,
      nearestToken: undefined,
      suggestedFix: {
        type: "promote-pattern",
        cssBefore: "height: 328px;",
        humanInstruction: "Promote the repeated card height into a shared token."
      }
    };

    const fix = await suggestRepoFix(tailwindIssue, ["fixtures/repo-fixes/tailwind-sample"]);
    expect(fix?.sourceFile).toContain("StatCard.tsx");
    expect(fix?.tsxBefore).toContain("rounded-2xl border border-gray-200");
  });

  it("lets the Codex repo patch client refine source-aware fixes", async () => {
    const fix = await suggestRepoFix(baseIssue, ["sample-app"], {
      async suggestRepoPatch() {
        return {
          cssAfter: "background: var(--color-primary-600);",
          tsxAfter: null,
          humanInstruction: "Use the primary token in the button rule."
        };
      }
    });

    expect(fix?.sourceFile).toContain("sample-app/styles.css");
    expect(fix?.cssAfter).toBe("background: var(--color-primary-600);");
    expect(fix?.humanInstruction).toContain("Use the primary token");
    expect(fix?.aiSuggested).toBe(true);
  });

  it("does not mark deterministic fallbacks as Codex suggestions", async () => {
    const fix = await suggestRepoFix(baseIssue, ["sample-app"], {
      async suggestRepoPatch() {
        return undefined;
      }
    });

    expect(fix?.sourceFile).toContain("sample-app/styles.css");
    expect(fix?.aiSuggested).toBe(false);
  });
});
