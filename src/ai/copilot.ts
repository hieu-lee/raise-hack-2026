import type { DriftIssue, DriftReport } from "../contracts/types.js";
import type { DriftRadarConfig } from "../contracts/types.js";
import { createAiClient, isAiEnabled } from "./enrich-scan.js";
import type { OpenAiClient } from "./openai-client.js";
import { OpenAiClient as OpenAiClientClass } from "./openai-client.js";

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotRequest {
  message: string;
  issueId?: string;
  history?: CopilotMessage[];
}

export interface CopilotResponse {
  reply: string;
  model: string;
}

export async function runCopilot(
  report: DriftReport,
  request: CopilotRequest,
  config?: DriftRadarConfig,
  client?: OpenAiClient
): Promise<CopilotResponse> {
  const aiClient =
    client ??
    (config && isAiEnabled(config)
      ? createAiClient(config)
      : new OpenAiClientClass({ apiKey: process.env.OPENAI_API_KEY }));
  if (!aiClient.enabled) {
    return {
      reply:
        "Copilot needs OPENAI_API_KEY and ai.enabled in driftradar.config.json. Deterministic findings are still available in the issue list.",
      model: "offline"
    };
  }

  const issue = request.issueId
    ? report.issues.find((candidate) => candidate.id === request.issueId)
    : undefined;
  const context = buildContext(report, issue);
  const history = sanitizeHistory(request.history);

  const reply = await aiClient.complete([
    {
      role: "system",
      content:
        "You are DriftRadar Copilot for design-system drift triage. Be direct, developer-focused, and ground answers in the scan report. Suggest concrete token, CSS, or markup patches when asked."
    },
    {
      role: "user",
      content: `${context}\n\nConversation:\n${history.map((entry) => `${entry.role}: ${entry.content}`).join("\n")}\nuser: ${request.message}`
    }
  ]);

  return {
    reply:
      reply ??
      "I could not generate a response. Try asking about a specific issue id, suggested fix, or drift category.",
    model: "gpt-5.4-mini"
  };
}

function buildContext(report: DriftReport, issue?: DriftIssue): string {
  const summary = {
    projectName: report.projectName,
    driftScore: report.summary.driftScore,
    totalIssues: report.summary.totalIssues,
    countsByCategory: report.summary.countsByCategory,
    countsBySeverity: report.summary.countsBySeverity
  };

  if (!issue) {
    return `Report summary:\n${JSON.stringify(summary, null, 2)}`;
  }

  return `Report summary:\n${JSON.stringify(summary, null, 2)}\n\nSelected issue:\n${JSON.stringify(issue, null, 2)}`;
}

export function sanitizeHistory(history: CopilotMessage[] | undefined): CopilotMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (entry): entry is CopilotMessage =>
        (entry?.role === "user" || entry?.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim().length > 0
    )
    .slice(-8)
    .map((entry) => ({ role: entry.role, content: entry.content.trim().slice(0, 4000) }));
}
