import { type Server } from "node:http";
import { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardApp } from "./server.js";

describe("dashboard API", () => {
  let server: Server;
  let baseUrl: string;
  let mutationToken: string;

  beforeEach(async () => {
    const app = createDashboardApp({ outputDir: "fixtures/api-runs", selectedRunId: "demo-run" });
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    mutationToken = ((await fetch(`${baseUrl}/api/health`).then((response) =>
      response.json()
    )) as { mutationToken: string }).mutationToken;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm("fixtures/api-runs/runs/demo-run/style-propagation.json", { force: true });
  });

  it("serves health, runs, report, issues, assets, and markdown export", async () => {
    const health = (await getJson("/api/health")) as { status: string; version: string; mutationToken: string };
    expect(health.status).toBe("ok");
    expect(health.version).toBe("0.1.0");
    expect(health.mutationToken).toBeTruthy();

    const runs = (await getJson("/api/runs")) as { runs: { runId: string }[] };
    expect(runs.runs[0].runId).toBe("demo-run");

    const report = (await getJson("/api/runs/demo-run/report")) as { runId: string };
    expect(report.runId).toBe("demo-run");

    const issues = (await getJson("/api/runs/demo-run/issues")) as {
      summary: { totalIssues: number };
      issues: { id: string }[];
    };
    expect(issues.summary.totalIssues).toBe(1);
    expect(issues.issues[0].id).toBe("issue-token-color");

    const issue = (await getJson("/api/runs/demo-run/issues/issue-token-color")) as {
      suggestedFix: { cssAfter: string };
    };
    expect(issue.suggestedFix.cssAfter).toBe("color: var(--color-primary-600);");

    const asset = await fetch(
      `${baseUrl}/api/runs/demo-run/assets/screenshots/home/desktop/default.png`
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("image/png");
    expect([...new Uint8Array(await asset.arrayBuffer()).slice(0, 4)]).toEqual([137, 80, 78, 71]);

    const privateFile = await fetch(`${baseUrl}/api/runs/demo-run/assets/report.json`);
    expect(privateFile.status).toBe(404);

    const exportResponse = await fetch(`${baseUrl}/api/runs/demo-run/export/pr-comments`);
    expect(exportResponse.headers.get("content-type")).toContain("text/markdown");
    expect(await exportResponse.text()).toContain("Replace #1e64d8");
  });

  it("returns JSON 404s for missing runs and issues", async () => {
    await expectJson("/api/runs/missing/report", { error: "Run not found" }, 404);
    await expectJson("/api/runs/demo-run/issues/missing", { error: "Issue not found" }, 404);
  });

  it("returns issue names for a run", async () => {
    const response = await fetch(`${baseUrl}/api/runs/demo-run/issue-names`, {
      headers: { "X-DriftRadar-Client": "dashboard", "X-DriftRadar-Token": mutationToken }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { names: Record<string, string> };
    expect(body.names["issue-token-color"]).toBeTruthy();
  });

  it("reports project PR readiness", async () => {
    const response = await fetch(`${baseUrl}/api/runs/demo-run/project-readiness`, {
      headers: { "X-DriftRadar-Client": "dashboard", "X-DriftRadar-Token": mutationToken }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: string };
    expect(body.state).toBe("no_source");
  });

  it("reports style propagation status with dashboard auth", async () => {
    const forbidden = await fetch(`${baseUrl}/api/runs/demo-run/style-propagation`);
    expect(forbidden.status).toBe(403);

    const response = await fetch(
      `${baseUrl}/api/runs/demo-run/style-propagation?baseRef=definitely-missing-ref&headRef=definitely-missing-head`,
      {
        headers: { "X-DriftRadar-Client": "dashboard", "X-DriftRadar-Token": mutationToken }
      }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; summary: string };
    expect(body.status).toBe("no_git");
    expect(body.summary.length).toBeGreaterThan(0);
  });

  it("handles copilot requests", async () => {
    const forbidden = await fetch(`${baseUrl}/api/runs/demo-run/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "nope" })
    });
    expect(forbidden.status).toBe(403);

    const missingMessage = await fetch(`${baseUrl}/api/runs/demo-run/copilot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DriftRadar-Client": "dashboard",
        "X-DriftRadar-Token": mutationToken
      },
      body: JSON.stringify({})
    });
    expect(missingMessage.status).toBe(400);

    const response = await fetch(`${baseUrl}/api/runs/demo-run/copilot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DriftRadar-Client": "dashboard",
        "X-DriftRadar-Token": mutationToken
      },
      body: JSON.stringify({ message: "Summarize token misuse issues" })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reply: string };
    expect(body.reply.length).toBeGreaterThan(0);
  });

  it("serves assets for a run named assets", async () => {
    const asset = await fetch(
      `${baseUrl}/api/runs/assets/assets/screenshots/home/desktop/default.png`
    );

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("image/png");
  });

  async function getJson(path: string): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    return response.json();
  }

  async function expectJson(path: string, body: unknown, status = 200): Promise<void> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(body);
  }
});
