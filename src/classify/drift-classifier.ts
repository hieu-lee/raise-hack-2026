import { createHash } from "node:crypto";
import type { DriftIssue } from "../contracts/types.js";
import { isContextException } from "../analyze/context.js";
import type { NormalizedObservation, TokenMatch } from "../analyze/types.js";
import type { AnalysisResult } from "../analyze/types.js";

export interface ClassificationOptions {
  screenshotPath?: (observation: NormalizedObservation) => string;
}

type IssueCategory = DriftIssue["category"];
type IssueSeverity = DriftIssue["severity"];

export function classifyDrift(
  analysis: AnalysisResult,
  options: ClassificationOptions = {}
): DriftIssue[] {
  const issues = new Map<string, DriftIssue>();

  for (const observation of analysis.observations) {
    const category = classifyObservation(observation);
    if (!category) {
      continue;
    }

    const key = issueKey(category, observation);
    const issue = issues.get(key);
    const duplicateId = stableId(
      `related:${key}:${observation.record.viewport}:${observation.record.state}`
    );

    if (issue) {
      if (!issue.evidence.relatedIssueIds.includes(duplicateId)) {
        issue.evidence.relatedIssueIds.push(duplicateId);
      }
      issue.evidence.occurrenceCount = Math.max(
        issue.evidence.occurrenceCount ?? 1,
        observation.occurrenceCount
      );
      continue;
    }

    issues.set(key, buildIssue(category, observation, options));
  }

  return [...issues.values()].sort((first, second) => first.id.localeCompare(second.id));
}

function classifyObservation(observation: NormalizedObservation): IssueCategory | undefined {
  if (observation.exactToken) {
    return undefined;
  }

  if (observation.property === "component-pattern" && !observation.clusterId) {
    return undefined;
  }

  if (isAcceptableException(observation)) {
    return "acceptable_exception";
  }

  if (observation.nearestToken) {
    return "token_misuse";
  }

  if (observation.clusterId && observation.occurrenceCount >= 3) {
    return "new_pattern_candidate";
  }

  return "accidental_regression";
}

function buildIssue(
  category: IssueCategory,
  observation: NormalizedObservation,
  options: ClassificationOptions
): DriftIssue {
  const id = stableId(issueKey(category, observation));
  const expectedValue = expectedValueFor(category, observation.nearestToken);

  return {
    id,
    title: titleFor(category, observation),
    category,
    severity: severityFor(category, observation),
    confidence: confidenceFor(category, observation),
    routeId: observation.record.routeId,
    viewport: observation.record.viewport,
    state: observation.record.state,
    elementId: observation.record.elementId,
    selectorHint: observation.record.selectorHint,
    property: observation.property,
    observedValue: observation.observedValue,
    expectedValue,
    nearestToken: observation.nearestToken?.name,
    evidence: {
      screenshotPath:
        options.screenshotPath?.(observation) ??
        `screenshots/${observation.record.routeId}/${observation.record.viewport}/${observation.record.state}.png`,
      cropBox: observation.record.boundingBox,
      tokenDistance: observation.tokenDistance,
      occurrenceCount: observation.occurrenceCount,
      relatedIssueIds: []
    },
    reasoning: reasoningFor(category, observation),
    suggestedFix: suggestedFixFor(category, observation, expectedValue),
    status: "open"
  };
}

function issueKey(category: IssueCategory, observation: NormalizedObservation): string {
  const token = observation.nearestToken?.name ?? observation.clusterId ?? "none";

  if (category === "new_pattern_candidate" && observation.clusterId) {
    return `${category}:${observation.property}:${observation.sourceProperty}:${observation.clusterId}`;
  }

  return [
    category,
    observation.record.routeId,
    observation.record.elementId,
    observation.property,
    observation.sourceProperty,
    observation.observedValue,
    token
  ].join(":");
}

function stableId(value: string): string {
  return `issue_${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function titleFor(category: IssueCategory, observation: NormalizedObservation): string {
  if (category === "token_misuse") {
    return `Use ${observation.nearestToken?.name ?? "nearest token"} for ${observation.sourceProperty}`;
  }

  if (category === "new_pattern_candidate") {
    return `Promote repeated ${observation.sourceProperty} pattern`;
  }

  if (category === "acceptable_exception") {
    return `Accept ${observation.sourceProperty} exception`;
  }

  return `Review isolated ${observation.sourceProperty} drift`;
}

function severityFor(category: IssueCategory, observation: NormalizedObservation): IssueSeverity {
  if (category === "acceptable_exception") {
    return "low";
  }

  if (category === "new_pattern_candidate") {
    return observation.occurrenceCount >= 5 ? "high" : "medium";
  }

  if (category === "token_misuse") {
    return observation.property === "color" && isProminentElement(observation) ? "high" : "medium";
  }

  return "medium";
}

function confidenceFor(category: IssueCategory, observation: NormalizedObservation): number {
  if (category === "token_misuse") {
    const closeness =
      observation.tokenDistance === undefined
        ? 0
        : 1 - Math.min(1, observation.tokenDistance / observation.tokenThreshold);
    return roundConfidence(0.72 + closeness * 0.2);
  }

  if (category === "new_pattern_candidate") {
    return roundConfidence(0.62 + Math.min(6, observation.occurrenceCount) * 0.04);
  }

  if (category === "acceptable_exception") {
    return 0.42;
  }

  return roundConfidence(observation.tokenDistance === undefined ? 0.58 : 0.64);
}

function reasoningFor(category: IssueCategory, observation: NormalizedObservation): string {
  if (category === "token_misuse") {
    return `${observation.observedValue} is within ${formatDistance(
      observation.nearestToken?.distance
    )} of ${observation.nearestToken?.name}, so this looks like a literal value that should reference the token.`;
  }

  if (category === "new_pattern_candidate") {
    return `${observation.observedValue} appears ${observation.occurrenceCount} times without a nearby token, which is enough repetition to consider promoting it into the design system.`;
  }

  if (category === "acceptable_exception") {
    return `${observation.observedValue} is isolated and appears on external or browser-controlled content, so it is tracked as a low-risk exception.`;
  }

  return `${observation.observedValue} is isolated, off-token, and not explained by a repeated pattern, so it is likely an accidental regression.`;
}

function suggestedFixFor(
  category: IssueCategory,
  observation: NormalizedObservation,
  expectedValue?: string
): DriftIssue["suggestedFix"] {
  if (category === "token_misuse") {
    return {
      type: "replace-with-token",
      cssBefore: observation.observedValue,
      cssAfter: expectedValue,
      humanInstruction: `Replace the literal ${observation.sourceProperty} value with ${expectedValue}.`
    };
  }

  if (category === "new_pattern_candidate") {
    return {
      type: "promote-pattern",
      cssBefore: observation.observedValue,
      humanInstruction: `Promote this repeated ${observation.sourceProperty} value into a token or component variant.`
    };
  }

  if (category === "acceptable_exception") {
    return {
      type: "document-exception",
      cssBefore: observation.observedValue,
      humanInstruction:
        "Keep this value only if the route context or external content still justifies it."
    };
  }

  return {
    type: "inspect-regression",
    cssBefore: observation.observedValue,
    cssAfter: expectedValue,
    humanInstruction:
      "Compare this isolated value with the intended component token and revert if it is accidental."
  };
}

function expectedValueFor(category: IssueCategory, token?: TokenMatch): string | undefined {
  if (!token || category !== "token_misuse") {
    return undefined;
  }

  return token.cssVariable ? `var(${token.cssVariable})` : token.value;
}

function isAcceptableException(observation: NormalizedObservation): boolean {
  return isContextException(observation.record);
}

function isProminentElement(observation: NormalizedObservation): boolean {
  const role = observation.record.role?.toLowerCase();
  const tagName = observation.record.tagName.toLowerCase();
  return role === "button" || role === "link" || ["button", "a"].includes(tagName);
}

function formatDistance(value: number | undefined): string {
  return value === undefined ? "the configured threshold" : String(Number(value.toFixed(4)));
}

function roundConfidence(value: number): number {
  return Number(Math.min(0.99, Math.max(0, value)).toFixed(2));
}
