import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { reportSchema } from "../../src/contracts/schemas.js";

const tsx = process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

describe("Dev 6 backend handoff", () => {
  it("runs validate, scan, and serve against the sample app", async () => {
    const sample = await startSampleServer();
    const temp = await mkdtemp(join(tmpdir(), "driftradar-dev6-"));
    cleanup.push(() => rm(temp, { force: true, recursive: true }));
    cleanup.push(() => closeServer(sample.server));

    const configPath = await writeConfig(temp, sample.baseUrl, [
      { id: "overview", url: "/" },
      { id: "buttons", url: "/buttons.html" },
      { id: "cards", url: "/cards.html" },
      { id: "forms", url: "/forms.html" },
      { id: "dark", url: "/dark.html" }
    ]);

    await runCli("validate", "--config", configPath);
    const scan = await runCli("scan", "--config", configPath);
    const reportPath = scan.stdout.match(/Report ready: (.+report\.json)/)?.[1];
    expect(reportPath).toBeTruthy();

    const report = reportSchema.parse(JSON.parse(await readFile(String(reportPath), "utf8")));
    expect(report.summary.totalIssues).toBe(4);
    expect(report.summary.countsByCategory).toMatchObject({
      token_misuse: 1,
      new_pattern_candidate: 1,
      accidental_regression: 1,
      acceptable_exception: 1
    });
    expect(report.pages).toHaveLength(50);
    expect(report.issues.find((issue) => issue.category === "accidental_regression")?.state).toBe(
      "focus"
    );
    expect(
      report.issues.find((issue) => issue.category === "token_misuse")?.suggestedFix.cssBefore
    ).toBe("background: #1f6fe5;");
    expect(
      report.issues.find((issue) => issue.category === "accidental_regression")?.suggestedFix
        .cssBefore
    ).toBe("outline-color: #ff4d4f;");

    const runDir = join(temp, "runs", report.runId);
    const observations = (await readFile(join(runDir, "observations.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(observations).toHaveLength(report.pages.length);
    await expect(stat(join(runDir, report.pages[0].screenshotPath))).resolves.toBeTruthy();
    const screenshot = PNG.sync.read(
      await readFile(join(runDir, report.issues[0].evidence.screenshotPath))
    );
    const cropBox = report.issues[0].evidence.cropBox;
    expect(cropBox).toBeTruthy();
    expect(cropBox!.x + cropBox!.width).toBeLessThanOrEqual(screenshot.width);
    expect(cropBox!.y + cropBox!.height).toBeLessThanOrEqual(screenshot.height);

    const apiPort = await freePort();
    const serve = spawn(tsx, [
      "src/cli/index.ts",
      "serve",
      "--run",
      report.runId,
      "--port",
      String(apiPort),
      "--output-dir",
      temp
    ]);
    cleanup.push(() => serve.kill());
    await waitForJson(`http://127.0.0.1:${apiPort}/api/health`);
    const health = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");

    const servedReport = await waitForJson(
      `http://127.0.0.1:${apiPort}/api/runs/${report.runId}/report`
    );
    expect(reportSchema.parse(servedReport).summary.totalIssues).toBe(4);
    const secondScan = await reportFromScan(await runCli("scan", "--config", configPath));
    expect(secondScan.runId).not.toBe(report.runId);
    const servedSecondReport = await waitForJson(
      `http://127.0.0.1:${apiPort}/api/runs/${secondScan.runId}/report`
    );
    expect(reportSchema.parse(servedSecondReport).runId).toBe(secondScan.runId);
    const issue = await waitForJson(
      `http://127.0.0.1:${apiPort}/api/runs/${report.runId}/issues/${report.issues[0].id}`
    );
    expect(reportSchema.shape.issues.element.parse(issue).id).toBe(report.issues[0].id);
  }, 30000);

  it("shows fewer issues for the fixed sample route", async () => {
    const sample = await startSampleServer();
    const temp = await mkdtemp(join(tmpdir(), "driftradar-dev6-"));
    cleanup.push(() => rm(temp, { force: true, recursive: true }));
    cleanup.push(() => closeServer(sample.server));

    const driftConfig = await writeConfig(temp, sample.baseUrl, [
      { id: "buttons", url: "/buttons.html" },
      { id: "cards", url: "/cards.html" },
      { id: "forms", url: "/forms.html" },
      { id: "dark", url: "/dark.html" }
    ]);
    const fixedConfig = await writeConfig(
      temp,
      sample.baseUrl,
      [{ id: "fixed", url: "/fixed.html" }],
      "fixed"
    );

    const driftReport = await reportFromScan(await runCli("scan", "--config", driftConfig));
    const secondDriftReport = await reportFromScan(await runCli("scan", "--config", driftConfig));
    const fixedReport = await reportFromScan(await runCli("scan", "--config", fixedConfig));

    expect(secondDriftReport.runId).not.toBe(driftReport.runId);
    expect(fixedReport.summary.totalIssues).toBeLessThan(driftReport.summary.totalIssues);
  }, 30000);

  it("keeps the frontend handoff golden report contract-valid", async () => {
    const report = reportSchema.parse(
      JSON.parse(await readFile("fixtures/golden/report.json", "utf8"))
    );
    expect(report.runId).toBe("frontend-handoff-run");
    expect(report.issues[0]).toMatchObject({
      category: "token_misuse",
      status: "open"
    });
    expect(report.issues.find((issue) => issue.id === "issue-focus-ring")).toMatchObject({
      routeId: "forms",
      state: "focus"
    });
    expect(report.issues.find((issue) => issue.id === "issue-dark-exception")).toMatchObject({
      routeId: "dark",
      state: "dark"
    });
    const screenshot = PNG.sync.read(
      await readFile(
        "fixtures/golden/frontend-handoff-run/screenshots/overview/desktop/default.png"
      )
    );
    const cropBox = report.issues[0].evidence.cropBox!;
    expect(cropBox.x + cropBox.width).toBeLessThanOrEqual(screenshot.width);
    expect(cropBox.y + cropBox.height).toBeLessThanOrEqual(screenshot.height);
  });
});

async function reportFromScan(result: { stdout: string }) {
  const reportPath = result.stdout.match(/Report ready: (.+report\.json)/)?.[1];
  expect(reportPath).toBeTruthy();
  return reportSchema.parse(JSON.parse(await readFile(String(reportPath), "utf8")));
}

async function writeConfig(
  dir: string,
  baseUrl: string,
  routes: Array<{ id: string; url: string }>,
  name = "sample"
) {
  const configPath = join(dir, `${name}.json`);
  await writeFile(
    configPath,
    JSON.stringify(
      {
        projectName: `DriftRadar ${name}`,
        baseUrl,
        routes,
        tokenFiles: ["sample-app/tokens.css"],
        outputDir: dir,
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 390, height: 844 }
        ],
        states: ["default", "hover", "focus", "disabled", "dark"]
      },
      null,
      2
    )
  );
  return configPath;
}

function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(tsx, ["src/cli/index.ts", ...args], {
      cwd: process.cwd()
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
      } else {
        rejectRun(new Error(`CLI exited ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function startSampleServer(): Promise<{ server: Server; baseUrl: string }> {
  const root = resolve("sample-app");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = resolve(root, relativePath);

    if (!filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(404).end("not found");
      return;
    }

    try {
      response.writeHead(200, { "content-type": contentType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("sample server did not expose a port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  await closeServer(server);
  if (typeof address !== "object" || !address) {
    throw new Error("no free port");
  }
  return address.port;
}

async function waitForJson(url: string): Promise<unknown> {
  const deadline = Date.now() + 5000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError;
}

function contentType(path: string): string {
  if (extname(path) === ".css") {
    return "text/css; charset=utf-8";
  }
  return "text/html; charset=utf-8";
}
