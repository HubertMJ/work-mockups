// Telemetry: per card, utilization, memory and temperature over the last three minutes, one sample a
// second, driven by what runs in the demo. The charts are built once and their paths rewritten, so
// nothing else on the page moves. No g[data-node] here: these stay charts in ASCII mode too.

import { h, setText, svg } from "../../../lib/dom";
import { CARD_GIB, CEILING, isResident } from "../model";
import { HISTORY } from "../sim";
import type { State } from "../types";
import { region, type Ctx } from "../ui";

const W = 360;
const HT = 100;

interface Chart {
  el: HTMLElement;
  update(values: number[]): void;
}

function chart(title: string, max: number, fmt: (v: number) => string, gpu: number, mark?: number): Chart {
  const value = h("span", { class: "vd-chart__value" });
  const area = svg("path", { class: "vd-chart__area" });
  const line = svg("path", { class: "vd-chart__line", "vector-effect": "non-scaling-stroke" });
  const cross = svg("line", { class: "vd-chart__cross", y1: 0, y2: HT, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
  const grid = [0, 0.5, 1].map((f) => svg("line", { class: "vd-chart__grid", x1: 0, x2: W, y1: HT * f, y2: HT * f, "vector-effect": "non-scaling-stroke" }));
  const ceiling = mark === undefined ? null : svg("line", { class: "vd-chart__mark", x1: 0, x2: W, y1: HT * (1 - mark / max), y2: HT * (1 - mark / max), "vector-effect": "non-scaling-stroke" });
  const plot = svg("svg", { class: "vd-chart__svg", viewBox: `0 0 ${W} ${HT}`, preserveAspectRatio: "none", role: "img", "aria-label": `${title}, GPU ${gpu}` }, ...grid, ...(ceiling ? [ceiling] : []), area, line, cross);
  const readout = h("span", { class: "vd-chart__readout vd-faint" }, " ");
  const el = h(
    "figure",
    { class: "vd-chart" },
    h("figcaption", { class: "vd-chart__head" }, h("span", {}, title), value),
    h("div", { class: "vd-chart__plot" }, h("div", { class: "vd-chart__y", "aria-hidden": "true" }, h("span", {}, fmt(max)), h("span", {}, fmt(max / 2)), h("span", {}, fmt(0))), plot),
    h("div", { class: "vd-chart__x", "aria-hidden": "true" }, h("span", {}, "−3 min"), readout, h("span", {}, "now")),
  );
  let data: number[] = [];
  const x = (i: number): number => (i / (HISTORY - 1)) * W;
  const y = (v: number): number => HT * (1 - Math.min(max, Math.max(0, v)) / max);
  const hover = (e: PointerEvent): void => {
    const r = plot.getBoundingClientRect();
    if (!data.length || !r.width) return;
    const off = HISTORY - data.length;
    const i = Math.max(off, Math.min(HISTORY - 1, Math.round(((e.clientX - r.left) / r.width) * (HISTORY - 1))));
    cross.setAttribute("x1", String(x(i)));
    cross.setAttribute("x2", String(x(i)));
    cross.setAttribute("visibility", "visible");
    setText(readout, `${HISTORY - 1 - i} s ago: ${fmt(data[i - off])}`);
  };
  plot.addEventListener("pointermove", hover as EventListener);
  plot.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    setText(readout, " ");
  });
  return {
    el,
    update(values) {
      data = values;
      if (!values.length) return;
      const off = HISTORY - values.length;
      const pts = values.map((v, i) => `${x(i + off).toFixed(1)},${y(v).toFixed(1)}`);
      line.setAttribute("d", `M${pts.join("L")}`);
      area.setAttribute("d", `M${x(off).toFixed(1)},${HT}L${pts.join("L")}L${W},${HT}Z`);
      const now = values[values.length - 1];
      setText(value, fmt(now));
      plot.setAttribute("aria-label", `${title}, GPU ${gpu}: now ${fmt(now)}, over the last ${values.length} s`);
    },
  };
}

export function mountTelemetry(panel: HTMLElement, ctx: Ctx): () => void {
  const charts: { util: Chart; vram: Chart; temp: Chart }[] = [];
  const cards = ctx.store.get().gpus.map((g) => {
    const c = {
      util: chart("Utilization", 100, (v) => `${Math.round(v)}%`, g.index),
      vram: chart("VRAM", CARD_GIB, (v) => `${v.toFixed(1)} GiB`, g.index, CARD_GIB * CEILING),
      temp: chart("Temperature", 100, (v) => `${Math.round(v)}°C`, g.index),
    };
    charts.push(c);
    const residents = h("div", { class: "vd-chips" });
    const el = h(
      "section",
      { class: "vd-panel vd-tele", "aria-labelledby": `vd-tele-${g.index}` },
      h("div", { class: "vd-tele__head" }, h("h3", { id: `vd-tele-${g.index}`, class: "vd-h" }, `GPU ${g.index}`, h("span", { class: "vd-faint" }, " · 96 GB card")), h("span", { class: "vd-badge vd-badge--good" }, h("span", { class: "vd-dot", "aria-hidden": "true" }), "live")),
      residents,
      h("div", { class: "vd-tele__charts" }, c.util.el, c.vram.el, c.temp.el),
    );
    return { el, residents, i: g.index };
  });
  panel.append(
    h("p", { class: "vd-faint vd-tele__note" }, `Sampling every 1 s · history ${HISTORY} samples · the curves follow what runs in this demo: start, stop or send a prompt and watch its card.`),
    h("div", { class: "vd-tele__grid" }, cards.map((c) => c.el)),
  );
  for (const c of cards)
    region(c.residents, ctx.store, (s) => s.deps.filter((d) => d.gpu === c.i && isResident(d)).map((d) => d.alias).join(","), (names) =>
      names ? [h("span", { class: "vd-faint" }, "Resident: "), ...names.split(",").map((n) => h("code", { class: "vd-chip" }, n))] : h("span", { class: "vd-faint" }, "Card free — no residents"),
    );
  let last: State["telemetry"] | null = null;
  const paint = (s: State, force = false): void => {
    if ((panel.hidden && !force) || s.telemetry === last) return;
    last = s.telemetry;
    s.telemetry.util.forEach((_, i) => {
      charts[i].util.update(s.telemetry.util[i]);
      charts[i].vram.update(s.telemetry.vram[i]);
      charts[i].temp.update(s.telemetry.temp[i]);
    });
  };
  paint(ctx.store.get(), true);
  ctx.store.subscribe((s) => paint(s));
  return () => paint(ctx.store.get(), true);
}
