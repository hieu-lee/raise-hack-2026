import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage, JsonSchemaSpec } from "./openai-client.js";
import { generateStylePropagationPlan } from "./style-propagation.js";
import type { DriftReport } from "../contracts/types.js";

const execFileAsync = promisify(execFile);
let previousCwd = process.cwd();

afterEach(() => {
  process.chdir(previousCwd);
});

describe("generateStylePropagationPlan", () => {
  it("uses OpenAI structured output when a recent style diff exists", async () => {
    const repo = await createStyleRepo();
    process.chdir(repo);

    const client = {
      enabled: true,
      completeJson: async (_messages: ChatMessage[], _schema: JsonSchemaSpec) => ({
        theme: "Liquid glass surfaces",
        summary: "Propagate the landing page glass treatment to remaining cards.",
        evidence: ["+ backdrop-filter: blur(22px);"],
        opportunities: [
          {
            component: "Issue cards",
            currentEvidence: "Issue cards still use flat dark surfaces.",
            recommendedChange: "Use the same translucent glass layer and gradient edge.",
            targetFiles: ["dashboard/src/screens/Issues/Issues.css"],
            confidence: 0.91,
            rationale: "The diff shows the new landing surface treatment."
          }
        ],
        nextActions: ["Patch issue cards", "Rerun screenshots"]
      })
    };

    const plan = await generateStylePropagationPlan(report, {
      baseRef: "master",
      headRef: "HEAD",
      client: client as never
    });

    expect(plan.status).toBe("ready");
    expect(plan.source).toBe("openai");
    expect(plan.theme).toBe("Liquid glass surfaces");
    expect(plan.opportunities[0]?.confidence).toBe(0.91);
  }, 10000);

  it("falls back honestly when OpenAI is unavailable", async () => {
    const repo = await createStyleRepo();
    process.chdir(repo);

    const plan = await generateStylePropagationPlan(report, {
      baseRef: "master",
      headRef: "HEAD",
      client: { enabled: false } as never
    });

    expect(plan.status).toBe("ai_unavailable");
    expect(plan.source).toBe("deterministic");
    expect(plan.evidence.join("\n")).toContain("backdrop-filter");
  }, 10000);

  it("uses working-tree style diffs when there is no branch delta", async () => {
    const repo = await createStyleRepo({ commitStyleChange: false });
    process.chdir(repo);

    const plan = await generateStylePropagationPlan(report, {
      baseRef: "master",
      headRef: "HEAD",
      client: { enabled: false } as never
    });

    expect(plan.status).toBe("ai_unavailable");
    expect(plan.evidence.join("\n")).toContain("backdrop-filter");
  }, 10000);
});

async function createStyleRepo(options: { commitStyleChange?: boolean } = {}): Promise<string> {
  previousCwd = process.cwd();
  const repo = await mkdtemp(join(tmpdir(), "dr-style-agent-"));
  await execFileAsync("git", ["init", "-b", "master"], { cwd: repo });
  await writeFile(join(repo, "landing.css"), ".hero { background: #111827; }\n");
  await execFileAsync("git", ["add", "landing.css"], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: repo,
    env: gitEnv()
  });
  await execFileAsync("git", ["checkout", "-b", "glass-landing"], { cwd: repo });
  await writeFile(
    join(repo, "landing.css"),
    ".hero { background: rgb(15 23 42 / 72%); backdrop-filter: blur(22px); }\n"
  );
  if (options.commitStyleChange ?? true) {
    await execFileAsync("git", ["add", "landing.css"], { cwd: repo });
    await execFileAsync("git", ["commit", "-m", "add glass landing"], {
      cwd: repo,
      env: gitEnv()
    });
  }
  return repo;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "DriftRadar",
    GIT_AUTHOR_EMAIL: "driftradar@example.com",
    GIT_COMMITTER_NAME: "DriftRadar",
    GIT_COMMITTER_EMAIL: "driftradar@example.com"
  };
}

const report = {
  projectName: "DriftRadar sample app",
  summary: {
    totalIssues: 2,
    driftScore: 42,
    countsByCategory: {
      token_misuse: 1,
      new_pattern_candidate: 1,
      accidental_regression: 0,
      acceptable_exception: 0
    },
    countsBySeverity: { critical: 0, high: 1, medium: 1, low: 0 }
  },
  issues: [
    {
      title: "Card still uses flat surface",
      routeId: "cards",
      category: "new_pattern_candidate",
      severity: "medium",
      property: "component-pattern",
      suggestedFix: { sourceFile: "dashboard/src/screens/Issues/Issues.css" }
    }
  ]
} as DriftReport;
