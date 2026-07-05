import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DriftIssue, DriftRadarConfig, PageCapture } from "../contracts/types.js";
import type { OpenAiClient } from "./openai-client.js";

export interface VisionDriftFinding {
  title: string;
  property: DriftIssue["property"];
  observedValue: string;
  expectedValue: string | null;
  reasoning: string;
  severity: DriftIssue["severity"];
  category: DriftIssue["category"];
  cropBox: { x: number; y: number; width: number; height: number } | null;
}

const categories: DriftIssue["category"][] = [
  "token_misuse",
  "new_pattern_candidate",
  "accidental_regression",
  "acceptable_exception"
];
const severities: DriftIssue["severity"][] = ["critical", "high", "medium", "low"];
const properties: DriftIssue["property"][] = [
  "color",
  "spacing",
  "radius",
  "typography",
  "shadow",
  "interaction",
  "component-pattern"
];

const visionFindingsSchema = {
  name: "vision_drift_findings",
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            property: { type: "string", enum: properties },
            observedValue: { type: "string" },
            expectedValue: { type: ["string", "null"] },
            reasoning: { type: "string" },
            severity: { type: "string", enum: severities },
            category: { type: "string", enum: categories },
            cropBox: {
              type: ["object", "null"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" }
              },
              required: ["x", "y", "width", "height"],
              additionalProperties: false
            }
          },
          required: [
            "title",
            "property",
            "observedValue",
            "expectedValue",
            "reasoning",
            "severity",
            "category",
            "cropBox"
          ],
          additionalProperties: false
        }
      }
    },
    required: ["findings"],
    additionalProperties: false
  }
};

export async function detectVisionDrift(
  client: OpenAiClient,
  runDir: string,
  pages: PageCapture[],
  existingIssues: DriftIssue[],
  config: DriftRadarConfig
): Promise<DriftIssue[]> {
  if (!client.enabled) {
    return [];
  }

  const findings: DriftIssue[] = [];
  const sampledPages = pages.filter(
    (page, index, all) => all.findIndex((candidate) => candidate.routeId === page.routeId) === index
  );

  for (const page of sampledPages.slice(0, 4)) {
    const screenshotPath = join(runDir, page.screenshotPath);
    let imageBase64: string;
    try {
      imageBase64 = (await readFile(screenshotPath)).toString("base64");
    } catch {
      continue;
    }

    const response = await client.completeJson<{ findings: VisionDriftFinding[] }>(
      [
        {
          role: "system",
          content:
            "You audit UI screenshots for design-system drift missed by CSS rules: spacing rhythm, visual weight, alignment, contrast, inconsistent component shapes. Return only novel findings not already listed."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                project: config.projectName,
                routeId: page.routeId,
                viewport: page.viewport,
                state: page.state,
                knownIssues: summarizeKnownIssues(existingIssues, page.routeId)
              })
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" }
            }
          ]
        }
      ],
      visionFindingsSchema
    );

    for (const finding of response?.findings ?? []) {
      const issue = toVisionIssue(finding, page);
      if (issue) {
        findings.push(issue);
      }
    }
  }

  return findings;
}

// A busy real-world route can carry 50-100+ rule-based issues (mostly repeated titles like
// "Promote repeated height pattern" at different pixel values). Sending all of them as "already
// found" context crowds the prompt and nudges the model toward reporting nothing "novel" at all.
// Dedupe by title and cap the count so the model sees the topics already covered without losing
// room to look for genuinely different visual drift.
function summarizeKnownIssues(
  issues: DriftIssue[],
  routeId: string
): Array<{ title: string; property: string; observedValue: string }> {
  const seenTitles = new Set<string>();
  const summary: Array<{ title: string; property: string; observedValue: string }> = [];

  for (const issue of issues) {
    if (issue.routeId !== routeId || seenTitles.has(issue.title) || summary.length >= 12) {
      continue;
    }
    seenTitles.add(issue.title);
    summary.push({
      title: issue.title,
      property: issue.property,
      observedValue: issue.observedValue
    });
  }

  return summary;
}

function toVisionIssue(finding: VisionDriftFinding, page: PageCapture): DriftIssue | undefined {
  const category = categories.includes(finding.category)
    ? finding.category
    : "accidental_regression";
  const severity = severities.includes(finding.severity) ? finding.severity : "medium";
  const property = properties.includes(finding.property) ? finding.property : "component-pattern";
  if (!finding.title || !finding.observedValue || !finding.reasoning) {
    return undefined;
  }

  const id = `issue_vision_${hash(`${page.routeId}:${finding.title}:${finding.observedValue}`)}`;
  return {
    id,
    title: finding.title,
    category,
    severity,
    confidence: 0.78,
    routeId: page.routeId,
    viewport: page.viewport,
    state: page.state,
    elementId: `${page.routeId}-vision-${id.slice(-6)}`,
    selectorHint: "visual-inspection",
    property,
    observedValue: finding.observedValue,
    expectedValue: finding.expectedValue ?? undefined,
    evidence: {
      screenshotPath: page.screenshotPath,
      cropBox: sanitizeCropBox(finding.cropBox),
      occurrenceCount: 1,
      relatedIssueIds: []
    },
    reasoning: finding.reasoning,
    suggestedFix: {
      type: "vision-drift",
      humanInstruction: `Review visual drift on ${page.routeId}: ${finding.reasoning}`
    },
    aiEnriched: true,
    status: "open"
  };
}

// The model occasionally returns a malformed cropBox (missing fields, wrong shape, non-finite
// numbers). Merging that straight into the schema-strict report would crash the whole scan at
// `reportSchema.parse` time, so drop anything that isn't a clean, finite bounding box instead.
function sanitizeCropBox(cropBox: unknown): DriftIssue["evidence"]["cropBox"] | undefined {
  if (!cropBox || typeof cropBox !== "object" || Array.isArray(cropBox)) {
    return undefined;
  }

  const { x, y, width, height } = cropBox as Record<string, unknown>;
  const values = [x, y, width, height];
  if (
    !values.every((value): value is number => typeof value === "number" && Number.isFinite(value))
  ) {
    return undefined;
  }

  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function hash(value: string): string {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    sum = (sum * 31 + value.charCodeAt(index)) >>> 0;
  }
  return sum.toString(16).padStart(8, "0");
}
