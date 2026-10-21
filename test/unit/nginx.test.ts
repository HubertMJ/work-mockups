import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// nginx.conf as text: what the image answers where the local server (scripts/serve.mjs) cannot stand in
// for nginx itself. The e2e tests check the same answers against serve.mjs.

const root = join(__dirname, "..", "..");
// Comments only: a # after whitespace or at a line start (the # in /#projects is not one).
const conf = readFileSync(join(root, "nginx.conf"), "utf8").replace(/(^|\s)#.*$/gm, "$1");
const location = (match: string): string => {
  const i = conf.indexOf(`location ${match} {`);
  expect(i, `location ${match}`).toBeGreaterThan(-1);
  return conf.slice(i, conf.indexOf("}", i));
};

describe("nginx.conf", () => {
  test("/work/ redirects to the landing page's projects and /work to /work/, as paths (no :8080 in Location)", () => {
    expect(conf).toMatch(/^\s*absolute_redirect off;/m);
    expect(location("= /work/")).toMatch(/return 302 \/#projects;/);
    expect(location("= /work")).toMatch(/return 301 \/work\/;/);
  });

  test("hashed assets are immutable, pages revalidate, /healthz answers and the rest is not this image's", () => {
    expect(location("^~ /work/assets/")).toContain("$asset_cache_control");
    expect(location("^~ /work/")).toContain("$page_cache_control");
    expect(location("= /healthz")).toMatch(/return 200 "ok\\n";/);
    expect(location("/")).toMatch(/return 404;/);
    expect(conf).toMatch(/listen 8080;/);
    expect(conf).toMatch(/pid \/tmp\/nginx\.pid;/);
  });

  test("the redirect's target exists: the site's landing page names its Projects section #projects", () => {
    // The landing page is another repository's; its section id is what /#projects lands on. This repo's
    // own pages link to it the same way.
    for (const page of ["vllm", "bridge", "flota"]) expect(readFileSync(join(root, "src", `${page}.html`), "utf8"), page).toContain('href="/#projects"');
  });
});

// The live-check script on the cluster side finds each page by the start of its title.
test("the pages' titles keep the words a live check looks for", () => {
  const title = (page: string) => readFileSync(join(root, "src", `${page}.html`), "utf8").match(/<title>[^<]*/)?.[0];
  expect(title("vllm")).toMatch(/^<title>vLLM Deployment Manager/);
  expect(title("bridge")).toMatch(/^<title>Git forge/);
  expect(title("flota")).toMatch(/^<title>Flota/);
});
