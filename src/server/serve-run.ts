import { createDashboardApp } from "./server.js";

const runId = process.argv[2];
const port = Number(process.argv[3] ?? "4317");

if (!runId) {
  throw new Error("Usage: tsx src/server/serve-run.ts <runId> [port]");
}

const app = createDashboardApp({ selectedRunId: runId });
const server = app.listen(port, () => {
  console.log(`DriftRadar API ready: http://localhost:${port}`);
});
const keepAlive = setInterval(() => undefined, 2 ** 31 - 1);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive);
    server.close(() => process.exit(0));
  });
}
