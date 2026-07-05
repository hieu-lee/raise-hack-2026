import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import type { DriftReport } from "../contracts/types.js";
import { findGitRoot } from "./create-pr.js";

const execFileAsync = promisify(execFile);

export type ProjectReadiness =
  | {
      state: "ready";
      projectRoot: string;
      repoRoot: string;
      message: string;
      remote?: string;
      forked?: boolean;
    }
  | {
      state: "needs_git_init";
      projectRoot: string;
      message: string;
    }
  | {
      state: "needs_remote";
      projectRoot: string;
      repoRoot: string;
      command: string;
      message: string;
    }
  | {
      state: "needs_initial_commit";
      projectRoot: string;
      repoRoot: string;
      remote: string;
      message: string;
    }
  | {
      state: "no_source";
      message: string;
    };

export async function getProjectReadiness(report: DriftReport): Promise<ProjectReadiness> {
  const projectRoot = await projectRootFromReport(report);
  if (!projectRoot) {
    return {
      state: "no_source",
      message: "No repo-aware source file is attached to this run yet."
    };
  }

  const repoRoot = (await findGitRoot(projectRoot)) ?? (await findGitRoot(dirname(projectRoot)));
  if (!repoRoot) {
    return {
      state: "needs_git_init",
      projectRoot,
      message: "Initialize this project before DriftRadar can open pull requests."
    };
  }

  const remote = await originRemote(repoRoot);
  if (!remote) {
    return needsRemote(projectRoot, repoRoot);
  }
  if (!(await hasAnyCommit(repoRoot))) {
    return {
      state: "needs_initial_commit",
      projectRoot,
      repoRoot,
      remote,
      message: "Remote is set. Finish init to create and push the initial commit."
    };
  }

  return {
    state: "ready",
    projectRoot,
    repoRoot,
    remote,
    message: "Project is ready for pull requests."
  };
}

export async function prepareProjectForPullRequests(
  report: DriftReport
): Promise<ProjectReadiness> {
  const status = await getProjectReadiness(report);
  if (status.state === "no_source" || status.state === "needs_remote") {
    return status;
  }
  if (status.state === "needs_initial_commit") {
    return status;
  }

  if (status.state === "needs_git_init") {
    await runGit(status.projectRoot, ["init"]);
    await ensureNoDangerousWorkspaceFiles(status.projectRoot);
    await generateGitignoreWithCodex(status.projectRoot);
    const repoRoot = (await findGitRoot(status.projectRoot)) ?? status.projectRoot;
    return needsRemote(status.projectRoot, repoRoot);
  }

  const forked = await forkIfNeeded(status.repoRoot);
  return forked ? { ...status, forked, message: "Fork created and linked for PRs." } : status;
}

export async function finishProjectInit(report: DriftReport): Promise<ProjectReadiness> {
  const projectRoot = await projectRootFromReport(report);
  if (!projectRoot) {
    return {
      state: "no_source",
      message: "No repo-aware source file is attached to this run yet."
    };
  }

  const repoRoot = (await findGitRoot(projectRoot)) ?? (await findGitRoot(dirname(projectRoot)));
  if (!repoRoot) {
    return {
      state: "needs_git_init",
      projectRoot,
      message: "Initialize this project before DriftRadar can open pull requests."
    };
  }

  const remote = await originRemote(repoRoot);
  if (!remote) {
    return needsRemote(projectRoot, repoRoot);
  }

  const hasCommit = await hasAnyCommit(repoRoot);
  if (!hasCommit) {
    await ensureNoDangerousWorkspaceFiles(repoRoot);
    await generateGitignoreWithCodex(repoRoot);
    await ensureNoDangerousUnignoredFiles(repoRoot);
    await runGit(repoRoot, ["add", "-A"]);
    await runGit(repoRoot, ["commit", "-m", "init commit"]);
  }

  await runGit(repoRoot, ["push", "-u", "origin", "HEAD"]);
  return {
    state: "ready",
    projectRoot,
    repoRoot,
    remote,
    message: "Initial commit pushed. Project is ready for pull requests."
  };
}

async function projectRootFromReport(report: DriftReport): Promise<string | undefined> {
  const sourceFile = report.issues.map((issue) => issue.suggestedFix?.sourceFile).find(Boolean);
  if (!sourceFile) {
    return undefined;
  }

  let current = dirname(resolve(sourceFile));
  while (true) {
    if (await exists(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return dirname(resolve(sourceFile));
    }
    current = parent;
  }
}

async function generateGitignoreWithCodex(projectRoot: string): Promise<void> {
  const existing = await readExistingGitignore(projectRoot);
  let generated: string | undefined;
  try {
    const { Codex } = await import("@openai/codex-sdk");
    const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY });
    const thread = await codex.startThread({
      model: "gpt-5.4-mini",
      modelReasoningEffort: "medium",
      workingDirectory: projectRoot,
      sandboxMode: "read-only"
    });
    const turn = await thread.run(
      [
        "Read this project and return the exact .gitignore content it should use.",
        "Use a concise, idiomatic .gitignore for this stack.",
        "Do not modify files. Respond with only .gitignore lines, no prose and no Markdown fence."
      ].join("\n")
    );
    generated = extractGitignore(turn.finalResponse);
  } catch {
    generated = fallbackGitignore();
  }

  await writeFile(
    join(projectRoot, ".gitignore"),
    withMandatoryGitignoreRules([existing, generated].filter(Boolean).join("\n")),
    "utf8"
  );
}

function extractGitignore(response: string | undefined): string | undefined {
  const trimmed = response?.trim();
  if (!trimmed) {
    return undefined;
  }

  const withoutFence = trimmed
    .replace(/^```(?:gitignore)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return withoutFence ? `${withoutFence}\n` : undefined;
}

function withMandatoryGitignoreRules(contents: string): string {
  const lines = contents
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !/^!\.env(?:\..*)?$/.test(line.trim()));
  const existing = new Set(lines.map((line) => line.trim()));
  for (const line of mandatoryGitignoreRules) {
    if (!existing.has(line)) {
      lines.push(line);
    }
  }

  return `${lines.filter(Boolean).join("\n")}\n`;
}

async function writeFallbackGitignore(projectRoot: string): Promise<void> {
  const existing = await readExistingGitignore(projectRoot);
  await writeFile(join(projectRoot, ".gitignore"), withMandatoryGitignoreRules(`${existing}\n${fallbackGitignore()}`), "utf8");
}

async function readExistingGitignore(projectRoot: string): Promise<string> {
  try {
    return await readFile(join(projectRoot, ".gitignore"), "utf8");
  } catch {
    return "";
  }
}

function fallbackGitignore(): string {
  return [...mandatoryGitignoreRules, ""].join("\n");
}

async function ensureNoDangerousUnignoredFiles(repoRoot: string): Promise<void> {
  const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: repoRoot
  });
  const dangerous = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((path) => dangerousUnignoredPath.test(path));
  if (dangerous) {
    throw new Error(
      `Refusing init commit because ${dangerous} is not ignored. Review .gitignore first.`
    );
  }
}

async function ensureNoDangerousWorkspaceFiles(projectRoot: string): Promise<void> {
  const [dangerous] = await fg(dangerousWorkspacePatterns, {
    cwd: projectRoot,
    dot: true,
    ignore: [".git/**", "node_modules/**", "dist/**", "build/**", "coverage/**"],
    onlyFiles: true
  });
  if (dangerous) {
    throw new Error(`Refusing to inspect or commit ${dangerous}. Add it to .gitignore first.`);
  }
}

const mandatoryGitignoreRules = [
  "node_modules/",
  "dist/",
  "build/",
  ".env",
  ".env.*",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".kube/",
  ".DS_Store",
  ".driftradar/",
  "coverage/"
];

const dangerousUnignoredPath =
  /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.aws|\.ssh|\.kube|node_modules|dist|build|coverage|id_rsa|id_dsa|id_ed25519|credentials?|secrets?|service-account)(\/|$)|(^|\/)(credentials?|secrets?|service-account)[._-].*|\.((pem|key|p12|pfx|keystore|mobileprovision))$|(^|\/).+service.?account.+\.json$/i;

const dangerousWorkspacePatterns = [
  "**/.env",
  "**/.env.*",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/.aws/**",
  "**/.ssh/**",
  "**/.kube/**",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ed25519",
  "**/*credential*",
  "**/*secret*",
  "**/*service-account*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/*.mobileprovision"
];

async function forkIfNeeded(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["repo", "view", "--json", "viewerPermission"],
      { cwd: repoRoot }
    );
    const permission = (JSON.parse(stdout) as { viewerPermission?: string }).viewerPermission;
    if (permission && ["ADMIN", "MAINTAIN", "WRITE"].includes(permission)) {
      return false;
    }

    await execFileAsync("gh", ["repo", "fork", "--remote", "--clone=false"], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

function needsRemote(projectRoot: string, repoRoot: string): ProjectReadiness {
  return {
    state: "needs_remote",
    projectRoot,
    repoRoot,
    command: `git -C ${quotePath(repoRoot)} remote add origin <repo-url>`,
    message: "Add an origin remote, then click Finish init."
  };
}

function quotePath(path: string): string {
  return JSON.stringify(path);
}

async function originRemote(repoRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function hasAnyCommit(repoRoot: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
