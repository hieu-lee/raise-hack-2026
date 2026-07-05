import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriftRadarConfig, DriftIssue } from "../contracts/types.js";
import { attachRepoFixes, enrichScanWithAi, isAiEnabled } from "./enrich-scan.js";
import { OpenAiClient } from "./openai-client.js";

const config = {
  ai: {
    enabled: true,
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
    sourceRoots: ["sample-app"]
  }
} as DriftRadarConfig;

const issue: DriftIssue = {
  id: "issue_rule_based",
  title: "Near token literal",
  category: "accidental_regression",
  severity: "medium",
  confidence: 0.62,
  routeId: "buttons",
  viewport: "desktop",
  state: "default",
  elementId: "buttons-primary",
  selectorHint: ".primary-action",
  property: "color",
  observedValue: "#1f6fe5",
  evidence: {
    screenshotPath: "screenshots/buttons/desktop/default.png",
    occurrenceCount: 2,
    tokenDistance: 4.2,
    relatedIssueIds: []
  },
  reasoning: "rule reasoning",
  suggestedFix: { type: "inspect-regression", humanInstruction: "inspect" },
  status: "open"
};

describe("enrich-scan", () => {
  it("requires ai.enabled and OPENAI_API_KEY", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(isAiEnabled(config)).toBe(false);
    process.env.OPENAI_API_KEY = previous;
  });

  it("does not use OpenAI to reclassify deterministic issues or rewrite prose", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchImpl = vi.fn();
    const client = new OpenAiClient({
      apiKey: "test-key",
      fetchImpl
    });

    const result = await enrichScanWithAi(config, [issue], {
      runDir: ".",
      pages: [
        {
          routeId: "buttons",
          viewport: "desktop",
          state: "default",
          screenshotPath: "screenshots/buttons/desktop/default.png"
        }
      ],
      client
    });

    expect(result).toEqual([issue]);
    expect(fetchImpl).not.toHaveBeenCalled();
    delete process.env.OPENAI_API_KEY;
  });

  it("skips Codex repo patches when source roots contain sensitive files", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "driftradar-source-root-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await writeFile(join(sourceRoot, ".env"), "SECRET=value\n", "utf8");
      const result = await attachRepoFixes(
        {
          ...config,
          ai: { ...config.ai, sourceRoots: [sourceRoot] }
        },
        [issue]
      );

      expect(result).toEqual([issue]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Repo-aware fixes skipped"));
    } finally {
      warn.mockRestore();
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("skips Codex repo patches when source roots would widen the working directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "driftradar-repo-root-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const appRoot = join(repoRoot, "apps", "web", "src");
      const packageRoot = join(repoRoot, "packages", "ui", "src");
      await mkdir(appRoot, { recursive: true });
      await mkdir(packageRoot, { recursive: true });

      const result = await attachRepoFixes(
        {
          ...config,
          outputDir: join(repoRoot, ".driftradar"),
          ai: { ...config.ai, sourceRoots: [appRoot, packageRoot] }
        },
        [issue]
      );

      expect(result).toEqual([issue]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("source roots must be nested"));
    } finally {
      warn.mockRestore();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
