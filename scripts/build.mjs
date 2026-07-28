import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "dist", "server");
const browserBundle = join(root, "dist", "assets", "app.bundle.js");
const vendorBundle = join(root, "assets", "vendor.bundle.js");
const assetRoots = ["index.html", "offline.html", "manifest.json", "service-worker.js", "css", "assets"];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function collectFiles(path) {
  const entry = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entry) return [path];
  const nested = await Promise.all(entry.map((item) => {
    const itemPath = join(path, item.name);
    return item.isDirectory() ? collectFiles(itemPath) : [itemPath];
  }));
  return nested.flat();
}

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(join(root, "dist", "assets"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["./js/vendor-entry.js"],
  outfile: "./assets/vendor.bundle.js",
  bundle: true,
  format: "iife",
  minify: true,
  target: ["es2022"],
});
await build({
  absWorkingDir: root,
  entryPoints: ["./js/app.js"],
  outfile: "./dist/assets/app.bundle.js",
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
});
await mkdir(outputDirectory, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["./server/api.js"],
  outfile: "./dist/server/api.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: ["es2022"],
});

const files = (await Promise.all(assetRoots.map((path) => collectFiles(join(root, path))))).flat();
files.push(browserBundle);
const assets = {};

for (const file of files.sort()) {
  const key = file === browserBundle
    ? "app.bundle.js"
    : relative(root, file).split(sep).join("/");
  let body = await readFile(file);
  if (key === "index.html") {
    body = Buffer.from(body.toString("utf8").replace("./js/app.js", "./app.bundle.js"));
  }
  assets[key] = {
    type: MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    body: body.toString("base64"),
  };
}

const worker = `import { handleApiRequest } from "./api.js";

const ASSETS = ${JSON.stringify(assets)};

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function securityHeaders(env) {
  let connectSource = "'self'";
  try {
    connectSource += " " + new URL(env.SUPABASE_URL).origin;
  } catch {}
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src " + connectSource + "; worker-src 'self'; manifest-src 'self'; object-src 'none'; media-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "origin-agent-cluster": "?1",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, context);
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...securityHeaders(env), allow: "GET, HEAD" },
      });
    }

    let path = decodeURIComponent(url.pathname).replace(/^\\/+/, "");
    if (!path) path = "index.html";
    let asset = ASSETS[path];
    if (!asset && request.headers.get("accept")?.includes("text/html")) {
      asset = ASSETS["index.html"];
      path = "index.html";
    }
    if (!asset) return new Response("Not found", { status: 404, headers: securityHeaders(env) });

    const headers = new Headers({
      ...securityHeaders(env),
      "content-type": asset.type,
      "cache-control": path === "service-worker.js" || path === "index.html"
        ? "no-cache"
        : "public, max-age=3600",
    });
    return new Response(request.method === "HEAD" ? null : decode(asset.body), {
      status: 200,
      headers,
    });
  },
};
`;

await writeFile(join(outputDirectory, "index.js"), worker);

console.log(`Built ${Object.keys(assets).length} assets into dist/server.`);
