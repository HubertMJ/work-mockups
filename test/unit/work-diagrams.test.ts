import { describe, expect, test } from "vitest";
import { WORK_DIAGRAMS, workSvgs } from "../../src/diagram/work";

// The /work/ pages' drawings as data: what the build writes into the pages, and what ASCII mode reads.
// The measured rules (words inside boxes, lines clear of boxes and labels) are in test/e2e/work-diagrams.spec.ts.

describe.each(WORK_DIAGRAMS.map((d) => [d.id, d] as const))("the %s drawing", (_, d) => {
  test("every node has a box in every layout, inside the drawing, and a sentence for its popup", () => {
    for (const n of d.nodes) expect(n.tip.length, n.id).toBeGreaterThan(20);
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(d.nodes.length);
    for (const l of d.layouts) {
      expect(Object.keys(l.boxes).sort()).toEqual(d.nodes.map((n) => n.id).sort());
      for (const [id, b] of Object.entries(l.boxes)) expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height, `${l.view} ${id}`).toBe(true);
    }
  });

  test("every edge is orthogonal and stays inside the drawing", () => {
    for (const l of d.layouts)
      for (const e of l.edges) {
        for (let i = 1; i < e.pts.length; i++) expect(e.pts[i][0] === e.pts[i - 1][0] || e.pts[i][1] === e.pts[i - 1][1], `${l.view} ${e.label}`).toBe(true);
        for (const [x, y] of e.pts) expect(x >= 0 && y >= 0 && x <= l.width && y <= l.height).toBe(true);
      }
  });

  test("no box overlaps another", () => {
    for (const l of d.layouts) {
      const bs = Object.entries(l.boxes);
      for (const [i, [a, p]] of bs.entries())
        for (const [b, q] of bs.slice(i + 1)) expect(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y, `${l.view}: ${a} and ${b}`).toBe(false);
    }
  });
});

test("the markup: nodes are g[data-node] with a rect and a tip, edges are M/L paths, and no style attributes", () => {
  const svgs = workSvgs();
  expect(Object.keys(svgs).sort()).toEqual(["diagram.bridge.narrow", "diagram.bridge.wide", "diagram.flota.narrow", "diagram.flota.wide", "diagram.vllm.narrow"]);
  for (const [k, s] of Object.entries(svgs)) {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    const nodes = [...doc.querySelectorAll("g[data-node]")];
    expect(nodes.length, k).toBeGreaterThan(5);
    for (const n of nodes) {
      expect(n.querySelector("rect"), k).not.toBeNull();
      expect(n.getAttribute("data-tip"), k).toBeTruthy();
    }
    for (const p of doc.querySelectorAll("path.em-edge")) expect(p.getAttribute("d"), k).toMatch(/^M[\d. ]+( L[\d. ]+)+$/);
    expect(s, k).not.toMatch(/ style=/);
  }
});
