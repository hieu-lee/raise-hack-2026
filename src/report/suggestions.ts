import type { DriftIssue } from "../contracts/types.js";

const cssPropertyByIssueProperty: Partial<Record<DriftIssue["property"], string>> = {
  color: "color",
  radius: "border-radius",
  shadow: "box-shadow"
};

export function withSuggestedFix(issue: DriftIssue): DriftIssue {
  // A repo-aware fix (sourceFile/tsxBefore from AI enrichment) is always considered concrete
  // enough to skip rebuilding, even when the rule classifier's own cssBefore/cssAfter snippet
  // text doesn't end with a semicolon. Without this, rebuilding for that cosmetic reason would
  // replace the whole suggestedFix object and silently discard real repo-aware evidence.
  const hasRepoEvidence = Boolean(issue.suggestedFix.sourceFile || issue.suggestedFix.tsxBefore);

  if (
    issue.suggestedFix.type !== "pending" &&
    (hasConcreteCssSnippet(issue.suggestedFix) || hasRepoEvidence)
  ) {
    return issue;
  }

  return { ...issue, suggestedFix: buildSuggestedFix(issue) };
}

function hasConcreteCssSnippet(suggestedFix: DriftIssue["suggestedFix"]): boolean {
  const snippets = [suggestedFix.cssBefore, suggestedFix.cssAfter].filter(
    (snippet) => snippet !== undefined
  );

  return (
    snippets.length > 0 &&
    snippets.every((snippet) => snippet.includes(":") && snippet.trim().endsWith(";"))
  );
}

function buildSuggestedFix(issue: DriftIssue): DriftIssue["suggestedFix"] {
  const observed = cssDeclaration(issue.observedValue);
  const cssProperty = observed?.property ?? cssPropertyByIssueProperty[issue.property];
  const observedValue = observed?.value ?? issue.observedValue;
  const cssBefore = cssProperty ? `${cssProperty}: ${observedValue};` : undefined;

  if (issue.category === "token_misuse" && issue.nearestToken) {
    const replacement = cssValue(issue.nearestToken, issue.expectedValue);

    return {
      type: "replace_with_token",
      cssBefore,
      cssAfter: cssProperty ? `${cssProperty}: ${replacement};` : undefined,
      humanInstruction: `Replace ${issue.observedValue} with ${issue.nearestToken} on ${issue.selectorHint}.`
    };
  }

  if (issue.category === "new_pattern_candidate") {
    const count = issue.evidence.occurrenceCount ?? 1;

    return {
      type: "promote_pattern",
      cssBefore,
      humanInstruction: `Review ${count} occurrences of ${issue.observedValue} and promote it to a shared token or component rule if intentional.`
    };
  }

  if (issue.category === "accidental_regression") {
    const target = cssValue(issue.nearestToken, issue.expectedValue);

    return {
      type: "revert_regression",
      cssBefore,
      cssAfter: target && cssProperty ? `${cssProperty}: ${target};` : undefined,
      humanInstruction: target
        ? `Revert ${issue.selectorHint} from ${issue.observedValue} to ${target}.`
        : `Compare ${issue.selectorHint} with the nearest stable route or token before keeping this value.`
    };
  }

  return {
    type: "document_exception",
    cssBefore,
    humanInstruction: `Keep ${issue.observedValue} only if this route-specific exception is intentional.`
  };
}

function cssValue(nearestToken?: string, expectedValue?: string): string | undefined {
  if (nearestToken?.startsWith("--")) {
    return `var(${nearestToken})`;
  }

  return expectedValue ?? nearestToken;
}

function cssDeclaration(value: string): { property: string; value: string } | undefined {
  const match = value.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  return { property: kebabCase(match[1]), value: match[2].replace(/;$/, "").trim() };
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
