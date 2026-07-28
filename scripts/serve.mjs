import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/u, "") || "index.html";
    let path = resolve(root, requested);
    if (relative(root, path).startsWith("..")) throw new Error("invalid_path");
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`FinTrack development server: http://127.0.0.1:${port}`);
});
