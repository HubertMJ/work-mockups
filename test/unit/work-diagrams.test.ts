import { describe, expect, test } from "vitest";
import { lanes, ROUTES, trafficCss, WORK_DIAGRAMS, workSvgs } from "../../src/diagram/work";

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
  const all = workSvgs();
  const svgs = Object.fromEntries(Object.entries(all).filter(([k]) => !k.endsWith(".panel")));
  expect(Object.keys(svgs).sort()).toEqual(["diagram.bridge.narrow", "diagram.bridge.wide", "diagram.flota.narrow", "diagram.flota.wide", "diagram.vllm.narrow"]);
  // Under each drawing, the node panel: an entry for every box, with what its ASCII popup says.
  for (const d of WORK_DIAGRAMS) {
    const doc = new DOMParser().parseFromString(all[`diagram.${d.id}.panel`], "text/html");
    for (const n of d.nodes) expect(doc.querySelector(`.np-item[data-for="${n.id}"] .np-text`)?.textContent, `${d.id} ${n.id}`).toBe(n.tip);
  }
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

describe("the drawings' traffic", () => {
  test("every route resolves along drawn edges in every wide drawing and in the vLLM drawer's", () => {
    for (const d of WORK_DIAGRAMS) {
      const full = d.layouts.find((l) => l.view === "wide") ?? d.layouts[0];
      const { lanes: ls } = lanes(full, ROUTES[d.id]);
      expect(ls.map((l) => l.route), d.id).toEqual(ROUTES[d.id]);
    }
    // The phone drawings keep at least their main route.
    for (const d of WORK_DIAGRAMS) for (const l of d.layouts) expect(lanes(l, ROUTES[d.id]).lanes[0]?.route, `${d.id} ${l.view}`).toEqual(ROUTES[d.id][0]);
  });

  test("a dot starts in its first box, ends in its last, and its legs and boxes come in order", () => {
    for (const d of WORK_DIAGRAMS)
      for (const lay of d.layouts) {
        const { lanes: ls, period } = lanes(lay, lay.routes ?? ROUTES[d.id]);
        expect(period).toBeGreaterThan(0);
        let end = 0;
        for (const l of ls) {
          const first = lay.boxes[l.route[0]];
          const last = lay.boxes[l.route[l.route.length - 1]];
          expect(l.path[0]).toEqual([first.x + first.w / 2, first.y + first.h / 2]);
          expect(l.path[l.path.length - 1]).toEqual([last.x + last.w / 2, last.y + last.h / 2]);
          const flat = l.spans.flat();
          expect(flat.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= flat[i - 1])), `${d.id} ${lay.view} ${l.route}`).toBe(true);
          expect(l.reach.every((f, i) => i === 0 || f > l.reach[i - 1])).toBe(true);
          // One route after another: none overlaps the one before it, all inside one round.
          expect(l.start).toBeGreaterThanOrEqual(end);
          end = l.start + l.travel;
        }
        expect(end).toBeLessThanOrEqual(period);
      }
  });

  test("every moving part has its rule, and none of it is a node or an edge (ASCII mode reads those)", () => {
    const css = trafficCss();
    for (const [k, s] of Object.entries(workSvgs()).filter(([key]) => !key.endsWith(".panel"))) {
      const doc = new DOMParser().parseFromString(s, "image/svg+xml");
      const parts = [...doc.querySelectorAll(".wd-traffic [id]")];
      expect(parts.length, k).toBeGreaterThan(3);
      for (const el of parts) expect(css, `${k} #${el.id}`).toContain(`#${el.id} {`);
      expect(doc.querySelector(".wd-traffic [data-node], .wd-traffic .em-edge"), k).toBeNull();
      // Under the boxes: a dot sinks into a box and comes out the other side.
      const order = [...doc.querySelector("svg")!.children].map((c) => c.getAttribute("class") ?? c.tagName);
      expect(order.indexOf("wd-traffic"), k).toBeLessThan(order.findIndex((c) => /em-node/.test(c)));
    }
  });
});
