import type { DriftIssue, DriftRadarConfig } from "../contracts/types.js";
import { CodexRepoPatchClient, codexWorkingDirectoryForSourceRoots } from "./codex-harness.js";
import { OpenAiClient } from "./openai-client.js";
import { type RepoPatchAiClient, suggestRepoFix } from "./repo-fixes.js";
import { assertNoSensitiveProjectFiles } from "./sensitive-files.js";
import { detectVisionDrift } from "./vision-drift.js";

const codexRepoFixLimit = 12;

export interface EnrichScanOptions {
  runDir: string;
  pages: Array<{ routeId: string; viewport: string; state: string; screenshotPath: string }>;
  client?: OpenAiClient;
}

export function isAiEnabled(config: DriftRadarConfig): boolean {
  return (
    Boolean(config.ai?.enabled || config.ollama?.enabled) && Boolean(process.env.OPENAI_API_KEY)
  );
}

export function createAiClient(config: DriftRadarConfig): OpenAiClient {
  return new OpenAiClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: config.ai?.model ?? config.ollama?.model ?? "gpt-5.4-mini",
    reasoningEffort: config.ai?.reasoningEffort ?? "medium"
  });
}

export async function enrichScanWithAi(
  config: DriftRadarConfig,
  issues: DriftIssue[],
  options: EnrichScanOptions
): Promise<DriftIssue[]> {
  if (!isAiEnabled(config)) {
    return issues;
  }

  const client = options.client ?? createAiClient(config);
  if (!client.enabled) {
    return issues;
  }

  try {
    const visionIssues = await detectVisionDrift(
      client,
      options.runDir,
      options.pages.map((page) => ({
        ...page,
        capturedAt: new Date().toISOString(),
        browser: { name: "chromium", version: "ai" },
        state: page.state as DriftIssue["state"]
      })),
      issues,
      config
    );
    return dedupeIssues([...issues, ...visionIssues]);
  } catch (error) {
    console.warn(
      `AI enrichment skipped: ${error instanceof Error ? error.message : String(error)}`
    );
    return issues;
  }
}

export async function attachRepoFixes(
  config: DriftRadarConfig,
  issues: DriftIssue[],
  options: { projectRoot?: string } = {}
): Promise<DriftIssue[]> {
  const sourceRoots = config.ai?.sourceRoots ?? ["sample-app"];
  try {
    await assertRepoFixSourceRootsSafe(sourceRoots);
  } catch (error) {
    console.warn(
      `Repo-aware fixes skipped: ${error instanceof Error ? error.message : String(error)}`
    );
    return issues;
  }

  const deterministic: DriftIssue[] = [];
  for (const issue of issues) {
    deterministic.push(await attachRepoFix(issue, sourceRoots));
  }
  if (!config.ai?.enabled) {
    return deterministic;
  }
  const codexRoot = codexWorkingDirectoryForSourceRoots(
    sourceRoots.length > 0 ? sourceRoots : [process.cwd()],
    options.projectRoot
  );
  if (!codexRoot) {
    console.warn("Codex repo-aware fixes skipped: source roots must be nested under one root.");
    return deterministic;
  }
  try {
    await assertNoSensitiveProjectFiles(codexRoot, { allowDriftRadarOutput: true });
  } catch (error) {
    console.warn(
      `Codex repo-aware fixes skipped: ${error instanceof Error ? error.message : String(error)}`
    );
    return deterministic;
  }

  const client = new CodexRepoPatchClient([codexRoot]);
  const refined = [...deterministic];
  let remaining = codexRepoFixLimit;
  for (let index = 0; index < deterministic.length && remaining > 0; index += 1) {
    const issue = deterministic[index];
    if (!issue?.suggestedFix.sourceFile) {
      continue;
    }
    refined[index] = await attachRepoFix(issue, sourceRoots, client);
    remaining -= 1;
  }
  return refined;
}

async function attachRepoFix(
  issue: DriftIssue,
  sourceRoots: string[],
  client?: RepoPatchAiClient
): Promise<DriftIssue> {
  try {
    const repoFix = await suggestRepoFix(issue, sourceRoots, client);
    if (!repoFix?.sourceFile) {
      return issue;
    }

    return {
      ...issue,
      suggestedFix: {
        ...issue.suggestedFix,
        cssBefore: repoFix.cssBefore ?? issue.suggestedFix.cssBefore,
        cssAfter: repoFix.cssAfter ?? issue.suggestedFix.cssAfter,
        tsxBefore: repoFix.tsxBefore,
        tsxAfter: repoFix.tsxAfter,
        sourceFile: repoFix.sourceFile,
        humanInstruction: repoFix.humanInstruction
      },
      aiEnriched: Boolean(client && repoFix.aiSuggested) || issue.aiEnriched
    };
  } catch (error) {
    console.warn(
      `Repo-aware fix skipped for ${issue.id}: ${error instanceof Error ? error.message : String(error)}`
    );
    return issue;
  }
}

async function assertRepoFixSourceRootsSafe(sourceRoots: string[]): Promise<void> {
  await Promise.all(
    sourceRoots.map((sourceRoot) =>
      assertNoSensitiveProjectFiles(sourceRoot, { allowDriftRadarOutput: true })
    )
  );
}

// ponytail: dedupe by stable id (already unique per distinct rule/vision evidence). An earlier
// version deduped by routeId+property+observedValue+category, which silently collapsed distinct
// elements sharing the same literal value on one route (e.g. two different buttons both using
// color:#000000) into a single reported issue, losing real evidence.
function dedupeIssues(issues: DriftIssue[]): DriftIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) {
      return false;
    }
    seen.add(issue.id);
    return true;
  });
}
