import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { validateConfigFile } from "../config/load-config.js";
import type {
  DomSample,
  DriftIssue,
  DriftRadarConfig,
  PageCapture,
  TokenSet
} from "../contracts/types.js";
import { renderPrComments } from "../export/pr-comments.js";
import { configSummaryFromConfig, writeRunArtifacts } from "../storage/run-storage.js";

type CropBox = NonNullable<DriftIssue["evidence"]["cropBox"]>;
type IssueSpec = {
  category: DriftIssue["category"];
  severity: DriftIssue["severity"];
  routeId: string;
  title: string;
  property: DriftIssue["property"];
  observedValue: string;
  expectedValue: string;
  state: DriftRadarConfig["states"][number];
  nearestToken?: string;
  occurrenceCount: number;
  elementId: string;
  selectorHint: string;
  cropBox: CropBox;
  tokenDistance?: number;
  fixType: string;
  cssBefore: string;
  cssAfter?: string;
  humanInstruction: string;
};

const demoPng = makeDemoPng();

export async function scanConfig(configPath: string): Promise<string> {
  const config = await validateConfigFile(configPath);
  const createdAt = new Date().toISOString();
  const warnings = await probeRoutes(config);
  for (const warning of warnings) {
    console.warn(`Scan warning: ${warning}`);
  }
  const runId = `demo-${createdAt.replace(/\D/g, "").slice(0, 17)}-${randomUUID().slice(0, 8)}`;
  const runDir = resolve(config.outputDir, "runs", runId);
  const { pages, observations } = await writeCaptureArtifacts(config, runDir, createdAt);
  const tokens = await readTokenSummary(config);
  const issues = makeIssues(config, pages);
  const report = await writeRunArtifacts({
    outputDir: config.outputDir,
    runId,
    projectName: config.projectName,
    configSummary: configSummaryFromConfig(config),
    tokens,
    pages,
    observations,
    issues,
    commandArgs: ["scan", "--config", configPath],
    status: "complete",
    createdAt
  });

  await writeFile(join(runDir, "pr-comments.md"), renderPrComments(report));

  return join(runDir, "report.json");
}

async function probeRoutes(config: DriftRadarConfig): Promise<string[]> {
  const warnings: string[] = [];
  await Promise.all(
    config.routes.map(async (route) => {
      try {
        const response = await fetch(new URL(route.url, config.baseUrl));
        if (!response.ok) {
          warnings.push(`${route.id}: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        warnings.push(`${route.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );
  return warnings;
}

async function readTokenSummary(config: DriftRadarConfig): Promise<TokenSet> {
  const sourceFiles = await Promise.all(
    config.tokenFiles.map(async (tokenFile) => ({
      path: tokenFile,
      modifiedTime: (await stat(tokenFile)).mtime.toISOString()
    }))
  );
  const css = (await Promise.all(config.tokenFiles.map((path) => readFile(path, "utf8")))).join(
    "\n"
  );
  const entries = [...css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => ({
    name: match[1],
    cssVariable: `--${match[1]}`,
    value: match[2].trim()
  }));

  return {
    sourceFiles,
    colors: entries
      .filter((entry) => /^#|^rgb|^oklch/i.test(entry.value))
      .map((entry) => ({
        name: entry.name,
        cssVariable: entry.cssVariable,
        originalValue: entry.value,
        oklch: "oklch(0 0 0)",
        hex: entry.value.startsWith("#") ? entry.value : "#000000"
      })),
    spacing: entries
      .filter((entry) => entry.name.includes("space"))
      .map((entry) => ({ name: entry.name, cssVariable: entry.cssVariable, px: px(entry.value) })),
    radii: entries
      .filter((entry) => entry.name.includes("radius"))
      .map((entry) => ({ name: entry.name, cssVariable: entry.cssVariable, px: px(entry.value) })),
    typography: [
      {
        name: "body",
        family: "Inter, system-ui, sans-serif",
        size: 16,
        lineHeight: 24,
        weight: 500,
        letterSpacing: 0
      }
    ],
    shadows: [
      {
        name: "panel",
        offsetX: 0,
        offsetY: 8,
        blur: 28,
        spread: 0,
        color: "rgba(17, 24, 39, 0.12)"
      }
    ]
  };
}

async function writeCaptureArtifacts(config: DriftRadarConfig, runDir: string, createdAt: string) {
  const pages: PageCapture[] = [];
  const observations = [];

  for (const route of config.routes) {
    for (const viewport of config.viewports) {
      for (const state of config.states) {
        const screenshotPath = `screenshots/${route.id}/${viewport.name}/${state}.png`;
        const domPath = `dom/${route.id}/${viewport.name}/${state}.json`;
        const sample = sampleForRoute(route.id, state);

        await mkdir(dirname(join(runDir, screenshotPath)), { recursive: true });
        await mkdir(dirname(join(runDir, domPath)), { recursive: true });
        await writeFile(join(runDir, screenshotPath), demoPng);
        await writeJson(join(runDir, domPath), {
          routeId: route.id,
          viewport: viewport.name,
          state,
          samples: [sample]
        });

        pages.push({
          routeId: route.id,
          viewport: viewport.name,
          state,
          screenshotPath,
          capturedAt: createdAt,
          browser: { name: "chromium", version: "demo-fixture" }
        });
        observations.push({ ...sample, routeId: route.id, viewport: viewport.name, state });
      }
    }
  }

  return { pages, observations };
}

function sampleForRoute(routeId: string, state: DriftRadarConfig["states"][number]): DomSample {
  const base = {
    elementId: `${routeId}-primary-action`,
    selectorHint: ".primary-action",
    role: "button",
    tagName: "button",
    textSample: "Start scan",
    boundingBox: { x: 32, y: 96, width: 156, height: 44 },
    computed: {
      color: "#ffffff",
      backgroundColor: "#1f6fe5",
      borderColor: "#1f6fe5",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "16px",
      fontWeight: "600",
      lineHeight: "24px",
      letterSpacing: "0px",
      margin: "0px",
      padding: "10px 18px",
      gap: "8px",
      borderRadius: "999px",
      boxShadow: "0 8px 28px rgba(17, 24, 39, 0.12)",
      opacity: "1",
      cursor: state === "disabled" ? "not-allowed" : "pointer"
    }
  };

  if (routeId === "cards") {
    return {
      ...base,
      elementId: "cards-card",
      selectorHint: ".card",
      role: undefined,
      tagName: "section",
      textSample: "Revenue",
      boundingBox: { x: 32, y: 176, width: 420, height: 120 },
      computed: {
        ...base.computed,
        color: "#111827",
        backgroundColor: "#ffffff",
        borderRadius: "44px"
      }
    };
  }

  if (routeId === "dark") {
    return {
      ...base,
      elementId: "dark-preview",
      selectorHint: ".dark-preview",
      role: undefined,
      tagName: "section",
      textSample: "Preview panel",
      boundingBox: { x: 32, y: 240, width: 420, height: 80 },
      computed: {
        ...base.computed,
        color: "#dbeafe",
        backgroundColor: "#0f172a",
        borderRadius: "12px"
      }
    };
  }

  if (routeId === "fixed") {
    return {
      ...base,
      elementId: "fixed-primary-action",
      computed: {
        ...base.computed,
        backgroundColor: "#1e64d8",
        borderColor: "#1e64d8",
        borderRadius: "8px"
      }
    };
  }

  return base;
}

function makeIssues(config: DriftRadarConfig, pages: PageCapture[]): DriftIssue[] {
  const routeIds = new Set(config.routes.map((route) => route.id));
  const states = new Set(config.states);
  return issueSpecs
    .filter((spec) => routeIds.has(spec.routeId) && states.has(spec.state))
    .map((spec) => issue(spec, pages));
}

const issueSpecs: IssueSpec[] = [
  {
    category: "token_misuse",
    severity: "high",
    routeId: "buttons",
    title: "Primary button uses a near-token blue literal",
    property: "color",
    observedValue: "#1f6fe5",
    expectedValue: "var(--color-primary-600)",
    state: "default",
    nearestToken: "--color-primary-600",
    occurrenceCount: 2,
    elementId: "buttons-primary-action",
    selectorHint: ".primary-action",
    cropBox: { x: 32, y: 96, width: 156, height: 44 },
    tokenDistance: 1.8,
    fixType: "replace-css",
    cssBefore: "background: #1f6fe5;",
    cssAfter: "background: var(--color-primary-600);",
    humanInstruction: "Replace the literal button background with var(--color-primary-600)."
  },
  {
    category: "new_pattern_candidate",
    severity: "medium",
    routeId: "cards",
    title: "Repeated 44px pill radius is untokenized",
    property: "radius",
    observedValue: "44px",
    expectedValue: "promote compact pill radius token",
    state: "default",
    occurrenceCount: 4,
    elementId: "cards-card",
    selectorHint: ".card",
    cropBox: { x: 32, y: 176, width: 420, height: 120 },
    fixType: "promote-token",
    cssBefore: "border-radius: 44px;",
    humanInstruction:
      "Promote the repeated 44px radius into a named token or replace it with --radius-card."
  },
  {
    category: "accidental_regression",
    severity: "critical",
    routeId: "forms",
    title: "Focus ring regressed from the system color",
    property: "interaction",
    observedValue: "#ff4d4f",
    expectedValue: "var(--color-focus-ring)",
    state: "focus",
    nearestToken: "--color-focus-ring",
    occurrenceCount: 1,
    elementId: "forms-primary-action",
    selectorHint: ".primary-action:focus",
    cropBox: { x: 28, y: 92, width: 164, height: 52 },
    tokenDistance: 12.4,
    fixType: "replace-css",
    cssBefore: "outline-color: #ff4d4f;",
    cssAfter: "outline-color: var(--color-focus-ring);",
    humanInstruction: "Use the shared focus-ring token for keyboard focus states."
  },
  {
    category: "acceptable_exception",
    severity: "low",
    routeId: "dark",
    title: "Dark preview surface intentionally diverges for contrast",
    property: "color",
    observedValue: "#0f172a",
    expectedValue: "#0f172a",
    state: "dark",
    occurrenceCount: 1,
    elementId: "dark-preview",
    selectorHint: ".dark-preview",
    cropBox: { x: 32, y: 240, width: 420, height: 80 },
    fixType: "document-exception",
    cssBefore: "background: #0f172a;",
    humanInstruction: "Keep the exception documented; promote it only if this surface spreads."
  }
];

function issue(spec: IssueSpec, pages: PageCapture[]): DriftIssue {
  const page = pages.find(
    (candidate) => candidate.routeId === spec.routeId && candidate.state === spec.state
  );
  if (!page) {
    throw new Error(`Missing page capture for issue route/state: ${spec.routeId}/${spec.state}`);
  }

  const id = `issue-${hash(`${spec.category}:${spec.routeId}:${spec.property}:${spec.observedValue}`).slice(0, 10)}`;
  return {
    id,
    title: spec.title,
    category: spec.category,
    severity: spec.severity,
    confidence: spec.severity === "low" ? 0.74 : 0.9,
    routeId: page.routeId,
    viewport: page.viewport,
    state: page.state,
    elementId: spec.elementId,
    selectorHint: spec.selectorHint,
    property: spec.property,
    observedValue: spec.observedValue,
    expectedValue: spec.expectedValue,
    nearestToken: spec.nearestToken,
    evidence: {
      screenshotPath: page.screenshotPath,
      cropBox: spec.cropBox,
      tokenDistance: spec.tokenDistance,
      occurrenceCount: spec.occurrenceCount,
      relatedIssueIds: []
    },
    reasoning: `${spec.title}. DriftRadar flags this because the sample app fixture repeats a value outside the documented token contract while the surrounding route uses system tokens.`,
    suggestedFix: {
      type: spec.fixType,
      cssBefore: spec.cssBefore,
      cssAfter: spec.cssAfter,
      humanInstruction: spec.humanInstruction
    },
    status: "open"
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function makeDemoPng(): Buffer {
  const png = new PNG({ width: 480, height: 360 });
  fill(png, 0, 0, 480, 360, 255, 255, 255);
  fill(png, 32, 96, 156, 44, 31, 111, 229);
  fill(png, 32, 176, 420, 120, 248, 250, 252);
  fill(png, 32, 240, 420, 80, 15, 23, 42);
  stroke(png, 32, 176, 420, 120, 229, 231, 235);
  stroke(png, 28, 92, 164, 52, 255, 77, 79);
  return PNG.sync.write(png);
}

function fill(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number
) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = (row * png.width + column) * 4;
      png.data[index] = red;
      png.data[index + 1] = green;
      png.data[index + 2] = blue;
      png.data[index + 3] = 255;
    }
  }
}

function stroke(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number
) {
  fill(png, x, y, width, 2, red, green, blue);
  fill(png, x, y + height - 2, width, 2, red, green, blue);
  fill(png, x, y, 2, height, red, green, blue);
  fill(png, x + width - 2, y, 2, height, red, green, blue);
}
