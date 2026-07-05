import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import fg from "fast-glob";
import type { DriftIssue } from "../contracts/types.js";

const markupExtensions = new Set([".html", ".tsx", ".jsx", ".vue"]);
const ignoredSourceGlobs = [
  "**/.git/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/out/**",
  "**/storybook-static/**",
  "**/vendor/**"
];
const sourceFileCache = new Map<string, Promise<string[]>>();

export const repoPatchOutputSchema = {
  type: "object",
  properties: {
    cssAfter: { type: ["string", "null"] },
    tsxAfter: { type: ["string", "null"] },
    humanInstruction: { type: "string" }
  },
  required: ["cssAfter", "tsxAfter", "humanInstruction"],
  additionalProperties: false
};

export interface RepoFixResult {
  sourceFile?: string;
  cssBefore?: string;
  cssAfter?: string;
  tsxBefore?: string;
  tsxAfter?: string;
  humanInstruction: string;
  aiSuggested?: boolean;
}

export interface RepoPatchSuggestion {
  cssAfter: string | null;
  tsxAfter: string | null;
  humanInstruction: string;
}

export interface RepoPatchPrompt {
  issue: {
    title: string;
    category: DriftIssue["category"];
    property: DriftIssue["property"];
    observedValue: string;
    expectedValue?: string;
    nearestToken?: string;
    selectorHint: string;
  };
  sourceFile: string;
  cssBefore?: string;
  tsxBefore?: string;
}

export interface RepoPatchAiClient {
  suggestRepoPatch(input: RepoPatchPrompt): Promise<RepoPatchSuggestion | undefined>;
}

export async function suggestRepoFix(
  issue: DriftIssue,
  sourceRoots: string[],
  client?: RepoPatchAiClient
): Promise<RepoFixResult | undefined> {
  const selector = selectorFromHint(issue.selectorHint);
  const cssHit = await findCssRule(sourceRoots, selector, issue.observedValue);
  const markupHit = await findMarkup(sourceRoots, selector);

  const base: RepoFixResult = {
    sourceFile: cssHit?.file ?? markupHit?.file,
    cssBefore: issue.suggestedFix.cssBefore ?? cssHit?.rule,
    cssAfter:
      issue.suggestedFix.cssAfter ??
      (cssHit?.rule
        ? applyCssReplacement(
            cssHit.rule,
            issue.observedValue,
            issue.expectedValue,
            issue.nearestToken
          )
        : undefined),
    tsxBefore: markupHit?.snippet,
    tsxAfter: markupAfter(markupHit?.snippet, cssHit?.file),
    humanInstruction: issue.suggestedFix.humanInstruction
  };

  if (!client || !base.sourceFile) {
    return refineRepoFix(base, issue);
  }

  const prompt = await client.suggestRepoPatch({
    issue: {
      title: issue.title,
      category: issue.category,
      property: issue.property,
      observedValue: issue.observedValue,
      expectedValue: issue.expectedValue,
      nearestToken: issue.nearestToken,
      selectorHint: issue.selectorHint
    },
    sourceFile: base.sourceFile,
    cssBefore: base.cssBefore,
    tsxBefore: base.tsxBefore
  });

  return refineRepoFix(
    {
      ...base,
      cssAfter: prompt?.cssAfter ?? base.cssAfter,
      tsxAfter: prompt?.tsxAfter ?? base.tsxAfter,
      humanInstruction: prompt?.humanInstruction ?? base.humanInstruction,
      aiSuggested: Boolean(prompt)
    },
    issue
  );
}

async function findCssRule(
  sourceRoots: string[],
  selector: string,
  observedValue: string
): Promise<{ file: string; rule: string } | undefined> {
  const files = await sourceFiles(sourceRoots, ["**/*.{css,scss}"]);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const rule = extractRule(content, selector);
    if (rule && rule.includes(observedValue.replace(/^[^:]+:\s*/, "").replace(/;$/, ""))) {
      return { file, rule };
    }
    if (rule && observedValue.includes(":")) {
      return { file, rule };
    }
  }
  return undefined;
}

// Matches `className="..."`, `class="..."`, and template-literal className attributes so we can
// search the actual attribute value rather than raw line text (JSX/Vue often wrap class lists
// across multiple lines or interpolate them).
const classAttributePattern = /(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

async function findMarkup(
  sourceRoots: string[],
  selector: string
): Promise<{ file: string; snippet: string } | undefined> {
  const { classes } = parseSelectorClasses(selector);
  if (classes.length === 0) {
    return undefined;
  }

  const files = await sourceFiles(sourceRoots, ["**/*.{html,tsx,jsx,vue}"]);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    classAttributePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = classAttributePattern.exec(content))) {
      const classText = match[1] ?? match[2] ?? match[3] ?? "";
      if (classes.every((className) => classText.includes(className))) {
        return { file, snippet: snippetAround(content, match.index) };
      }
    }
  }
  return undefined;
}

// Selector hints from DOM capture are compound CSS-selector-style strings like
// `div.p-4.border-t.border-gray-100` (tag + up to three classes joined with dots). That format
// is meaningful as a compound CSS selector but never appears literally in JSX/Vue class
// attributes, which are space-separated. Split it back into individual class tokens to search
// Tailwind-style utility-class markup.
function parseSelectorClasses(selector: string): { tag?: string; classes: string[] } {
  const withoutAttributeHint = selector.replace(/\[[^\]]*\]/g, "");
  const parts = withoutAttributeHint
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  const tag = parts[0] && /^[a-z][a-z0-9]*$/i.test(parts[0]) ? parts[0] : undefined;
  const classes = tag ? parts.slice(1) : parts;
  return { tag, classes };
}

function snippetAround(content: string, matchIndex: number): string {
  const lines = content.split("\n");
  let consumed = 0;
  let lineIndex = 0;
  for (; lineIndex < lines.length; lineIndex += 1) {
    consumed += lines[lineIndex].length + 1;
    if (consumed > matchIndex) {
      break;
    }
  }
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return lines.slice(start, end).join("\n");
}

async function sourceFiles(sourceRoots: string[], patterns: string[]): Promise<string[]> {
  const { resolve } = await import("node:path");
  const roots = sourceRoots.map((root) => resolve(root));
  const key = JSON.stringify({ roots, patterns });
  const cached =
    sourceFileCache.get(key) ??
    Promise.all(
      roots.map((root) =>
        fg(patterns, {
          cwd: root,
          absolute: true,
          followSymbolicLinks: false,
          ignore: ignoredSourceGlobs
        })
      )
    ).then((matches) => [...new Set(matches.flat())]);
  sourceFileCache.set(key, cached);
  const matches = await cached;
  return matches;
}

function extractRule(content: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`, "s"));
  return match?.[0];
}

function selectorFromHint(selectorHint: string): string {
  return selectorHint.split(":")[0]?.trim() || selectorHint;
}

function applyCssReplacement(
  rule: string,
  observedValue: string,
  expectedValue?: string,
  nearestToken?: string
): string {
  const replacement = tokenCssValue(expectedValue, nearestToken);
  if (!replacement) {
    return rule;
  }

  const literal = observedValue.includes(":")
    ? observedValue.split(":").slice(1).join(":").replace(/;$/, "").trim()
    : observedValue;

  if (literal && rule.includes(literal)) {
    return rule.replace(literal, replacement);
  }

  return `${rule}\n/* suggested: use ${replacement} */`;
}

function tokenCssValue(expectedValue?: string, nearestToken?: string): string | undefined {
  if (expectedValue) {
    return expectedValue.replace(/^var\((--[^)]+)\)$/, "var($1)");
  }
  if (nearestToken?.startsWith("--")) {
    return `var(${nearestToken})`;
  }
  return nearestToken;
}

function refineRepoFix(base: RepoFixResult, issue: DriftIssue): RepoFixResult {
  const relativeFile = base.sourceFile;
  const instruction = base.humanInstruction || issue.suggestedFix.humanInstruction;
  if (relativeFile && base.cssAfter && base.cssBefore !== base.cssAfter) {
    return {
      ...base,
      humanInstruction: `${instruction} Patch ${relativeFile}.`
    };
  }
  return {
    ...base,
    humanInstruction: instruction
  };
}

function markupAfter(snippet: string | undefined, sourceFile?: string): string | undefined {
  if (!snippet) {
    return undefined;
  }
  if (!sourceFile) {
    return snippet;
  }
  return `${snippet}\n<!-- patch styles in ${sourceFile} -->`;
}

export function isMarkupFile(path: string): boolean {
  return markupExtensions.has(extname(path).toLowerCase());
}
