/* global console, process */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = ".driftradar/runs";
const tsx = process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
const runs = await Promise.all(
  entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const manifest = JSON.parse(await readFile(join(root, entry.name, "manifest.json"), "utf8"));
      return { runId: entry.name, createdAt: manifest.createdAt };
    })
);

const latest = runs.sort((left, right) =>
  String(right.createdAt).localeCompare(String(left.createdAt))
)[0];
if (!latest) {
  console.error("No DriftRadar runs found. Run pnpm demo:backend first.");
  process.exit(1);
}

const child = spawn(tsx, ["src/cli/index.ts", "serve", "--run", latest.runId, "--port", "4317"], {
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => process.exit(code ?? 0));
