import type { DriftIssue } from "../contracts/types.js";
import { OpenAiClient } from "./openai-client.js";

const prDraftSchema = {
  name: "pr_draft",
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" }
    },
    required: ["title", "body"],
    additionalProperties: false
  }
};

export interface PrDraft {
  title: string;
  body: string;
}

export async function draftPullRequest(
  projectName: string,
  appliedIssues: DriftIssue[],
  client?: OpenAiClient
): Promise<PrDraft> {
  const fallback = fallbackDraft(projectName, appliedIssues);
  const aiClient = client ?? new OpenAiClient();
  if (!aiClient.enabled || appliedIssues.length === 0) {
    return fallback;
  }

  try {
    const response = await aiClient.completeJson<PrDraft>(
      [
        {
          role: "system",
          content:
            "Draft concise GitHub pull requests for design-system drift fixes. Title <= 72 chars. Body uses short bullets with file paths and what changed."
        },
        {
          role: "user",
          content: JSON.stringify({
            projectName,
            fixes: appliedIssues.map((issue) => ({
              title: issue.title,
              category: issue.category,
              severity: issue.severity,
              sourceFile: issue.suggestedFix?.sourceFile,
              instruction: issue.suggestedFix?.humanInstruction
            }))
          })
        }
      ],
      prDraftSchema
    );

    if (response?.title?.trim() && response.body?.trim()) {
      return {
        title: response.title.trim(),
        body: response.body.trim()
      };
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function fallbackDraft(projectName: string, issues: DriftIssue[]): PrDraft {
  const count = issues.length;
  return {
    title: `fix(design-system): align ${count} drift finding${count === 1 ? "" : "s"} in ${projectName}`,
    body: [
      "## Summary",
      `Apply ${count} DriftRadar design-system fix${count === 1 ? "" : "es"}.`,
      "",
      "## Changes",
      ...issues.map(
        (issue) =>
          `- ${issue.title}${issue.suggestedFix?.sourceFile ? ` (\`${issue.suggestedFix.sourceFile}\`)` : ""}`
      )
    ].join("\n")
  };
}
