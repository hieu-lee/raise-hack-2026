import { describe, expect, it, vi } from "vitest";
import type { DriftIssue, DriftRadarConfig } from "../contracts/types.js";
import { detectVisionDrift } from "./vision-drift.js";
import { OpenAiClient } from "./openai-client.js";

function issue(partial: Partial<DriftIssue> & { title: string }): DriftIssue {
  return {
    id: `issue_${partial.title}`,
    category: "new_pattern_candidate",
    severity: "high",
    confidence: 0.8,
    routeId: "dashboard-home",
    viewport: "desktop",
    state: "default",
    elementId: "el_x",
    selectorHint: "div",
    property: "color",
    observedValue: "color: #000000",
    evidence: { screenshotPath: "x", occurrenceCount: 1, relatedIssueIds: [] },
    reasoning: "test",
    suggestedFix: { type: "promote-pattern", humanInstruction: "test" },
    status: "open",
    ...partial
  };
}

describe("vision-drift", () => {
  it("caps and dedupes known-issue context sent to the model per route", async () => {
    const manyIssues = Array.from({ length: 60 }, (_, index) =>
      issue({ title: "Promote repeated height pattern", observedValue: `height: ${index}px` })
    );
    const otherRouteIssue = issue({ title: "Other route issue", routeId: "buttons" });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"findings":[]}' } }] })
    });
    const client = new OpenAiClient({ apiKey: "test", fetchImpl });

    await detectVisionDrift(
      client,
      "fixtures/golden/frontend-handoff-run",
      [
        {
          routeId: "dashboard-home",
          viewport: "desktop",
          state: "default",
          screenshotPath: "screenshots/overview/desktop/default.png",
          capturedAt: "2026-07-03T13:00:00.000Z",
          browser: { name: "chromium", version: "test" }
        }
      ],
      [...manyIssues, otherRouteIssue],
      { projectName: "fixture" } as DriftRadarConfig
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const userMessage = body.messages.find((message: { role: string }) => message.role === "user");
    const textPart = userMessage.content.find((part: { type: string }) => part.type === "text");
    const parsed = JSON.parse(textPart.text);

    expect(parsed.knownIssues).toHaveLength(1);
    expect(parsed.knownIssues[0].title).toBe("Promote repeated height pattern");
  });

  it("returns vision issues from mocked model output", async () => {
    const client = new OpenAiClient({
      apiKey: "test",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [
                    {
                      title: "Card shadow heavier than token",
                      property: "shadow",
                      observedValue: "heavy shadow",
                      reasoning: "Visual weight exceeds panel token.",
                      severity: "medium",
                      category: "accidental_regression"
                    }
                  ]
                })
              }
            }
          ]
        })
      })
    });

    const issues = await detectVisionDrift(
      client,
      "fixtures/golden/frontend-handoff-run",
      [
        {
          routeId: "cards",
          viewport: "desktop",
          state: "default",
          screenshotPath: "screenshots/cards/desktop/default.png",
          capturedAt: "2026-07-03T13:00:00.000Z",
          browser: { name: "chromium", version: "test" }
        }
      ],
      [],
      { projectName: "fixture" } as DriftRadarConfig
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.category).toBe("accidental_regression");
    expect(issues[0]?.aiEnriched).toBe(true);
  });
});
