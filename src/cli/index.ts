#!/usr/bin/env node
import { Command } from "commander";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { validateConfigFile } from "../config/load-config.js";
import { serveDashboard } from "../server/server.js";
import { scanConfig, scanProject } from "./scan-pipeline.js";

const safeRunId = /^[A-Za-z0-9._-]+$/;

const program = new Command()
  .name("driftradar")
  .description("Local design-system drift scanner")
  .version("0.1.0");

program
  .command("validate")
  .requiredOption("--config <path>", "Path to driftradar.config.json")
  .description("Validate config, token files, URLs, and output folder writability")
  .action(async ({ config }: { config: string }) => {
    await validateConfigFile(config);
    console.log(`Config valid: ${config}`);
  });

program
  .command("scan")
  .option("--config <path>", "Path to driftradar.config.json")
  .option("--project <path>", "Project folder to inspect and scan with Codex")
  .description("Run the local scan pipeline")
  .action(async ({ config, project }: { config?: string; project?: string }) => {
    if (Boolean(config) === Boolean(project)) {
      throw new Error("Provide exactly one of --config or --project.");
    }

    const reportPath = config ? await scanConfig(config) : await scanProject(project!);
    console.log(`Report ready: ${reportPath}`);
  });

program
  .command("serve")
  .requiredOption("--run <runId>", "Run ID under .driftradar/runs")
  .option("--port <port>", "Port to listen on", "4317")
  .option("--output-dir <path>", "Output directory containing runs", ".driftradar")
  .description("Serve a local read-only dashboard API")
  .action(async ({ port, run, outputDir }: { port: string; run: string; outputDir: string }) => {
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      throw new Error(`Invalid port: ${port}`);
    }

    if (!isSafeRunId(run)) {
      throw new Error(`Invalid run ID: ${run}`);
    }

    try {
      await access(join(outputDir, "runs", run, "report.json"));
    } catch (error) {
      throw new Error(`Run not found: ${run}`, { cause: error });
    }

    await serveDashboard({ outputDir, port: parsedPort, selectedRunId: run });
  });

program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  if (typeof error === "object" && error !== null && "exitCode" in error) {
    process.exit(Number(error.exitCode));
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function isSafeRunId(runId: string): boolean {
  return safeRunId.test(runId) && runId !== "." && runId !== "..";
}
