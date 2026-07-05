import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CreatePrInput {
  repoRoot: string;
  branchName: string;
  title: string;
  body: string;
  files: string[];
}

export interface CreatePrResult {
  ok: boolean;
  branchName: string;
  prUrl?: string;
  error?: string;
}

export async function createPullRequest(input: CreatePrInput): Promise<CreatePrResult> {
  const repoRoot = resolve(input.repoRoot);
  const files = [...new Set(input.files.map((file) => resolve(file)))];
  let branchName = input.branchName;
  if (files.length === 0) {
    return { ok: false, branchName, error: "No files to commit." };
  }

  try {
    branchName = await checkoutNewBranch(repoRoot, branchName);
    await runGit(repoRoot, ["add", "--", ...files]);
    const committed = await tryCommit(repoRoot, input.title, input.body, files);
    if (!committed) {
      return {
        ok: false,
        branchName,
        error: "No changes to commit for this pull request."
      };
    }

    try {
      await runGit(repoRoot, ["push", "-u", "origin", branchName]);
    } catch (error) {
      return {
        ok: false,
        branchName,
        error: error instanceof Error ? error.message : "Git push failed."
      };
    }
  } catch (error) {
    return {
      ok: false,
      branchName,
      error: error instanceof Error ? error.message : "Git commit failed."
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "create", "--title", input.title, "--body", input.body],
      { cwd: repoRoot }
    );
    const prUrl = stdout.trim().split("\n").pop();
    return { ok: true, branchName, prUrl };
  } catch (error) {
    return {
      ok: false,
      branchName,
      error:
        error instanceof Error
          ? `${error.message}. Push the branch and open a PR manually.`
          : "gh pr create failed."
    };
  }
}

export async function findGitRoot(startPath: string): Promise<string | undefined> {
  let current = resolve(startPath);
  while (true) {
    try {
      await access(resolve(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}

async function checkoutNewBranch(repoRoot: string, branchName: string): Promise<string> {
  for (const candidate of [branchName, `${branchName}-${Date.now()}`]) {
    try {
      await runGit(repoRoot, ["checkout", "-b", candidate]);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("Could not create a DriftRadar pull request branch.");
}

async function tryCommit(
  repoRoot: string,
  title: string,
  body: string,
  files: string[]
): Promise<boolean> {
  try {
    await runGit(repoRoot, ["commit", "-m", title, "-m", body, "--", ...files]);
    return true;
  } catch (error) {
    const message = gitErrorMessage(error);
    if (isEmptyCommitMessage(message)) {
      return false;
    }
    throw error;
  }
}

function isEmptyCommitMessage(message: string): boolean {
  return message.includes("nothing to commit") || message.includes("no changes added to commit");
}

function gitErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = "stderr" in error ? String((error as { stderr?: Buffer | string }).stderr ?? "") : "";
    const stdout = "stdout" in error ? String((error as { stdout?: Buffer | string }).stdout ?? "") : "";
    const base = error instanceof Error ? error.message : "";
    return `${stderr}\n${stdout}\n${base}`;
  }
  return String(error);
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
