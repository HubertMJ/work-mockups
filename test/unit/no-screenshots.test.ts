import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// These pages are mock-ups and descriptions written for this site: no screenshot of the real interface
// may ship, and no page may point at one. The only image this image serves is its favicon.

const root = join(__dirname, "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test("static/ holds no raster image, and nothing but the favicon", () => {
  expect(walk(join(root, "static")).map((p) => p.slice(join(root, "static").length + 1))).toEqual(["favicon.svg"]);
});

test("no page, script or stylesheet references a screenshot", () => {
  const files = walk(join(root, "src")).filter((p) => /\.(html|ts|css)$/.test(p));
  const hits = files.filter((p) => /\.(webp|png|jpe?g|gif|avif)\b/i.test(readFileSync(p, "utf8")));
  expect(hits).toEqual([]);
});
