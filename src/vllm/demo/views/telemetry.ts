// Telemetry: the host, every card and every engine over the last 3 minutes (1 s samples) or the last
// 15 minutes or hour (15 s averages), driven by what runs in the demo. Everything is built once and
// patched in place (paths, texts, widths), so a sample never moves the page or takes focus. No
// g[data-node] here: these stay charts in ASCII mode too.

import { h, setText, svg } from "../../../lib/dom";
import { cacheUsedGiB, CACHE_VOLUME_GIB, HOST_RAM_GIB, HOST_THREADS, loadAvg, peak, POWER_LIMIT_W, RANGES, view, type Range } from "../metrics";
import { CARD_GIB, CEILING, clock, cardsText, int, isResident, ms, onCard } from "../model";
import type { Deployment, EngineSeries, Series, State } from "../types";
import { fill, region, select, type Ctx } from "../ui";
import { statusBadge } from "./common";

const W = 360;
const HT = 100;

interface Line {
  label: string;
  /** Picks the series this line draws from the State; undefined while there is none yet. */
  get: (s: State) => Series | undefined;
}

interface ChartOpts {
  title: string;
  fmt: (v: number) => string;
  lines: Line[];
  /** A fixed top of the scale; left out, the scale follows the data to a round number. */
  max?: number;
  /** The least top an automatic scale goes down to, so a quiet series does not fill the plot with noise. */
  floor?: number;
  mark?: number;
  /** The second line under the title: a peak, a limit, what a setting does. */
  sub?: (s: State) => string;
  context: string;
}

interface Chart {
  el: HTMLElement;
  paint(s: State, range: Range): void;
}

/** 1, 2 or 5 times a power of ten, at least `v`. */
function nice(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= v) ?? 10 * p;
}

function chart(o: ChartOpts): Chart {
  const multi = o.lines.length > 1;
  const value = h("span", { class: "vd-chart__value" });
  const sub = h("span", { class: "vd-chart__sub vd-faint" }, " ");
  const keys = o.lines.map((l, i) => {
    const v = h("span", { class: "vd-chart__keyval" }, "–");
    return { el: h("span", { class: `vd-chart__key vd-chart__key--${i}` }, h("span", { class: "vd-chart__swatch", "aria-hidden": "true" }), `${l.label} `, v), v };
  });
  const area = multi ? null : svg("path", { class: "vd-chart__area" });
  const paths = o.lines.map((_, i) => svg("path", { class: `vd-chart__line vd-chart__line--${multi ? i : "solo"}`, "vector-effect": "non-scaling-stroke" }));
  const cross = svg("line", { class: "vd-chart__cross", y1: 0, y2: HT, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
  const grid = [0, 0.5, 1].map((f) => svg("line", { class: "vd-chart__grid", x1: 0, x2: W, y1: HT * f, y2: HT * f, "vector-effect": "non-scaling-stroke" }));
  const markLine = svg("line", { class: "vd-chart__mark", x1: 0, x2: W, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
  const plot = svg("svg", { class: "vd-chart__svg", viewBox: `0 0 ${W} ${HT}`, preserveAspectRatio: "none", role: "img", "aria-label": o.title }, ...grid, markLine, ...(area ? [area] : []), ...paths, cross);
  const yl = [h("span", {}, " "), h("span", {}, " "), h("span", {}, " ")];
  const from = h("span", {}, "−3 min");
  const readout = h("span", { class: "vd-chart__readout vd-faint" }, " ");
  const el = h(
    "figure",
    { class: "vd-chart" },
    h("figcaption", { class: "vd-chart__head" }, h("span", { class: "vd-chart__title" }, o.title), multi ? null : value),
    h("div", { class: "vd-chart__meta" }, multi ? h("span", { class: "vd-chart__keys" }, keys.map((k) => k.el)) : sub),
    multi && o.sub ? h("div", { class: "vd-chart__meta" }, sub) : null,
    h("div", { class: "vd-chart__plot" }, h("div", { class: "vd-chart__y", "aria-hidden": "true" }, yl), plot),
    h("div", { class: "vd-chart__x", "aria-hidden": "true" }, from, readout, h("span", {}, "now")),
  );
  let data: number[][] = [];
  let slots = RANGES["3m"].points;
  let step = 1;
  const xAt = (i: number): number => (i / (slots - 1)) * W;
  const hover = (e: PointerEvent): void => {
    const r = plot.getBoundingClientRect();
    const len = data[0]?.length ?? 0;
    if (!len || !r.width) return;
    const off = slots - len;
    const i = Math.max(off, Math.min(slots - 1, Math.round(((e.clientX - r.left) / r.width) * (slots - 1))));
    cross.setAttribute("x1", String(xAt(i)));
    cross.setAttribute("x2", String(xAt(i)));
    cross.setAttribute("visibility", "visible");
    const ago = (slots - 1 - i) * step;
    const vals = data.map((d, k) => `${multi ? `${o.lines[k].label} ` : ""}${o.fmt(d[i - off] ?? 0)}`).join(" · ");
    setText(readout, `${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago: ${vals}`);
  };
  plot.addEventListener("pointermove", hover as EventListener);
  plot.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    setText(readout, " ");
  });
  let top = -1;
  return {
    el,
    paint(s, range) {
      const rg = RANGES[range];
      slots = rg.points;
      step = rg.step;
      setText(from, `−${rg.label}`);
      data = o.lines.map((l) => {
        const sr = l.get(s);
        return sr ? view(sr, range) : [];
      });
      const all = data.flat();
      const max = o.max ?? nice(Math.max(o.floor ?? 1, ...all) * 1.08);
      if (max !== top) {
        top = max;
        setText(yl[0], o.fmt(max));
        setText(yl[1], o.fmt(max / 2));
        setText(yl[2], o.fmt(0));
        if (o.mark !== undefined && o.mark <= max) {
          const y = String(HT * (1 - o.mark / max));
          markLine.setAttribute("y1", y);
          markLine.setAttribute("y2", y);
          markLine.setAttribute("visibility", "visible");
        } else markLine.setAttribute("visibility", "hidden");
      }
      const y = (v: number): number => HT * (1 - Math.min(max, Math.max(0, v)) / max);
      data.forEach((vals, k) => {
        if (!vals.length) {
          paths[k].setAttribute("d", "");
          return;
        }
        const off = slots - vals.length;
        const pts = vals.map((v, i) => `${xAt(i + off).toFixed(1)},${y(v).toFixed(1)}`);
        paths[k].setAttribute("d", `M${pts.join("L")}`);
        if (area && k === 0) area.setAttribute("d", `M${xAt(off).toFixed(1)},${HT}L${pts.join("L")}L${W},${HT}Z`);
      });
      const now = data.map((d) => d.at(-1));
      if (multi) keys.forEach((k, i) => setText(k.v, now[i] === undefined ? "–" : o.fmt(now[i] ?? 0)));
      else setText(value, now[0] === undefined ? "–" : o.fmt(now[0] ?? 0));
      if (o.sub) setText(sub, o.sub(s) || " ");
      const said = o.lines.map((l, i) => `${multi ? `${l.label} ` : ""}${now[i] === undefined ? "no data" : o.fmt(now[i] ?? 0)}`).join(", ");
      plot.setAttribute("aria-label", `${o.title}, ${o.context}: now ${said}, over the last ${rg.label}`);
    },
  };
}

// ---------- formats ----------
const pct = (v: number): string => `${Math.round(v)}%`;
const deg = (v: number): string => `${Math.round(v)}°C`;
const gibF = (v: number): string => `${v.toFixed(1)} GiB`;
const gibAxis = (v: number): string => `${Math.round(v)}G`;
const watts = (v: number): string => `${Math.round(v)} W`;
const mbs = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)} GB/s` : `${Math.round(v)} MB/s`);
const rate = (v: number): string => (v >= 100 ? `${Math.round(v)}/s` : `${v.toFixed(v >= 10 ? 1 : 2)}/s`);
const tps = (v: number): string => (v >= 10_000 ? `${(v / 1000).toFixed(0)}k/s` : v >= 1000 ? `${(v / 1000).toFixed(1)}k/s` : `${Math.round(v)}/s`);
const count = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));

const peakSub = (get: (s: State) => Series | undefined, fmt: (v: number) => string) => (s: State): string => {
  const sr = get(s);
  return sr ? `peak 1 h: ${fmt(peak(sr))}` : "";
};

// ---------- the tab ----------

export function mountTelemetry(panel: HTMLElement, ctx: Ctx): () => void {
  const s0 = ctx.store.get();
  let range: Range = "3m";
  const charts: Chart[] = [];
  const add = (c: Chart): HTMLElement => {
    charts.push(c);
    return c.el;
  };
  const patches: ((s: State) => void)[] = [];

  // Toolbar: the range and which cards to show.
  const rangeBtns = (Object.keys(RANGES) as Range[]).map((r) => {
    const b = h("button", { type: "button", class: "vd-seg__btn", "aria-pressed": String(r === range), "data-range": r, "data-k": `range:${r}` }, RANGES[r].label);
    b.addEventListener("click", () => {
      range = r;
      for (const x of rangeBtns) x.setAttribute("aria-pressed", String(x.dataset.range === r));
      paint(ctx.store.get(), true);
    });
    return b;
  });
  const cardSel = select([["all", "All cards"], ...s0.gpus.map((g): [string, string] => [String(g.index), `GPU ${g.index}`])], "all", { id: "vd-tele-cards", "aria-label": "Cards" });
  const sampled = h("span", { class: "vd-tele__sampled" }, " ");
  const toolbar = h(
    "div",
    { class: "vd-tele__bar" },
    h("div", { class: "vd-seg", role: "group", "aria-label": "Time range" }, rangeBtns),
    h("label", { class: "vd-tele__filter" }, h("span", { class: "vd-faint" }, "Show"), cardSel),
    h("p", { class: "vd-faint vd-tele__note" }, "Sampling every 1 s · 3 min of 1 s samples, an hour of 15 s averages · ", sampled, " · hover a chart to read a moment"),
  );
  patches.push((s) => setText(sampled, `last sample ${clock(s.telemetry.at)} UTC`));

  // Host.
  const host = (s: State) => s.telemetry.host;
  const load = h("span", { class: "vd-tele__load" }, " ");
  const cacheBar = h("span", { class: "vd-meter vd-tele__meter" });
  const cacheFill = fill("vd-meter__fill", 0);
  cacheBar.append(cacheFill);
  const cacheText = h("span", {}, " ");
  patches.push((s) => {
    const [l1, l5, l15] = loadAvg(s.telemetry.host);
    setText(load, `load ${l1.toFixed(2)} / ${l5.toFixed(2)} / ${l15.toFixed(2)}`);
    const used = cacheUsedGiB(s);
    cacheFill.style.setProperty("--w", `${Math.min(100, (used / CACHE_VOLUME_GIB) * 100)}%`);
    setText(cacheText, `Model cache volume: ${used.toFixed(1)} of ${CACHE_VOLUME_GIB} GiB · ${(CACHE_VOLUME_GIB - used).toFixed(1)} GiB free`);
  });
  const hostPanel = h(
    "section",
    { class: "vd-panel vd-tele", "aria-labelledby": "vd-tele-host" },
    h("div", { class: "vd-tele__head" },
      h("h3", { id: "vd-tele-host", class: "vd-h" }, "Host", h("span", { class: "vd-faint vd-tele__what" }, ` · gpu-host-1 · ${HOST_THREADS} threads · ${HOST_RAM_GIB} GiB RAM`)),
      h("div", { class: "vd-tele__right" }, load, live())),
    h("div", { class: "vd-tele__charts vd-tele__charts--host" },
      add(chart({ title: "CPU", fmt: pct, max: 100, lines: [{ label: "CPU", get: (s) => host(s).cpu }], sub: peakSub((s) => host(s).cpu, pct), context: "host" })),
      add(chart({ title: "CPU temperature", fmt: deg, max: 100, lines: [{ label: "CPU", get: (s) => host(s).cpuTemp }], sub: peakSub((s) => host(s).cpuTemp, deg), context: "host" })),
      add(chart({ title: "RAM", fmt: gibAxis, max: HOST_RAM_GIB, lines: [{ label: "RAM", get: (s) => host(s).ram }], sub: (s) => `${last(host(s).ram).toFixed(1)} GiB of ${HOST_RAM_GIB} GiB`, context: "host" })),
      add(chart({ title: "Disk I/O", fmt: mbs, floor: 100, lines: [{ label: "read", get: (s) => host(s).diskRead }, { label: "write", get: (s) => host(s).diskWrite }], sub: () => "reads jump while a start loads its weights", context: "host" })),
      add(chart({ title: "Network in", fmt: mbs, floor: 50, lines: [{ label: "in", get: (s) => host(s).netRx }], sub: peakSub((s) => host(s).netRx, mbs), context: "host" })),
    ),
    h("div", { class: "vd-tele__foot" }, h("span", { class: "vd-tele__footbar" }, cacheBar, cacheText)),
  );

  // Cards.
  const gpuPanels = s0.gpus.map((g) => {
    const i = g.index;
    const gs = (s: State) => s.telemetry.gpus[i];
    const residents = h("div", { class: "vd-chips vd-tele__res" });
    const vbar = h("span", { class: "vd-meter vd-tele__meter" });
    const vfill = fill("vd-meter__fill", 0);
    vbar.append(vfill);
    const vtext = h("span", {}, " ");
    const clocks = h("span", { class: "vd-tele__clocks" }, " ");
    patches.push((s) => {
      const v = last(gs(s).vram);
      vfill.style.setProperty("--w", `${(v / CARD_GIB) * 100}%`);
      setText(vtext, `VRAM ${Math.round((v / CARD_GIB) * 100)}%`);
      setText(clocks, `SM ${int(last(gs(s).sm))} MHz · MEM ${int(last(gs(s).memClock))} MHz · fan ${Math.round(last(gs(s).fan))}% · ${Math.max(0, 87 - Math.round(last(gs(s).temp)))}°C below slowdown`);
    });
    const el = h(
      "section",
      { class: "vd-panel vd-tele", "aria-labelledby": `vd-tele-${i}`, "data-gpu": String(i) },
      h("div", { class: "vd-tele__head" }, h("h3", { id: `vd-tele-${i}`, class: "vd-h" }, `GPU ${i}`, h("span", { class: "vd-faint vd-tele__what" }, " · 96 GB card")), live()),
      residents,
      h("div", { class: "vd-tele__charts" },
        add(chart({ title: "Utilization", fmt: pct, max: 100, lines: [{ label: "util", get: (s) => gs(s).util }], sub: peakSub((s) => gs(s).util, pct), context: `GPU ${i}` })),
        add(chart({ title: "Temperature", fmt: deg, max: 100, lines: [{ label: "temp", get: (s) => gs(s).temp }], sub: peakSub((s) => gs(s).temp, deg), context: `GPU ${i}` })),
        add(chart({ title: `Power draw / ${POWER_LIMIT_W} W`, fmt: watts, max: POWER_LIMIT_W, lines: [{ label: "power", get: (s) => gs(s).power }], sub: peakSub((s) => gs(s).power, watts), context: `GPU ${i}` })),
        add(chart({ title: "VRAM", fmt: gibAxis, max: CARD_GIB, mark: CARD_GIB * CEILING, lines: [{ label: "VRAM", get: (s) => gs(s).vram }], sub: (s) => `${gibF(last(gs(s).vram))} of ${gibF(CARD_GIB)} · dashed: the ${CEILING} ceiling`, context: `GPU ${i}` })),
      ),
      h("div", { class: "vd-tele__foot" }, h("span", { class: "vd-tele__footbar" }, vbar, vtext), clocks),
    );
    region(residents, ctx.store, (s) => s.deps.filter((d) => onCard(d, i) && isResident(d)).map((d) => d.alias).join(","), (names) =>
      names ? [h("span", { class: "vd-faint" }, "Resident: "), ...names.split(",").map((n) => h("code", { class: "vd-chip" }, n))] : h("span", { class: "vd-faint" }, "Card free — no residents"),
    );
    return el;
  });
  cardSel.addEventListener("change", () => {
    for (const p of gpuPanels) p.hidden = cardSel.value !== "all" && p.dataset.gpu !== cardSel.value;
  });

  // Engines.
  const engines = mountEngines(ctx, () => range);
  patches.push(engines.patch);

  panel.append(toolbar, hostPanel, ...gpuPanels, engines.el);

  let last0: State["telemetry"] | null = null;
  const paint = (s: State, force = false): void => {
    if ((panel.hidden && !force) || (s.telemetry === last0 && !force)) return;
    last0 = s.telemetry;
    for (const p of patches) p(s);
    for (const c of charts) if (!c.el.closest("[hidden]")) c.paint(s, range);
  };
  cardSel.addEventListener("change", () => paint(ctx.store.get(), true));
  engines.onChange(() => paint(ctx.store.get(), true));
  paint(s0, true);
  ctx.store.subscribe((s) => paint(s));
  return () => paint(ctx.store.get(), true);
}

const last = (s: Series): number => s.fine.at(-1) ?? s.coarse.at(-1) ?? 0;
const live = (): HTMLElement => h("span", { class: "vd-badge vd-badge--good" }, h("span", { class: "vd-dot", "aria-hidden": "true" }), "live");

// ---------- engine metrics: a summary of every deployment, then one engine in detail ----------

const COLS: [string, string, (e: EngineSeries) => string][] = [
  ["Req/s", "requests per second", (e) => rate(last(e.reqRate))],
  ["Gen tok/s", "generated tokens per second", (e) => tps(last(e.genTps))],
  ["TTFT p95", "time to first token, 95th percentile", (e) => ms(last(e.ttft95))],
  ["ITL p50", "inter-token latency, median", (e) => ms(last(e.itl50))],
  ["Run / wait", "requests running and waiting", (e) => `${Math.round(last(e.running))} / ${Math.round(last(e.waiting))}`],
  ["KV cache", "KV cache usage", (e) => pct(last(e.kvUsage))],
  ["Prefix hit", "prefix cache hit rate", (e) => pct(last(e.prefixHit))],
];

function mountEngines(ctx: Ctx, range: () => Range): { el: HTMLElement; patch: (s: State) => void; onChange: (f: () => void) => void } {
  const eng = (s: State, a: string): EngineSeries | undefined => s.telemetry.engines[a];
  const first = ctx.store.get().deps.find((d) => d.status === "Running")?.alias ?? ctx.store.get().deps[0]?.alias ?? "";
  let chosen = first;
  let changed: () => void = () => undefined;
  const table = h("div", { class: "vd-etable", "data-scroll": "engines", tabindex: "0", role: "region", "aria-label": "Engine metrics of every deployment" });
  const cells = new Map<string, HTMLElement[]>();
  const pick = select([], first, { id: "vd-tele-engine", "aria-label": "Engine" });
  const state = h("p", { class: "vd-tele__estate" }, " ");
  const grid = h("div", { class: "vd-tele__charts vd-tele__charts--engine" });
  const choose = (a: string): void => {
    chosen = a;
    pick.value = a;
    detail.redraw();
    for (const [alias, row] of cells) row[0].closest("tr")?.classList.toggle("is-on", alias === a);
    changed();
  };
  pick.addEventListener("change", () => choose(pick.value));

  region(table, ctx.store, (s) => s.deps.map((d) => `${d.alias}:${d.status}:${d.kind}`).join(","), (_, s) => {
    cells.clear();
    if (!s.deps.some((d) => d.alias === chosen)) chosen = s.deps[0]?.alias ?? "";
    const opts = s.deps.map((d) => h("option", { value: d.alias }, `${d.alias} (${d.status.toLowerCase()})`));
    pick.replaceChildren(...opts);
    pick.value = chosen;
    return h(
      "table",
      { class: "vd-etable__t" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Deployment"), h("th", { scope: "col" }, "Status"), COLS.map(([c, t]) => h("th", { scope: "col", title: t }, c)))),
      h("tbody", {}, s.deps.map((d) => {
        const vals = COLS.map(() => h("td", { class: "vd-num" }, "–"));
        const b = h("button", { type: "button", class: "vd-linkbtn", "data-k": `engine:${d.alias}`, "aria-label": `Show ${d.alias}'s engine metrics` }, d.alias);
        b.addEventListener("click", () => choose(d.alias));
        cells.set(d.alias, vals);
        return h("tr", { class: d.alias === chosen ? "is-on" : null, "data-engine": d.alias }, h("th", { scope: "row" }, b), h("td", {}, statusBadge(d.status)), vals);
      })),
    );
  });

  const charts: Chart[] = [];
  const detail = region(grid, ctx.store, (s) => `${chosen}:${s.deps.find((d) => d.alias === chosen)?.kind}:${s.deps.find((d) => d.alias === chosen)?.cfg.spec.method}`, (_, s) => {
    charts.length = 0;
    const d = s.deps.find((x) => x.alias === chosen);
    if (!d) return h("p", { class: "vd-empty" }, "No deployments.");
    const a = d.alias;
    const e = (k: keyof EngineSeries) => (x: State) => eng(x, a)?.[k];
    const ctxName = `${a}'s engine`;
    const dd = (x: State): Deployment | undefined => x.deps.find((y) => y.alias === a);
    const list: ChartOpts[] =
      d.kind === "embed"
        ? [
            { title: "Requests", fmt: rate, floor: 1, lines: [{ label: "req/s", get: e("reqRate") }], sub: peakSub(e("reqRate"), rate), context: ctxName },
            { title: "Prompt tokens", fmt: tps, floor: 100, lines: [{ label: "prompt", get: e("promptTps") }], sub: () => "an embedding model reads, it does not generate", context: ctxName },
            { title: "Latency", fmt: ms, floor: 50, lines: [{ label: "p50", get: e("e2e50") }, { label: "p95", get: e("e2e95") }], context: ctxName },
            { title: "Requests in engine", fmt: count, floor: 2, lines: [{ label: "running", get: e("running") }, { label: "waiting", get: e("waiting") }], context: ctxName },
          ]
        : [
            { title: "Requests", fmt: rate, floor: 1, lines: [{ label: "req/s", get: e("reqRate") }], sub: peakSub(e("reqRate"), rate), context: ctxName },
            { title: "Tokens", fmt: tps, floor: 100, lines: [{ label: "prompt", get: e("promptTps") }, { label: "generation", get: e("genTps") }], context: ctxName },
            { title: "Time to first token", fmt: ms, floor: 100, lines: [{ label: "p50", get: e("ttft50") }, { label: "p95", get: e("ttft95") }], sub: (x) => (dd(x)?.cfg.chunkedPrefill === false ? "chunked prefill is off: long prompts hold the batch" : "prefill, plus any wait in the queue"), context: ctxName },
            { title: "Inter-token latency", fmt: ms, floor: 20, lines: [{ label: "p50", get: e("itl50") }, { label: "p95", get: e("itl95") }], sub: (x) => (dd(x)?.cfg.eager ? "enforce eager: no CUDA graphs, slower steps" : "time per output token (TPOT)"), context: ctxName },
            { title: "End-to-end latency", fmt: ms, floor: 1000, lines: [{ label: "p50", get: e("e2e50") }, { label: "p95", get: e("e2e95") }], context: ctxName },
            { title: "Requests in engine", fmt: count, floor: 4, lines: [{ label: "running", get: e("running") }, { label: "waiting", get: e("waiting") }], sub: (x) => `max num seqs ${dd(x)?.maxSeqs ?? "–"}`, context: ctxName },
            { title: "KV cache usage", fmt: pct, max: 100, mark: 92, lines: [{ label: "KV", get: e("kvUsage") }], sub: (x) => { const y = dd(x); return y?.kvTokens ? `of ${int(y.kvTokens)} tokens${y.cfg.kvDtype === "fp8" ? " (fp8)" : ""} · dashed: preemption starts` : "no KV measurement yet"; }, context: ctxName },
            { title: "Prefix cache hit rate", fmt: pct, max: 100, lines: [{ label: "hit", get: e("prefixHit") }], sub: (x) => (dd(x)?.cfg.prefixCaching === false ? "prefix caching is off for this deployment" : "prompt tokens served from cached blocks"), context: ctxName },
            { title: "Preemptions", fmt: count, floor: 2, lines: [{ label: "per s", get: e("preempt") }], sub: (x) => `${int(x.telemetry.preemptTotal[a] ?? 0)} since the engine started`, context: ctxName },
            ...(d.cfg.spec.method === "none" ? [] : [{ title: "Draft acceptance", fmt: pct, max: 100, lines: [{ label: "accepted", get: e("accept") }], sub: () => `${d.cfg.spec.method === "ngram" ? "n-gram lookup" : d.cfg.spec.draft}, ${d.cfg.spec.tokens} tokens a step`, context: ctxName } satisfies ChartOpts]),
          ];
    return list.map((o) => {
      const c = chart(o);
      charts.push(c);
      c.paint(s, range());
      return c.el;
    });
  });

  const el = h(
    "section",
    { class: "vd-panel vd-tele", "aria-labelledby": "vd-tele-eng" },
    h("div", { class: "vd-tele__head" }, h("h3", { id: "vd-tele-eng", class: "vd-h" }, "Engines", h("span", { class: "vd-faint vd-tele__what" }, " · each engine's /metrics, scraped every 1 s")), live()),
    table,
    h("div", { class: "vd-tele__ehead" }, h("label", { class: "vd-tele__filter" }, h("span", { class: "vd-faint" }, "Engine"), pick), state),
    grid,
  );
  return {
    el,
    onChange: (f) => (changed = f),
    patch(s) {
      for (const [alias, row] of cells) {
        const x = eng(s, alias);
        const d = s.deps.find((y) => y.alias === alias);
        COLS.forEach(([name], i) => setText(row[i], !x || d?.status !== "Running" || (d.kind === "embed" && !["Req/s", "Run / wait"].includes(name)) ? "–" : COLS[i][2](x)));
      }
      const d = s.deps.find((y) => y.alias === chosen);
      setText(state, !d ? " " : d.status === "Running" ? `${d.alias} on ${cardsText(d)} · ${d.model}` : `${d.alias} is ${d.status.toLowerCase()}: nothing to scrape, the charts keep its history`);
      for (const c of charts) c.paint(s, range());
    },
  };
}
