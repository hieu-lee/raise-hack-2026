import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DriftIssue } from "../contracts/types.js";
import { applyIssueFix, applyIssueFixes, allowedRootsFromIssues } from "./apply-fix.js";

let tempDir: string;
const execFileAsync = promisify(execFile);

const baseIssue = (overrides: Partial<DriftIssue> = {}): DriftIssue =>
  ({
    id: "issue-1",
    title: "Test issue",
    category: "token_misuse",
    severity: "high",
    confidence: 0.9,
    routeId: "home",
    viewport: "desktop",
    state: "default",
    elementId: "btn",
    selectorHint: ".btn",
    property: "color",
    observedValue: "#111",
    reasoning: "test",
    evidence: { screenshotPath: "screenshots/a.png", relatedIssueIds: [] },
    suggestedFix: {
      type: "replace_with_token",
      humanInstruction: "Use token"
    },
    status: "open",
    ...overrides
  }) as DriftIssue;

describe("applyIssueFix", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "driftradar-apply-fix-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("replaces cssBefore with cssAfter in a css file", async () => {
    const filePath = join(tempDir, "styles.css");
    await writeFile(filePath, ".btn { color: #111; }\n", "utf8");
    await commitFixture([filePath]);

    const result = await applyIssueFix(
      baseIssue({
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: filePath,
          cssBefore: "color: #111;",
          cssAfter: "color: var(--primary);",
          humanInstruction: "Use token"
        }
      }),
      [tempDir]
    );

    expect(result.ok).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(".btn { color: var(--primary); }\n");
  });

  it("replaces tsxBefore with tsxAfter in a tsx file", async () => {
    const filePath = join(tempDir, "Card.tsx");
    await writeFile(filePath, '<div className="gap-2">x</div>\n', "utf8");
    await commitFixture([filePath]);

    const result = await applyIssueFix(
      baseIssue({
        suggestedFix: {
          type: "promote_pattern",
          sourceFile: filePath,
          tsxBefore: 'className="gap-2"',
          tsxAfter: 'className="gap-token-2"',
          humanInstruction: "Promote gap token"
        }
      }),
      [tempDir]
    );

    expect(result.ok).toBe(true);
    expect(await readFile(filePath, "utf8")).toContain('className="gap-token-2"');
  });

  it("returns an error when the before snippet is missing", async () => {
    const filePath = join(tempDir, "missing.css");
    await writeFile(filePath, ".btn { color: blue; }\n", "utf8");
    await commitFixture([filePath]);

    const result = await applyIssueFix(
      baseIssue({
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: filePath,
          cssBefore: "color: #111;",
          cssAfter: "color: var(--primary);",
          humanInstruction: "Use token"
        }
      }),
      [tempDir]
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/before snippet/i);
  });

  it("applies multiple fixes and reports skips", async () => {
    const cssPath = join(tempDir, "a.css");
    const tsxPath = join(tempDir, "b.tsx");
    await writeFile(cssPath, "color: old;\n", "utf8");
    await writeFile(tsxPath, '<span className="old">x</span>\n', "utf8");
    await commitFixture([cssPath, tsxPath]);

    const issues = [
      baseIssue({
        id: "ok",
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: cssPath,
          cssBefore: "color: old;",
          cssAfter: "color: new;",
          humanInstruction: "fix css"
        }
      }),
      baseIssue({
        id: "skip",
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: tsxPath,
          tsxBefore: 'className="missing"',
          tsxAfter: 'className="new"',
          humanInstruction: "fix tsx"
        }
      })
    ];

    const batch = await applyIssueFixes(issues, undefined, [tempDir]);
    expect(batch.applied).toHaveLength(1);
    expect(batch.skipped).toEqual([
      { issueId: "skip", error: expect.stringMatching(/before snippet/i) }
    ]);
  });

  it("allows source files under configured roots", async () => {
    const external = join(tempDir, "tailadmin", "src", "Card.tsx");
    await mkdir(dirname(external), { recursive: true });
    await writeFile(join(tempDir, "tailadmin", "package.json"), "{}", "utf8");
    const roots = allowedRootsFromIssues([
      baseIssue({
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: external,
          humanInstruction: "fix"
        }
      })
    ]);

    expect(roots).toContain(join(tempDir, "tailadmin"));
  });

  it("rejects source files outside allowed roots", async () => {
    const result = await applyIssueFix(
      baseIssue({
        suggestedFix: {
          type: "replace_with_token",
          sourceFile: "/etc/passwd",
          cssBefore: "root:",
          cssAfter: "root: ok;",
          humanInstruction: "nope"
        }
      }),
      [tempDir]
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/allowed repository roots/i);
  });
});

async function commitFixture(files: string[]): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: tempDir });
  await execFileAsync("git", ["add", "--", ...files], { cwd: tempDir });
  await execFileAsync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
    {
      cwd: tempDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "DriftRadar Test",
        GIT_AUTHOR_EMAIL: "driftradar@example.com",
        GIT_COMMITTER_NAME: "DriftRadar Test",
        GIT_COMMITTER_EMAIL: "driftradar@example.com"
      }
    }
  );
}
