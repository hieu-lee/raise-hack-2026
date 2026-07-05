/* global console, process */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local.mjs";

const root = ".driftradar/runs";
const port = 4317;
const tsx = process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";

await loadEnvLocal();

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

const child = spawn(tsx, ["src/server/serve-run.ts", latest.runId, String(port)], {
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => process.exit(code ?? 0));
