import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DriftIssue } from "../contracts/types.js";
import { OpenAiClient } from "./openai-client.js";

const issueNamesSchema = {
  name: "issue_display_names",
  schema: {
    type: "object",
    properties: {
      names: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            displayName: { type: "string" }
          },
          required: ["id", "displayName"],
          additionalProperties: false
        }
      }
    },
    required: ["names"],
    additionalProperties: false
  }
};

export type IssueNameMap = Record<string, string>;

export async function loadIssueNames(runDir: string): Promise<IssueNameMap | undefined> {
  try {
    const raw = await readFile(join(runDir, "issue-names.json"), "utf8");
    return JSON.parse(raw) as IssueNameMap;
  } catch {
    return undefined;
  }
}

export async function saveIssueNames(runDir: string, names: IssueNameMap): Promise<void> {
  await writeFile(join(runDir, "issue-names.json"), `${JSON.stringify(names, null, 2)}\n`, "utf8");
}

export async function ensureIssueNames(
  issues: DriftIssue[],
  runDir: string,
  client?: OpenAiClient
): Promise<IssueNameMap> {
  const cached = await loadIssueNames(runDir);
  if (cached && issues.every((issue) => cached[issue.id])) {
    return cached;
  }

  const names = { ...cached };
  const missing = issues.filter((issue) => !names[issue.id]);
  const aiClient = client ?? new OpenAiClient();

  if (aiClient.enabled && missing.length > 0) {
    for (const batch of chunk(missing, 15)) {
      const generated = await generateBatch(batch, aiClient);
      Object.assign(names, generated);
    }
  }

  for (const issue of missing) {
    names[issue.id] ??= fallbackName(issue);
  }

  await saveIssueNames(runDir, names);
  return names;
}

export function displayNameFor(issue: DriftIssue, names?: IssueNameMap): string {
  return names?.[issue.id] ?? fallbackName(issue);
}

function fallbackName(issue: DriftIssue): string {
  const shortTitle = issue.title.trim();
  if (shortTitle.length <= 72) {
    return shortTitle;
  }

  return `${shortTitle.slice(0, 69)}…`;
}

async function generateBatch(
  issues: DriftIssue[],
  client: OpenAiClient
): Promise<IssueNameMap> {
  const response = await client.completeJson<{ names: { id: string; displayName: string }[] }>(
    [
      {
        role: "system",
        content:
          "Name design-system drift issues for engineers. Return concise display names (4-10 words) that describe the concrete UI problem, not generic labels."
      },
      {
        role: "user",
        content: JSON.stringify(
          issues.map((issue) => ({
            id: issue.id,
            title: issue.title,
            category: issue.category,
            property: issue.property,
            routeId: issue.routeId,
            selectorHint: issue.selectorHint,
            observedValue: issue.observedValue,
            expectedValue: issue.expectedValue,
            sourceFile: issue.suggestedFix?.sourceFile,
            instruction: issue.suggestedFix?.humanInstruction
          }))
        )
      }
    ],
    issueNamesSchema
  );

  const names: IssueNameMap = {};
  for (const entry of response?.names ?? []) {
    if (entry.id && entry.displayName?.trim()) {
      names[entry.id] = entry.displayName.trim();
    }
  }

  return names;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
