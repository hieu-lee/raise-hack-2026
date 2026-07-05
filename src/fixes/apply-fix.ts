import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";
import type { DriftIssue } from "../contracts/types.js";

const execFileAsync = promisify(execFile);

export interface ApplyFixResult {
  ok: boolean;
  issueId?: string;
  filePath?: string;
  error?: string;
}

export async function applyIssueFix(
  issue: DriftIssue,
  allowedRoots: string[] = defaultAllowedRoots(),
  dirtyByCurrentBatch: Set<string> = new Set()
): Promise<ApplyFixResult> {
  const fix = issue.suggestedFix;
  if (!fix?.sourceFile) {
    return { ok: false, error: "No source file attached to this fix." };
  }

  const sourceFile = await validateSourceFile(fix.sourceFile, allowedRoots);
  if (!sourceFile) {
    return { ok: false, error: "Source file is outside allowed repository roots." };
  }
  if (!dirtyByCurrentBatch.has(sourceFile) && !(await isSourceFileClean(sourceFile))) {
    return {
      ok: false,
      error: "Source file has existing local edits. Commit or stash them before applying fixes."
    };
  }

  const replacement = pickReplacement(fix, extname(sourceFile));
  if (!replacement) {
    return { ok: false, error: "No applicable before/after snippet for this fix." };
  }

  const content = await readFile(sourceFile, "utf8");
  const next = replaceFirst(content, replacement.before, replacement.after);
  if (next === undefined) {
    return { ok: false, error: "Could not find the before snippet in the source file." };
  }

  await writeFile(sourceFile, next, "utf8");
  return { ok: true, filePath: sourceFile };
}

export async function applyIssueFixes(
  issues: DriftIssue[],
  issueIds?: string[],
  allowedRoots: string[] = defaultAllowedRoots()
): Promise<{ applied: ApplyFixResult[]; skipped: { issueId: string; error: string }[] }> {
  const selected =
    issueIds && issueIds.length > 0
      ? issues.filter((issue) => issueIds.includes(issue.id))
      : issues;

  const applied: ApplyFixResult[] = [];
  const skipped: { issueId: string; error: string }[] = [];
  const dirtyByCurrentBatch = new Set<string>();

  for (const issue of selected) {
    const result = await applyIssueFix(issue, allowedRoots, dirtyByCurrentBatch);
    if (result.ok) {
      applied.push({ ...result, issueId: issue.id });
      if (result.filePath) {
        dirtyByCurrentBatch.add(result.filePath);
      }
    } else {
      skipped.push({ issueId: issue.id, error: result.error ?? "Apply failed." });
    }
  }

  return { applied, skipped };
}

function pickReplacement(
  fix: NonNullable<DriftIssue["suggestedFix"]>,
  extension: string
): { before: string; after: string } | undefined {
  const markupFirst = markupExtensions.has(extension);
  const markup =
    fix.tsxBefore && fix.tsxAfter ? { before: fix.tsxBefore, after: fix.tsxAfter } : undefined;
  const css =
    fix.cssBefore && fix.cssAfter ? { before: fix.cssBefore, after: fix.cssAfter } : undefined;

  if (markupFirst) {
    return markup ?? css;
  }

  return css ?? markup;
}

function replaceFirst(content: string, before: string, after: string): string | undefined {
  const index = content.indexOf(before);
  if (index < 0) {
    return undefined;
  }

  return `${content.slice(0, index)}${after}${content.slice(index + before.length)}`;
}

const markupExtensions = new Set([".html", ".tsx", ".jsx", ".vue"]);

export function patchPreviewForFix(
  fix: NonNullable<DriftIssue["suggestedFix"]>
): { before: string; after: string } | undefined {
  if (!fix.sourceFile) {
    const markup =
      fix.tsxBefore && fix.tsxAfter ? { before: fix.tsxBefore, after: fix.tsxAfter } : undefined;
    const css =
      fix.cssBefore && fix.cssAfter ? { before: fix.cssBefore, after: fix.cssAfter } : undefined;
    return markup ?? css;
  }

  return pickReplacement(fix, extname(fix.sourceFile));
}

async function validateSourceFile(
  sourceFile: string,
  allowedRoots: string[]
): Promise<string | undefined> {
  const resolved = resolve(sourceFile);
  let canonical: string;
  try {
    canonical = await realpath(resolved);
  } catch {
    return undefined;
  }

  const roots = await Promise.all(
    allowedRoots.map(async (root) => {
      try {
        return await realpath(resolve(root));
      } catch {
        return resolve(root);
      }
    })
  );
  return roots.some((root) => canonical === root || canonical.startsWith(`${root}/`))
    ? resolved
    : undefined;
}

export function allowedRootsFromIssues(issues: DriftIssue[]): string[] {
  const roots = new Set(defaultAllowedRoots());
  for (const issue of issues) {
    const file = issue.suggestedFix?.sourceFile;
    if (!file) {
      continue;
    }

    const projectRoot = nearestProjectRoot(file);
    if (projectRoot) {
      roots.add(projectRoot);
    }
  }

  return [...roots];
}

function nearestProjectRoot(sourceFile: string): string | undefined {
  let current = dirname(resolve(sourceFile));
  while (true) {
    if (existsSync(resolve(current, ".git")) || existsSync(resolve(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function isSourceFileClean(sourceFile: string): Promise<boolean> {
  try {
    const { stdout: repoRoot } = await execFileAsync("git", [
      "-C",
      dirname(sourceFile),
      "rev-parse",
      "--show-toplevel"
    ]);
    await execFileAsync("git", ["-C", repoRoot.trim(), "ls-files", "--error-unmatch", sourceFile]);
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoRoot.trim(),
      "status",
      "--porcelain",
      "--",
      sourceFile
    ]);
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

function defaultAllowedRoots(): string[] {
  const fromEnv = process.env.DRIFTRADAR_SOURCE_ROOTS?.split(",")
    .map((root) => root.trim())
    .filter(Boolean);
  return fromEnv?.length ? fromEnv : [process.cwd()];
}
