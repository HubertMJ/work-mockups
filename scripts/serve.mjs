// Serves dist/ on http://127.0.0.1:4173 for local viewing and the e2e tests. Static files only; the
// pages live at /work/vllm/, /work/bridge/ and /work/flota/. It answers like nginx.conf: /work/ itself
// redirects to the landing page's projects (302 /#projects), /healthz says ok, and every other path
// (the landing page, /cluster/, /lab/) belongs to other images on the same origin and is a 404 here.
// Every response carries the headers in security-headers.conf, the CSP with Trusted Types included, so
// the e2e tests run under the policy nginx serves.
//
//   node scripts/serve.mjs [--dir dist] [--port 4173] (the e2e tests use 4290)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const dir = resolve(arg("--dir", "dist"));
const port = Number(arg("--port", "4173"));

// Test-only stand-in for the landing page (/), which another image serves on this origin. The e2e
// tests follow the pages' links home; with --e2e this server answers / with a minimal page instead of a
// 404. Never on for `npm run serve`; nginx (the image) still 404s it.
const standins = process.argv.includes("--e2e") ? new Set(["/"]) : null;
const standinBody = () =>
  `<!DOCTYPE html><html lang="en"><head><title>stand-in</title></head><body><main><section id="projects">stand-in for the landing page</section></main></body></html>`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".json": "application/json", ".woff2": "font/woff2" };

const HEADERS = Object.fromEntries(
  [...readFileSync(new URL("../security-headers.conf", import.meta.url), "utf8").matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)].map((m) => [m[1], m[2]]),
);

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname));
  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }
  if (path === "/work" || path === "/work/") {
    res.writeHead(302, { ...HEADERS, location: "/#projects", "content-type": "text/plain" });
    res.end("see /#projects\n");
    return;
  }
  if (path.endsWith("/")) path += "index.html";
  const file = join(dir, path);
  try {
    if (!path.startsWith("/work/") || !file.startsWith(dir) || !(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    const base = path.endsWith("/index.html") ? path.slice(0, -"index.html".length) : path;
    if (standins?.has(base)) {
      res.writeHead(200, { ...HEADERS, "content-type": TYPES[".html"] });
      res.end(standinBody());
      return;
    }
    res.writeHead(404, { ...HEADERS, "content-type": "text/plain" });
    res.end("not found\n");
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
