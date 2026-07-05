import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DriftIssue,
  DriftRadarConfig,
  DriftReport,
  ObservationRecord,
  PageCapture,
  TokenSet
} from "../contracts/types.js";
import { buildReport } from "../report/report-builder.js";

const safeRunId = /^[A-Za-z0-9._-]+$/;

export interface WriteRunInput {
  outputDir?: string;
  runId: string;
  projectName: string;
  configSummary: DriftReport["configSummary"];
  tokens: TokenSet;
  pages: PageCapture[];
  observations: ObservationRecord[];
  issues: DriftIssue[];
  commandArgs?: string[];
  timings?: Record<string, number>;
  status?: "complete" | "failed";
  createdAt?: string;
}

export async function writeRunArtifacts(input: WriteRunInput): Promise<DriftReport> {
  if (!isSafeRunId(input.runId)) {
    throw new Error(`Invalid run ID: ${input.runId}`);
  }

  const outputDir = input.outputDir ?? ".driftradar";
  const runDir = join(outputDir, "runs", input.runId);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const report = buildReport({ ...input, createdAt });

  await mkdir(runDir, { recursive: true });
  await Promise.all([
    writeJsonAtomic(join(runDir, "manifest.json"), {
      runId: input.runId,
      projectName: input.projectName,
      createdAt,
      commandArgs: input.commandArgs ?? [],
      timings: input.timings ?? {},
      status: input.status ?? "complete"
    }),
    writeJsonAtomic(join(runDir, "tokens.json"), input.tokens),
    writeJsonAtomic(join(runDir, "pages.json"), input.pages),
    writeJsonAtomic(join(runDir, "issues.json"), report.issues),
    writeJsonlAtomic(join(runDir, "observations.jsonl"), input.observations),
    writeJsonAtomic(join(runDir, "report.json"), report)
  ]);

  return report;
}

function isSafeRunId(runId: string): boolean {
  return safeRunId.test(runId) && runId !== "." && runId !== "..";
}

export function configSummaryFromConfig(config: DriftRadarConfig): DriftReport["configSummary"] {
  return {
    routes: config.routes.length,
    viewports: config.viewports.length,
    states: config.states,
    tokenFiles: config.tokenFiles.length
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonlAtomic(path: string, values: unknown[]): Promise<void> {
  const lines = values.map((value) => JSON.stringify(value)).join("\n");
  await writeAtomic(path, lines ? `${lines}\n` : "");
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(tempPath, contents);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
