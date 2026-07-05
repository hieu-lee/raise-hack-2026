import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface AppliedFixRecord {
  issueId: string;
  filePath: string;
  appliedAt: string;
}

export async function loadAppliedFixes(runDir: string): Promise<AppliedFixRecord[]> {
  try {
    const raw = await readFile(join(runDir, "applied-fixes.json"), "utf8");
    return JSON.parse(raw) as AppliedFixRecord[];
  } catch {
    return [];
  }
}

export async function appendAppliedFix(
  runDir: string,
  record: AppliedFixRecord
): Promise<AppliedFixRecord[]> {
  const current = await loadAppliedFixes(runDir);
  const next = [...current.filter((entry) => entry.issueId !== record.issueId), record];
  await writeFile(join(runDir, "applied-fixes.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function appliedIssueIds(runDir: string): Promise<Set<string>> {
  return new Set((await loadAppliedFixes(runDir)).map((entry) => entry.issueId));
}
