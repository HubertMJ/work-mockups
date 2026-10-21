import { expect, test, type Page } from "@playwright/test";

// The /work/ pages' architecture drawings (src/diagram/work.ts), held to the same rules as "The way in"
// on the landing page: every word inside its box (10 units clear of the box's sides) and clear of the
// boxes it is not in, no arrow through a box, edge labels clear of each other and of the lines, every
// node a g[data-node] with a rect and a data-tip, and nothing wider than the page. Each drawing is
// checked at a phone width and at a desktop one, so both its narrow and its wide variant are measured.

const PAGES: { path: string; id: string; open?: boolean; first: string; tip: string }[] = [
  { path: "/work/vllm/", id: "vllm", open: true, first: "Gateway", tip: "Routes by the model's alias" },
  { path: "/work/bridge/", id: "bridge", first: "Webhook", tip: "Only signed deliveries count" },
  { path: "/work/flota/", id: "flota", first: "Merger", tip: "One session merges" },
];

const openAbout = async (page: Page) => {
  await page.locator("#vd-about-open").click();
  await expect(page.getByRole("dialog", { name: "About this mock-up" })).toBeVisible();
};

function problems(page: Page, id: string): Promise<string[]> {
  return page.evaluate((id) => {
    const out: string[] = [];
    const shown = [...document.querySelectorAll<SVGSVGElement>(`svg.wd-map[data-diagram="${id}"]`)].filter((s) => getComputedStyle(s).display !== "none");
    if (shown.length !== 1) out.push(`${shown.length} drawings shown`);
    for (const svg of shown) {
      const view = svg.classList.contains("wd-map--wide") ? "wide" : "narrow";
      const nodes = [...svg.querySelectorAll("[data-node]")];
      for (const n of nodes) {
        if (!n.getAttribute("data-tip")) out.push(`${view}: ${n.getAttribute("data-node")} has no data-tip`);
        if (!n.querySelector("rect") || n.querySelectorAll("text").length < 2) out.push(`${view}: ${n.getAttribute("data-node")} lacks its rect or words`);
      }
      if (svg.querySelector("g[data-node] g[data-node]")) out.push(`${view}: a node inside a node`);
      const rects = nodes.map((n) => (n.querySelector("rect") as SVGRectElement).getBBox());
      for (const t of svg.querySelectorAll<SVGTextElement>("text")) {
        const b = t.getBBox();
        for (const r of rects) {
          const inside = b.x >= r.x && b.x + b.width <= r.x + r.width && b.y >= r.y && b.y + b.height <= r.y + r.height;
          const overlaps = b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
          if (overlaps && !inside) out.push(`${view}: "${t.textContent}" crosses a box`);
          if (inside && /em-label|em-sub/.test(t.getAttribute("class") ?? "") && Math.min(b.x - r.x, r.x + r.width - b.x - b.width) < 10) out.push(`${view}: "${t.textContent}" is under 10 from its box's edge`);
        }
      }
      const edges = [...svg.querySelectorAll<SVGPathElement>(".em-edge")];
      for (const e of edges) {
        const d = e.getAttribute("d") ?? "";
        if (!/^M[\d. ]+( L[\d. ]+)+$/.test(d)) out.push(`${view}: an edge that is not M/L only: ${d}`);
        const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] && pts[i][1] !== pts[i - 1][1]) out.push(`${view}: a diagonal edge: ${d}`);
        for (let l = 0; l <= e.getTotalLength(); l += 2) {
          const p = e.getPointAtLength(l);
          if (rects.some((r) => p.x > r.x + 1 && p.x < r.x + r.width - 1 && p.y > r.y + 1 && p.y < r.y + r.height - 1)) {
            out.push(`${view}: an arrow runs through a box at ${Math.round(p.x)},${Math.round(p.y)}`);
            break;
          }
        }
      }
      // Edge labels and zone titles alike: clear of each other and of every line.
      const labels = [...svg.querySelectorAll<SVGTextElement>(".em-edge-label, .em-zone-title")].map((t) => [t.textContent, t.getBBox()] as const);
      for (const [i, [a, ba]] of labels.entries()) {
        for (const [bName, bb] of labels.slice(i + 1)) if (ba.x < bb.x + bb.width && ba.x + ba.width > bb.x && ba.y < bb.y + bb.height && ba.y + ba.height > bb.y) out.push(`${view}: "${a}" overlaps "${bName}"`);
        for (const e of edges) {
          for (let l = 0; l <= e.getTotalLength(); l += 2) {
            const p = e.getPointAtLength(l);
            if (p.x > ba.x && p.x < ba.x + ba.width && p.y > ba.y && p.y < ba.y + ba.height) {
              out.push(`${view}: "${a}" sits on a line`);
              break;
            }
          }
        }
        const [vx, , vw] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
        if (ba.x < vx || ba.x + ba.width > vx + vw) out.push(`${view}: "${a}" runs out of the drawing`);
      }
      const r = svg.getBoundingClientRect();
      if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`${view}: the drawing is wider than the page`);
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push("horizontal scroll");
    return out;
  }, id);
}

for (const p of PAGES) {
  test(`the ${p.id} architecture drawing keeps the diagram rules, narrow and wide`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(p.path);
      if (p.open) await openAbout(page);
      expect(await problems(page, p.id), `${p.id} at ${width}`).toEqual([]);
    }
    // The mock-up's own charts stay charts: the drawing is in the About drawer, not in the app.
    if (p.id === "vllm") expect(await page.locator("#vdemo [data-node]").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`the ${p.id} drawing is redrawn in ASCII mode, with a box's words popping up beside it`, async ({ page }) => {
    await page.goto(`${p.path}?ascii=1`);
    await expect(page.locator("html")).toHaveClass(/ascii/);
    if (p.open) await openAbout(page);
    const dg = page.locator("pre.ascii-dg:not([hidden])");
    await expect(dg).toHaveCount(1);
    await expect(dg).toContainText(p.first);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (test.info().project.name !== "desktop") return;
    await dg.evaluate((pre) => pre.scrollIntoView({ block: "center", behavior: "instant" }));
    const at = await dg.evaluate((pre, word) => {
      const lines = (pre.textContent ?? "").split("\n");
      const r = lines.findIndex((l) => l.includes(word));
      const c = lines[r].indexOf(word) + 2;
      const rect = pre.getBoundingClientRect();
      return { x: rect.left + ((c + 0.5) / [...lines[0]].length) * rect.width, y: rect.top + ((r + 0.5) / (lines.length - 1)) * rect.height };
    }, p.first);
    await page.mouse.move(at.x, at.y);
    const tip = page.locator(".ascii-tip:not([hidden])");
    await expect(tip).toContainText(p.tip);
    // Seen, not just present: a modal dialog (the About drawer) sits above the page, so a popup for a
    // drawing in it has to be in it too.
    expect(await tip.evaluate((t) => !document.querySelector("dialog[open]") || !!t.closest("dialog[open]"))).toBe(true);
  });
}

// The traffic: a dot runs each route in turn, as on the landing page. It moves by transform, so the page
// never moves with it; with reduced motion nothing of it is drawn; in ASCII mode the drawing's own
// packets take over.
for (const p of PAGES) {
  test(`the ${p.id} drawing's traffic runs, and the page stays still`, async ({ page }) => {
    await page.goto(p.path);
    if (p.open) await openAbout(page);
    const shown = page.locator(`svg.wd-map[data-diagram="${p.id}"]:visible`);
    const state = () =>
      shown.evaluate((svg) => {
        const dots = [...svg.querySelectorAll<SVGCircleElement>(".wd-dot")];
        return { dots: dots.length, drawn: dots.every((d) => getComputedStyle(d).display !== "none"), running: dots.every((d) => d.getAnimations().some((a) => a.playState === "running")), time: Number(dots[0].getAnimations()[0]?.currentTime ?? 0) };
      });
    const before = await state();
    expect(before.dots).toBeGreaterThan(0);
    expect(before).toMatchObject({ drawn: true, running: true });
    const still = () => page.evaluate(() => [document.documentElement.scrollHeight, scrollY, document.querySelector(".vd-about")?.scrollHeight ?? 0]);
    const at0 = await still();
    await page.waitForTimeout(800);
    expect((await state()).time).toBeGreaterThan(before.time);
    expect(await still()).toEqual(at0);
  });
}

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("no drawing's traffic is drawn", async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(p.path);
      if (p.open) await openAbout(page);
      expect(await page.locator(".wd-dot, .wd-glow, .wd-halo").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length), p.id).toBe(0);
    }
  });
});

test("in ASCII mode the SVG's dots stay off: the character drawing runs its own packets", async ({ page }) => {
  await page.goto("/work/bridge/?ascii=1");
  await expect(page.locator("pre.ascii-dg:not([hidden])")).toHaveCount(1);
  expect(await page.locator(".wd-dot").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length)).toBe(0);
});
