// Mounts the demo: the header with its clock and Reset, the tabs, the status line that announces
// what happened, and the loop that moves the demo's time. The loop wakes every 100 ms while something
// is in motion (a start, a stop, a streaming answer) and once a second otherwise, and sleeps while the
// tab is hidden.

import { h, setText } from "../../lib/dom";
import type { Result } from "./actions";
import { clock, rng, SEED_NOW } from "./model";
import { seed } from "./seed";
import { busy, tick } from "./sim";
import type { State } from "./types";
import { btn, createStore, icon, type Ctx } from "./ui";
import { mountAnalytics } from "./views/analytics";
import { mountApi } from "./views/api";
import { mountDeployments } from "./views/deployments";
import { mountDownloads } from "./views/downloads";
import { mountPlayground } from "./views/playground";
import { mountReservations } from "./views/reservations";
import { mountTelemetry } from "./views/telemetry";

type Mount = (panel: HTMLElement, ctx: Ctx) => (() => void) | void;
const TABS: [string, string, Mount][] = [
  ["deployments", "Deployments", mountDeployments],
  ["playground", "Playground", mountPlayground],
  ["analytics", "Analytics", mountAnalytics],
  ["reservations", "Reservations", mountReservations],
  ["downloads", "Downloads", mountDownloads],
  ["telemetry", "Telemetry", mountTelemetry],
  ["api", "API", (p) => mountApi(p)],
];

const RNG_SEED = 4242;

export function mountDemo(root: HTMLElement): void {
  const calmQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const store = createStore(seed());
  let t0 = performance.now();
  let r = rng(RNG_SEED);
  const now = (): number => SEED_NOW + (performance.now() - t0);
  const ctx: Ctx = {
    store,
    host: root,
    calm: () => !!calmQuery?.matches,
    act(f: (s: State) => Result): Result {
      const res = f(tick(store.get(), now(), r));
      store.set(res.state);
      wake();
      return res;
    },
  };

  const time = h("span", { class: "vd-clock", "aria-hidden": "true" });
  const reset = btn("Reset demo", () => {
    for (const d of root.querySelectorAll("dialog")) d.close();
    t0 = performance.now();
    r = rng(RNG_SEED);
    store.set({ ...seed(), notice: { id: Date.now(), level: "info", text: "The demo is back at its starting point." } });
    wake();
  }, { icon: "reset", k: "reset", cls: "vd-reset" });
  const status = h("p", { class: "vd-status", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const tablist = h("div", { class: "vd-tabs", role: "tablist", "aria-label": "Demo sections" });
  const panels = h("div", { class: "vd-panels" });
  root.replaceChildren(
    h(
      "div",
      { class: "vd-top" },
      h("div", { class: "vd-brand" }, icon("db"), h("div", {}, h("h1", { class: "vd-title" }, "vLLM Deployment Manager"), h("p", { class: "vd-faint" }, "gpu-host-1 · 4 × 96 GiB · a mock-up on made-up data, nothing here talks to a GPU"))),
      h("div", { class: "vd-top__tools" }, h("span", { class: "vd-faint vd-clock-wrap" }, "UTC ", time), reset),
    ),
    tablist,
    status,
    panels,
  );

  const tabs: HTMLButtonElement[] = [];
  const shown = new Map<string, () => void>();
  const select = (id: string, focus = false): void => {
    for (const t of tabs) {
      const on = t.dataset.tab === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus({ preventScroll: true });
    }
    for (const p of panels.children as HTMLCollectionOf<HTMLElement>) p.hidden = p.dataset.tab !== id;
    const panel = panels.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    if (panel && !panel.dataset.ready) {
      panel.dataset.ready = "1";
      const m = TABS.find((t) => t[0] === id)?.[2];
      const onShow = m?.(panel, ctx);
      if (onShow) shown.set(id, onShow);
    }
    shown.get(id)?.();
  };
  for (const [id, label] of TABS) {
    const t = h("button", { type: "button", role: "tab", class: "vd-tab", id: `vd-tab-${id}`, "aria-controls": `vd-panel-${id}`, "data-tab": id, "data-k": `tab:${id}` }, label);
    t.addEventListener("click", () => select(id));
    t.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(t);
      const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length].dataset.tab ?? id, true);
    });
    tabs.push(t);
    tablist.append(t);
    panels.append(h("div", { class: "vd-tabpanel", role: "tabpanel", id: `vd-panel-${id}`, "aria-labelledby": `vd-tab-${id}`, "data-tab": id, hidden: true }));
  }
  select("deployments");

  let lastNotice = -1;
  store.subscribe((s) => {
    if (s.notice && s.notice.id !== lastNotice) {
      lastNotice = s.notice.id;
      status.dataset.level = s.notice.level;
      setText(status, s.notice.text);
    }
    setText(time, clock(s.now));
  });
  setText(time, clock(SEED_NOW));
  setText(status, "Ready. Start a stopped deployment, or send a prompt to one from the Playground.");

  let timer = 0;
  const step = (): void => {
    timer = 0;
    if (document.hidden) return;
    store.set(tick(store.get(), now(), r));
    timer = window.setTimeout(step, busy(store.get()) ? 100 : 1000);
  };
  function wake(): void {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(step, 100);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  wake();
}
