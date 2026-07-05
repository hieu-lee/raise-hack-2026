import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type { DriftReport } from "../contracts/types.js";
import { OpenAiClient } from "./openai-client.js";

const execFileAsync = promisify(execFile);

export interface StylePropagationOpportunity {
  component: string;
  currentEvidence: string;
  recommendedChange: string;
  targetFiles: string[];
  confidence: number;
  rationale: string;
}

export interface StylePropagationPlan {
  status: "ready" | "no_git" | "no_recent_style_change" | "ai_unavailable" | "error";
  baseRef: string;
  headRef: string;
  generatedAt: string;
  source: "openai" | "deterministic";
  theme: string;
  summary: string;
  evidence: string[];
  opportunities: StylePropagationOpportunity[];
  nextActions: string[];
  model?: string;
  error?: string;
}

const stylePlanSchema = {
  name: "style_propagation_plan",
  schema: {
    type: "object",
    properties: {
      theme: { type: "string" },
      summary: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      opportunities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            component: { type: "string" },
            currentEvidence: { type: "string" },
            recommendedChange: { type: "string" },
            targetFiles: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
            rationale: { type: "string" }
          },
          required: [
            "component",
            "currentEvidence",
            "recommendedChange",
            "targetFiles",
            "confidence",
            "rationale"
          ],
          additionalProperties: false
        }
      },
      nextActions: { type: "array", items: { type: "string" } }
    },
    required: ["theme", "summary", "evidence", "opportunities", "nextActions"],
    additionalProperties: false
  }
};

export async function loadStylePropagationPlan(
  runDir: string
): Promise<StylePropagationPlan | undefined> {
  try {
    const raw = await readFile(join(runDir, "style-propagation.json"), "utf8");
    return JSON.parse(raw) as StylePropagationPlan;
  } catch {
    return undefined;
  }
}

export async function ensureStylePropagationPlan(
  report: DriftReport,
  runDir: string,
  options: { baseRef?: string; headRef?: string; client?: OpenAiClient } = {}
): Promise<StylePropagationPlan> {
  const cached = await loadStylePropagationPlan(runDir);
  const baseRef = options.baseRef ?? "master";
  const headRef = options.headRef ?? "HEAD";
  if (cached && cached.baseRef === baseRef && cached.headRef === headRef) {
    return cached;
  }

  const plan = await generateStylePropagationPlan(report, { ...options, baseRef, headRef });
  await writeFile(join(runDir, "style-propagation.json"), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

export async function generateStylePropagationPlan(
  report: DriftReport,
  options: { baseRef?: string; headRef?: string; client?: OpenAiClient } = {}
): Promise<StylePropagationPlan> {
  const baseRef = options.baseRef ?? (await firstAvailableRef(["prod/master", "origin/master", "main", "master"]));
  const headRef = options.headRef ?? "HEAD";
  const generatedAt = new Date().toISOString();
  const diff = await readStyleDiff(baseRef, headRef);

  if (!diff.ok) {
    return planShell({
      status: "no_git",
      baseRef,
      headRef,
      generatedAt,
      summary: diff.error ?? "Git style diff unavailable.",
      source: "deterministic"
    });
  }

  if (!diff.value.trim()) {
    return planShell({
      status: "no_recent_style_change",
      baseRef,
      headRef,
      generatedAt,
      summary: `No style changes found between ${baseRef} and ${headRef}.`,
      source: "deterministic"
    });
  }

  const aiClient = options.client ?? new OpenAiClient({ reasoningEffort: "high" });
  if (!aiClient.enabled) {
    return deterministicPlan(report, diff.value, { baseRef, headRef, generatedAt });
  }

  try {
    const response = await aiClient.completeJson<Omit<StylePropagationPlan, "status" | "baseRef" | "headRef" | "generatedAt" | "source" | "model">>(
      [
        {
          role: "system",
          content:
            "You are DriftRadar's style propagation agent. Infer the newest intentional UI direction from a recent git style diff, then propose where to propagate it across remaining UI components. Be source-grounded, skeptical, and specific. Do not invent files."
        },
        {
          role: "user",
          content: JSON.stringify({
            projectName: report.projectName,
            reportSummary: report.summary,
            routes: [...new Set(report.issues.map((issue) => issue.routeId))],
            topIssues: report.issues.slice(0, 12).map((issue) => ({
              title: issue.title,
              category: issue.category,
              severity: issue.severity,
              routeId: issue.routeId,
              property: issue.property,
              sourceFile: issue.suggestedFix?.sourceFile
            })),
            styleDiff: diff.value.slice(0, 18000)
          })
        }
      ],
      stylePlanSchema
    );

    if (!response) {
      throw new Error("OpenAI returned no style propagation plan.");
    }

    return normalizePlan({
      ...response,
      status: "ready",
      baseRef,
      headRef,
      generatedAt,
      source: "openai",
      model: "gpt-5.4-mini"
    });
  } catch (error) {
    return {
      ...deterministicPlan(report, diff.value, { baseRef, headRef, generatedAt }),
      status: "error",
      error: error instanceof Error ? error.message : "Style propagation AI failed."
    };
  }
}

async function firstAvailableRef(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await execFileAsync("git", ["rev-parse", "--verify", candidate], { maxBuffer: 1024 * 32 });
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0] ?? "master";
}

async function readStyleDiff(
  baseRef: string,
  headRef: string
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--unified=80", `${baseRef}...${headRef}`, "--", ...stylePathspecs],
      { maxBuffer: 1024 * 1024 * 3 }
    );
    if (stdout.trim()) {
      return { ok: true, value: stdout };
    }
  } catch (error) {
    const explicitRange = baseRef !== headRef && headRef !== "HEAD";
    if (explicitRange) {
      return { ok: false, error: error instanceof Error ? error.message : "git diff failed" };
    }
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--unified=80", "--", ...stylePathspecs], {
      maxBuffer: 1024 * 1024 * 3
    });
    return { ok: true, value: stdout };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "git diff failed" };
  }
}

const stylePathspecs = ["*.css", "*.scss", "*.tsx", "*.jsx", "*.ts", "*.js"];

function deterministicPlan(
  report: DriftReport,
  diff: string,
  refs: { baseRef: string; headRef: string; generatedAt: string }
): StylePropagationPlan {
  const targetFiles = [
    ...new Set(
      report.issues
        .map((issue) => issue.suggestedFix?.sourceFile)
        .filter((filePath): filePath is string => typeof filePath === "string")
    )
  ].slice(0, 6);
  return normalizePlan({
    status: "ai_unavailable",
    baseRef: refs.baseRef,
    headRef: refs.headRef,
    generatedAt: refs.generatedAt,
    source: "deterministic",
    theme: inferTheme(diff),
    summary:
      "OpenAI is unavailable, so DriftRadar used the recent style diff and scan report to draft a deterministic propagation checklist.",
    evidence: diffEvidence(diff),
    opportunities: [
      {
        component: "Repeated drift hotspots",
        currentEvidence: `${report.summary.totalIssues} open findings across affected routes.`,
        recommendedChange:
          "Apply the newest visual language to repeated button, card, navigation, and evidence surfaces before treating one-off drift.",
        targetFiles,
        confidence: 0.62,
        rationale:
          "The scan already groups repeated token and component-pattern issues; these are the safest places to propagate an intentional style direction."
      }
    ],
    nextActions: [
      "Review the style diff evidence.",
      "Apply high-confidence repeated component updates first.",
      "Rerun DriftRadar and accept the new baseline only after screenshots pass."
    ]
  });
}

function normalizePlan(plan: StylePropagationPlan): StylePropagationPlan {
  return {
    ...plan,
    evidence: plan.evidence.slice(0, 8),
    opportunities: plan.opportunities.slice(0, 6).map((opportunity) => ({
      ...opportunity,
      confidence: Math.max(0, Math.min(1, opportunity.confidence)),
      targetFiles: opportunity.targetFiles.slice(0, 8)
    })),
    nextActions: plan.nextActions.slice(0, 6)
  };
}

function planShell(input: {
  status: StylePropagationPlan["status"];
  baseRef: string;
  headRef: string;
  generatedAt: string;
  summary: string;
  source: StylePropagationPlan["source"];
}): StylePropagationPlan {
  return {
    ...input,
    theme: "No recent style signal",
    evidence: [],
    opportunities: [],
    nextActions: ["Create or scan a branch with recent UI style changes, then rerun the agent."]
  };
}

function inferTheme(diff: string): string {
  const lowered = diff.toLowerCase();
  if (lowered.includes("glass") || lowered.includes("backdrop-filter")) {
    return "Liquid glass / translucent surfaces";
  }
  if (lowered.includes("gradient") || lowered.includes("radial-gradient")) {
    return "Layered gradients and elevated depth";
  }
  return "Recent branch style direction";
}

function diffEvidence(diff: string): string[] {
  return diff
    .split("\n")
    .filter((line) => /^[+-]\s*[^+-]/.test(line))
    .filter((line) => /color|background|gradient|radius|shadow|blur|font|padding|gap|border/.test(line))
    .slice(0, 8)
    .map((line) => line.slice(0, 180));
}
