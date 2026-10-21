// Builds src/ into dist/: content-hashed JS and CSS under dist/work/assets/, the three pages with the
// hashed names and the architecture drawings substituted, and static/ copied in beside them.
// Everything this image serves lives under the /work/ prefix (dist/work/...), so it never collides with
// the landing site on the same origin: the Gateway routes /work/ here. The hashed names let nginx serve
// /work/assets/* as immutable for a year while the pages are revalidated on every visit.
//
//   node scripts/build.mjs                  into dist/
//   node scripts/build.mjs --outdir <dir>   into <dir> instead (relative to the repository root)

import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--outdir");
const out = resolve(root, i > 0 ? process.argv[i + 1] : "dist");

/** The pages this image serves, under the /work/ prefix. */
const PAGES = [
  { src: "src/vllm.html", out: "work/vllm/index.html" },
  { src: "src/bridge.html", out: "work/bridge/index.html" },
  { src: "src/flota.html", out: "work/flota/index.html" },
];

/** src/diagram/work.ts's exports: bundled in memory and imported, so the pages and this script share the one model. */
async function loadDiagrams() {
  const r = await esbuild.build({ absWorkingDir: root, entryPoints: ["src/diagram/work.ts"], bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "warning" });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
}

const diagrams = await loadDiagrams();

/** styles.css's `@import "work-traffic.css"`: the drawings' traffic (routes and timing), generated. */
const trafficPlugin = {
  name: "work-traffic",
  setup(build) {
    build.onResolve({ filter: /^work-traffic\.css$/ }, () => ({ path: "work-traffic.css", namespace: "diagram" }));
    build.onLoad({ filter: /.*/, namespace: "diagram" }, () => ({ contents: diagrams.trafficCss(), loader: "css" }));
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "work", "assets"), { recursive: true });

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/work.ts", "src/vllm-demo.ts", "src/theme.ts", "src/styles.css"],
  outdir: join(out, "work", "assets"),
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022", "chrome110", "firefox110", "safari16"],
  metafile: true,
  legalComments: "none",
  // ASCII mode's font (src/ascii/fonts), emitted beside the CSS with a content hash like the rest.
  loader: { ".woff2": "file" },
  assetNames: "[name]-[hash]",
  logLevel: "warning",
  plugins: [trafficPlugin],
});

// The architecture drawings go into the pages as inline SVG, so they are there before any script runs
// and never shift the layout.
const names = { ...diagrams.workSvgs() };
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (!meta.entryPoint) continue;
  const ext = file.endsWith(".css") ? "css" : "js";
  names[`${basename(meta.entryPoint).replace(/\.(ts|css)$/, "")}.${ext}`] = basename(file);
}
for (const p of PAGES) {
  const html = (await readFile(join(root, p.src), "utf8")).replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
    if (!names[key]) throw new Error(`${p.src} references {{${key}}} but no such entry was built`);
    return names[key];
  });
  await mkdir(dirname(join(out, p.out)), { recursive: true });
  await writeFile(join(out, p.out), html);
}
// Served under /work/ too (favicon at /work/favicon.svg), so the image is self-contained behind the prefix.
await cp(join(root, "static"), join(out, "work"), { recursive: true });
console.log(`built: ${Object.entries(names).filter(([k]) => !k.startsWith("diagram.")).map(([, v]) => v).join(", ")}`);
