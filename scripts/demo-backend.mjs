/* global process, URL */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve("sample-app");
const port = 4173;
const tsx = process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = resolve(root, relativePath);

  if (!filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(404).end("not found");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, { "content-type": contentType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(port, "127.0.0.1", resolveListen);
});

try {
  await run("validate", "--config", "fixtures/sample-app/driftradar.config.json");
  await run("scan", "--config", "fixtures/sample-app/driftradar.config.json");
} finally {
  server.close();
}

function run(...args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(tsx, ["src/cli/index.ts", ...args], {
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`driftradar ${args[0]} exited ${code}`));
      }
    });
  });
}

function contentType(path) {
  if (extname(path) === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extname(path) === ".html") {
    return "text/html; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}
