/* global console, process */

import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const pnpm = process.env.PNPM_EXECUTABLE ?? ".venv/node_modules/.bin/pnpm";
const checklist = [
  "1. pnpm demo:backend",
  "2. pnpm demo:serve",
  "3. pnpm --dir dashboard dev",
  "4. Open the dashboard and confirm fixture or live mode is visible.",
  "5. Filter to token misuse, open a screenshot-backed issue, and copy the suggested fix.",
  "6. Open Export and copy the PR comment.",
  "7. Optional: scan the fixed sample route and show the issue count dropping."
];

if (await exists("dashboard/package.json")) {
  const child = spawn((await exists(pnpm)) ? pnpm : "pnpm", ["--dir", "dashboard", "dev"], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
} else {
  console.log("Dashboard package is not merged yet. Demo checklist:");
  console.log(checklist.join("\n"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
