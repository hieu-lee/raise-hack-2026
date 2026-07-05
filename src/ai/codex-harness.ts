import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ModelReasoningEffort, SandboxMode, Thread } from "@openai/codex-sdk";
import type { RepoPatchAiClient, RepoPatchPrompt, RepoPatchSuggestion } from "./repo-fixes.js";
import { repoPatchOutputSchema } from "./repo-fixes.js";

export interface CodexHarnessOptions {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  sandboxMode?: SandboxMode;
  workingDirectory: string;
}

export interface CodexStructuredRunner {
  runJson<T>(prompt: string, outputSchema: Record<string, unknown>): Promise<T | undefined>;
}

type CodexThreadOptions = Parameters<
  InstanceType<typeof import("@openai/codex-sdk").Codex>["startThread"]
>[0] & {
  webSearchMode?: "disabled";
  webSearchEnabled?: false;
};

export class CodexHarness implements CodexStructuredRunner {
  private readonly model: string;
  private readonly modelReasoningEffort: ModelReasoningEffort;
  private readonly sandboxMode: SandboxMode;
  private readonly workingDirectory: string;
  private thread?: Thread;

  constructor(options: CodexHarnessOptions) {
    this.model = options.model ?? "gpt-5.4-mini";
    this.modelReasoningEffort = options.modelReasoningEffort ?? "medium";
    this.sandboxMode = options.sandboxMode ?? "read-only";
    this.workingDirectory = resolve(options.workingDirectory);
  }

  async runJson<T>(prompt: string, outputSchema: Record<string, unknown>): Promise<T | undefined> {
    const { Codex } = await import("@openai/codex-sdk");
    if (!this.thread) {
      const options: CodexThreadOptions = {
        model: this.model,
        modelReasoningEffort: this.modelReasoningEffort,
        sandboxMode: this.sandboxMode,
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchEnabled: false,
        webSearchMode: "disabled",
        skipGitRepoCheck: true,
        workingDirectory: this.workingDirectory
      };
      const env = codexEnv();
      this.thread = new Codex({
        apiKey: process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY,
        env
      }).startThread(options);
    }

    const turn = await this.thread.run(prompt, { outputSchema });
    return parseJson<T>(turn.finalResponse);
  }
}

function codexEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "driftradar-codex-home-"));
  const env: Record<string, string> = {};
  for (const key of ["TMPDIR", "USER"]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  env.PATH = trustedCodexPath();
  env.HOME = home;
  env.CODEX_HOME = home;
  return env;
}

function trustedCodexPath(): string {
  const nodeBin = dirname(process.execPath);
  return [
    nodeBin,
    resolve(nodeBin, "..", "..", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ]
    .filter(Boolean)
    .join(delimiter);
}

export class CodexRepoPatchClient implements RepoPatchAiClient {
  private readonly runner: CodexStructuredRunner;

  constructor(sourceRoots: string[], runner?: CodexStructuredRunner) {
    const workingDirectory = codexWorkingDirectoryForSourceRoots(sourceRoots);
    if (!workingDirectory && !runner) {
      throw new Error("Codex repo patch source roots must be nested under one declared root.");
    }
    this.runner =
      runner ??
      new CodexHarness({
        workingDirectory: workingDirectory ?? process.cwd()
      });
  }

  async suggestRepoPatch(input: RepoPatchPrompt): Promise<RepoPatchSuggestion | undefined> {
    return this.runner.runJson<RepoPatchSuggestion>(repoPatchPrompt(input), repoPatchOutputSchema);
  }
}

function repoPatchPrompt(input: RepoPatchPrompt): string {
  return `/goal
Read the relevant project files with the Codex harness and propose the smallest design-system patch.
Do not edit files. Return JSON matching the schema only.

${JSON.stringify(input, null, 2)}`;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function codexWorkingDirectoryForSourceRoots(
  paths: string[],
  projectRoot?: string
): string | undefined {
  const roots = (paths.length > 0 ? paths : [process.cwd()]).map((path) => resolve(path));
  const allowedRoot = projectRoot ? resolve(projectRoot) : undefined;
  if (allowedRoot && roots.every((candidate) => pathInside(allowedRoot, candidate))) {
    return allowedRoot;
  }
  return roots.find((root) => roots.every((candidate) => pathInside(root, candidate)));
}

function pathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
