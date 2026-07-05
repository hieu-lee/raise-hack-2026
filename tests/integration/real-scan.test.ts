import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reportSchema } from "../../src/contracts/schemas.js";

const tsx = process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

describe("real capture mode", () => {
  it("scans a live route with Playwright, real token analysis, and drift classification", async () => {
    const sample = await startSampleServer();
    const temp = await mkdtemp(join(tmpdir(), "driftradar-real-scan-"));
    cleanup.push(() => rm(temp, { force: true, recursive: true }));
    cleanup.push(() => closeServer(sample.server));

    const configPath = join(temp, "driftradar.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        projectName: "Real capture smoke test",
        baseUrl: sample.baseUrl,
        routes: [{ id: "buttons", url: "/buttons.html" }],
        tokenFiles: [resolve("sample-app/tokens.css")],
        outputDir: temp,
        viewports: [{ name: "desktop", width: 1440, height: 900 }],
        states: ["default"],
        captureMode: "real"
      })
    );

    const scan = await runCli("scan", "--config", configPath);
    const reportPath = scan.stdout.match(/Report ready: (.+report\.json)/)?.[1];
    expect(reportPath).toBeTruthy();

    const report = reportSchema.parse(JSON.parse(await readFile(String(reportPath), "utf8")));

    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]).toMatchObject({ routeId: "buttons", state: "default" });
    expect(report.pages[0].browser.name).toBe("chromium");

    const runDir = resolve(temp, "runs", report.runId);
    const screenshotStat = await stat(join(runDir, report.pages[0].screenshotPath));
    // Real Playwright full-page screenshots are meaningfully larger than the ~1KB synthetic
    // demo PNGs, which are fixed 480x360 solid-color rectangles.
    expect(screenshotStat.size).toBeGreaterThan(2_000);

    expect(
      await stat(join(runDir, "observations.jsonl")).then((entry) => entry.size)
    ).toBeGreaterThan(0);

    // The sample app's buttons.html literally uses `background: #1f6fe5;`, an off-token blue
    // that should not exactly match sample-app/tokens.css's `--color-primary-600`.
    const colorIssue = report.issues.find(
      (issue) => issue.property === "color" && issue.observedValue.includes("#1f6fe5")
    );
    expect(colorIssue).toBeTruthy();
  }, 30000);
});

function writeFile(path: string, contents: string): Promise<void> {
  return import("node:fs/promises").then(({ writeFile: write }) => write(path, contents));
}

function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(tsx, ["src/cli/index.ts", ...args], { cwd: process.cwd() });
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

function contentType(filePath: string): string {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  return "application/octet-stream";
}
