/* global console, process, URL */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve("sample-app");
const port = Number(process.env.PORT ?? 4173);

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

server.listen(port, "127.0.0.1", () => {
  console.log(`Sample app ready: http://127.0.0.1:${port}`);
});

function contentType(path) {
  if (extname(path) === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extname(path) === ".html") {
    return "text/html; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}
