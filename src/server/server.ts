import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";
import { runCopilot, sanitizeHistory, type CopilotRequest } from "../ai/copilot.js";
import { ensureIssueNames } from "../ai/issue-names.js";
import { draftPullRequest } from "../ai/pr-draft.js";
import { ensureStylePropagationPlan } from "../ai/style-propagation.js";
import { renderPrComments } from "../export/pr-comments.js";
import { reportSchema } from "../contracts/schemas.js";
import type { DriftReport } from "../contracts/types.js";
import { appendAppliedFix, loadAppliedFixes } from "../fixes/applied-fixes.js";
import { allowedRootsFromIssues, applyIssueFix, applyIssueFixes } from "../fixes/apply-fix.js";
import { createPullRequest, findGitRoot } from "../git/create-pr.js";
import {
  finishProjectInit,
  getProjectReadiness,
  prepareProjectForPullRequests
} from "../git/project-readiness.js";

const serverVersion = "0.1.0";
const safeRunId = /^[A-Za-z0-9._-]+$/;

export interface ServerOptions {
  outputDir?: string;
  selectedRunId?: string;
}

export function createDashboardApp(options: ServerOptions = {}): express.Express {
  const outputDir = options.outputDir ?? ".driftradar";
  const mutationToken = randomUUID();
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use((_request, response, next) => {
    response.set({
      "Access-Control-Allow-Headers": "content-type, x-driftradar-client, x-driftradar-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": "*"
    });
    next();
  });

  const requireDashboardMutation = (request: Request, response: Response): response is Response => {
    if (!isLocalRequest(request) || !isAllowedCopilotRequest(request)) {
      response.status(403).json({
        error: "This action is only available from the DriftRadar dashboard on localhost"
      });
      return false;
    }
    if (request.get("x-driftradar-token") !== mutationToken) {
      response.status(403).json({ error: "Dashboard mutation token is invalid" });
      return false;
    }
    return true;
  };

  app.options(/.*/, (_request, response) => {
    response.sendStatus(204);
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", version: serverVersion, mutationToken });
  });

  app.get("/api/runs", async (_request, response) => {
    response.json({ runs: await listRuns(outputDir, options.selectedRunId) });
  });

  app.get("/api/runs/:runId/report", async (request, response) => {
    const report = await readReport(outputDir, request.params.runId, response);
    if (report) {
      response.json(report);
    }
  });

  app.get("/api/runs/:runId/issues", async (request, response) => {
    const report = await readReport(outputDir, request.params.runId, response);
    if (report) {
      response.json({ summary: report.summary, issues: report.issues });
    }
  });

  app.get("/api/runs/:runId/issues/:issueId", async (request, response) => {
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report) {
      return;
    }

    const issue = report.issues.find((candidate) => candidate.id === request.params.issueId);
    if (!issue) {
      json404(response, "Issue not found");
      return;
    }

    response.json(issue);
  });

  app.use("/api/runs/:runId/assets", async (request: Request, response) => {
    if (request.method !== "GET") {
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    const runId = pathParam(request.params.runId);
    const assetPath = normalize(assetPathFromOriginalUrl(request.originalUrl, runId));
    const runDir = runDirectory(outputDir, runId);
    if (!runDir) {
      json404(response, "Run not found");
      return;
    }

    const asset = resolve(runDir, assetPath);
    if (
      asset === runDir ||
      !isAllowedAsset(assetPath) ||
      !asset.startsWith(`${runDir}/`) ||
      basename(asset) === ""
    ) {
      json404(response, "Asset not found");
      return;
    }

    try {
      const assetStat = await stat(asset);
      if (!assetStat.isFile()) {
        throw new Error("asset is not a file");
      }
      response.type(extname(assetPath) || "application/octet-stream").send(await readFile(asset));
    } catch {
      json404(response, "Asset not found");
    }
  });

  app.get("/api/runs/:runId/export/pr-comments", async (request, response) => {
    const report = await readReport(outputDir, request.params.runId, response);
    if (report) {
      response.type("text/markdown").send(renderPrComments(report));
    }
  });

  app.get("/api/runs/:runId/issue-names", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const runDir = runDirectory(outputDir, request.params.runId);
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report || !runDir) {
      return;
    }

    try {
      const names = await ensureIssueNames(report.issues, runDir);
      response.json({ names });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Issue naming failed"
      });
    }
  });

  app.get("/api/runs/:runId/applied-fixes", async (request, response) => {
    const runDir = runDirectory(outputDir, request.params.runId);
    if (!runDir) {
      json404(response, "Run not found");
      return;
    }

    response.json({ applied: await loadAppliedFixes(runDir) });
  });

  app.get("/api/runs/:runId/project-readiness", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const report = await readReport(outputDir, request.params.runId, response);
    if (!report) {
      return;
    }

    response.json(await getProjectReadiness(report));
  });

  app.get("/api/runs/:runId/style-propagation", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const runDir = runDirectory(outputDir, request.params.runId);
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report || !runDir) {
      return;
    }

    try {
      response.json(
        await ensureStylePropagationPlan(report, runDir, {
          baseRef:
            typeof request.query.baseRef === "string" && request.query.baseRef.trim()
              ? request.query.baseRef.trim()
              : process.env.DRIFTRADAR_STYLE_BASE_REF,
          headRef:
            typeof request.query.headRef === "string" && request.query.headRef.trim()
              ? request.query.headRef.trim()
              : process.env.DRIFTRADAR_STYLE_HEAD_REF
        })
      );
    } catch (error) {
      response.status(502).json({
        status: "error",
        error: error instanceof Error ? error.message : "Style propagation failed"
      });
    }
  });

  app.post("/api/runs/:runId/project-readiness/prepare", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const report = await readReport(outputDir, request.params.runId, response);
    if (!report) {
      return;
    }

    try {
      response.json(await prepareProjectForPullRequests(report));
    } catch (error) {
      response.status(409).json({
        state: "error",
        message: error instanceof Error ? error.message : "Project preparation failed"
      });
    }
  });

  app.post("/api/runs/:runId/project-readiness/finish-init", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const report = await readReport(outputDir, request.params.runId, response);
    if (!report) {
      return;
    }

    try {
      response.json(await finishProjectInit(report));
    } catch (error) {
      response.status(409).json({
        state: "error",
        message: error instanceof Error ? error.message : "Initial commit failed"
      });
    }
  });

  app.post("/api/runs/:runId/issues/:issueId/apply", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const runDir = runDirectory(outputDir, request.params.runId);
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report || !runDir) {
      return;
    }

    const issue = report.issues.find((candidate) => candidate.id === request.params.issueId);
    if (!issue) {
      json404(response, "Issue not found");
      return;
    }

    const result = await applyIssueFix(issue, allowedRootsFromIssues(report.issues));
    if (!result.ok) {
      response.status(409).json(result);
      return;
    }

    await appendAppliedFix(runDir, {
      issueId: issue.id,
      filePath: result.filePath!,
      appliedAt: new Date().toISOString()
    });
    response.json({ ...result, issueId: issue.id });
  });

  app.post("/api/runs/:runId/issues/apply-all", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const runDir = runDirectory(outputDir, request.params.runId);
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report || !runDir) {
      return;
    }

    const issueIds = Array.isArray((request.body as { issueIds?: unknown }).issueIds)
      ? ((request.body as { issueIds: string[] }).issueIds ?? [])
      : undefined;
    const allowedRoots = allowedRootsFromIssues(report.issues);
    const batch = await applyIssueFixes(report.issues, issueIds, allowedRoots);

    for (const result of batch.applied) {
      if (!result.issueId || !result.filePath) {
        continue;
      }
      await appendAppliedFix(runDir, {
        issueId: result.issueId,
        filePath: result.filePath,
        appliedAt: new Date().toISOString()
      });
    }

    response.json(batch);
  });

  app.post("/api/runs/:runId/create-pr", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const runDir = runDirectory(outputDir, request.params.runId);
    const report = await readReport(outputDir, request.params.runId, response);
    if (!report || !runDir) {
      return;
    }

    const applied = await loadAppliedFixes(runDir);
    if (applied.length === 0) {
      response.status(400).json({ error: "Apply fixes before creating a pull request." });
      return;
    }

    let readiness = await getProjectReadiness(report);
    if (readiness.state === "ready") {
      readiness = await prepareProjectForPullRequests(report);
    }
    if (readiness.state !== "ready") {
      response.status(409).json({ ok: false, readiness, error: readiness.message });
      return;
    }

    const appliedByIssueId = new Map(applied.map((entry) => [entry.issueId, entry.filePath]));
    const appliedIssues = report.issues.filter((issue) => {
      const appliedPath = appliedByIssueId.get(issue.id);
      const sourceFile = issue.suggestedFix?.sourceFile;
      return (
        typeof appliedPath === "string" &&
        typeof sourceFile === "string" &&
        resolve(appliedPath) === resolve(sourceFile)
      );
    });
    if (appliedIssues.length !== applied.length) {
      response.status(409).json({ error: "Applied fixes no longer match the current report." });
      return;
    }
    const draft = await draftPullRequest(report.projectName, appliedIssues);
    const files = [
      ...new Set(
        appliedIssues
          .map((issue) => issue.suggestedFix?.sourceFile)
          .filter((filePath): filePath is string => typeof filePath === "string")
      )
    ];
    if (files.length === 0) {
      response.status(400).json({ error: "Applied fixes do not reference source files." });
      return;
    }
    const repoRoot =
      (await findGitRoot(files[0] ?? process.cwd())) ??
      process.env.DRIFTRADAR_REPO_ROOT ??
      process.cwd();
    const branchName = `driftradar/${report.runId}-${Date.now()}`;

    const pr = await createPullRequest({
      repoRoot,
      branchName,
      title: draft.title,
      body: draft.body,
      files
    });

    response.json({ draft, ...pr });
  });

  app.post("/api/runs/:runId/copilot", async (request, response) => {
    if (!requireDashboardMutation(request, response)) {
      return;
    }

    const report = await readReport(outputDir, request.params.runId, response);
    if (!report) {
      return;
    }

    const body = request.body as CopilotRequest;
    if (!body?.message?.trim()) {
      response.status(400).json({ error: "message is required" });
      return;
    }

    try {
      const result = await runCopilot(report, {
        message: body.message.trim(),
        issueId: typeof body.issueId === "string" ? body.issueId : undefined,
        history: sanitizeHistory(body.history)
      });
      response.json(result);
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Copilot request failed"
      });
    }
  });

  return app;
}

export async function serveDashboard(options: ServerOptions & { port: number }): Promise<void> {
  const app = createDashboardApp(options);
  await new Promise<void>((resolveListen) => {
    app.listen(options.port, () => {
      console.log(`DriftRadar API ready: http://localhost:${options.port}`);
      resolveListen();
    });
  });
}

async function listRuns(outputDir: string, selectedRunId?: string): Promise<unknown[]> {
  const runsDir = resolve(outputDir, "runs");

  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && safeRunId.test(entry.name))
          .map(async (entry) => {
            const reportPath = join(runsDir, entry.name, "report.json");
            try {
              const reportStat = await stat(reportPath);
              return {
                runId: entry.name,
                createdAt: reportStat.mtime.toISOString(),
                reportPath: normalize(join("runs", entry.name, "report.json"))
              };
            } catch {
              return undefined;
            }
          })
      )
    ).filter((run) => run !== undefined);

    return runs.sort((left, right) => {
      if (left.runId === selectedRunId) {
        return -1;
      }
      if (right.runId === selectedRunId) {
        return 1;
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  } catch {
    return [];
  }
}

async function readReport(
  outputDir: string,
  runId: string,
  response: Response
): Promise<DriftReport | undefined> {
  const runDir = runDirectory(outputDir, runId);
  if (!runDir) {
    json404(response, "Run not found");
    return undefined;
  }

  try {
    const raw = await readFile(join(runDir, "report.json"), "utf8");
    return reportSchema.parse(JSON.parse(raw));
  } catch {
    json404(response, "Run not found");
    return undefined;
  }
}

function runDirectory(outputDir: string, runId: string): string | undefined {
  if (!isSafeRunId(runId)) {
    return undefined;
  }

  return resolve(outputDir, "runs", runId);
}

function isSafeRunId(runId: string): boolean {
  return safeRunId.test(runId) && runId !== "." && runId !== "..";
}

function json404(response: Response, message: string): void {
  response.status(404).json({ error: message });
}

function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("/") : (value ?? "");
}

function assetPathFromOriginalUrl(originalUrl: string, runId: string): string {
  const marker = `/api/runs/${runId}/assets/`;
  const markerIndex = originalUrl.indexOf(marker);
  if (markerIndex < 0) {
    return "";
  }

  try {
    return decodeURIComponent(originalUrl.slice(markerIndex + marker.length).split("?")[0] ?? "");
  } catch {
    return "";
  }
}

function isAllowedAsset(assetPath: string): boolean {
  return (
    !assetPath.startsWith("../") &&
    (assetPath.startsWith("screenshots/") || assetPath.startsWith("dom/"))
  );
}

function isLocalRequest(request: Request): boolean {
  const address = request.socket.remoteAddress ?? "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.endsWith("127.0.0.1")
  );
}

function isAllowedCopilotRequest(request: Request): boolean {
  if (request.get("x-driftradar-client") !== "dashboard") {
    return false;
  }

  const candidates = [request.headers.origin, request.headers.referer].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  if (candidates.length === 0) {
    return true;
  }

  return candidates.some((value) => {
    try {
      const url = new URL(value);
      const configuredOrigins = allowedDashboardOrigins();
      return configuredOrigins
        ? configuredOrigins.has(url.origin)
        : url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  });
}

function allowedDashboardOrigins(): Set<string> | undefined {
  const configured = process.env.DRIFTRADAR_DASHBOARD_ORIGIN?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : undefined;
}
