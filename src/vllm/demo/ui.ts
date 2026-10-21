// The demo's view plumbing: a tiny store, regions that redraw from a slice of the State only when
// that slice changes (keeping focus and inner scroll positions), modal dialogs and icons.

import { h, replace, svg, type Child } from "../../lib/dom";
import type { Result } from "./actions";
import type { State } from "./types";

export interface Store {
  get(): State;
  set(s: State): void;
  subscribe(f: (s: State) => void): () => void;
}

export function createStore(initial: State): Store {
  let state = initial;
  const subs: ((s: State) => void)[] = [];
  return {
    get: () => state,
    set(s) {
      if (s === state) return;
      state = s;
      for (const f of subs) f(s);
    },
    subscribe(f) {
      subs.push(f);
      return () => {
        const i = subs.indexOf(f);
        if (i >= 0) subs.splice(i, 1);
      };
    },
  };
}

/** What every view gets: the store, a way to act on it, and the dialogs' host. */
export interface Ctx {
  store: Store;
  act(f: (s: State) => Result): Result;
  host: HTMLElement;
  calm(): boolean;
}

const same = (a: unknown, b: unknown): boolean =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/** The keys of the focused element and its keyed ancestors, nearest first. */
function focusKeys(el: Element): string[] {
  const keys: string[] = [];
  for (let e: Element | null = document.activeElement; e && el.contains(e); e = e.parentElement) {
    const k = e.getAttribute("data-k");
    if (k) keys.push(k);
  }
  return keys;
}

export function refocus(scope: ParentNode, keys: string[]): boolean {
  for (const k of keys) {
    const t = scope.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`);
    if (t) {
      t.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

/**
 * Draws `el` from `select(state)` now and whenever that value changes. Focus inside it survives the
 * redraw (by the data-k of the focused element, or of its nearest keyed ancestor), and so does the
 * scroll position of every element carrying data-scroll.
 */
export function region<T>(el: HTMLElement, store: Store, select: (s: State) => T, draw: (v: T, s: State) => Child | Child[]): { redraw(): void; stop(): void } {
  let last: T | undefined;
  let drawn = false;
  const paint = (s: State, force = false): void => {
    const v = select(s);
    if (drawn && !force && same(v, last)) return;
    last = v;
    const first = !drawn;
    drawn = true;
    const keys = focusKeys(el);
    const scrolls = new Map<string, [number, number, boolean]>();
    const scrollers = (): HTMLElement[] => [...(el.matches("[data-scroll]") ? [el] : []), ...el.querySelectorAll<HTMLElement>("[data-scroll]")];
    for (const x of first ? [] : scrollers()) {
      scrolls.set(x.dataset.scroll ?? "", [x.scrollTop, x.scrollLeft, x.scrollTop + x.clientHeight >= x.scrollHeight - 4]);
    }
    const out = draw(v, s);
    replace(el, ...(Array.isArray(out) ? out : [out]));
    for (const x of scrollers()) {
      const p = scrolls.get(x.dataset.scroll ?? "");
      if (!p) {
        // First drawn: an inner scroller may start part-way (the calendar at 07:00, a log at its end).
        if (x.dataset.follow !== undefined) x.scrollTop = x.scrollHeight;
        else if (x.dataset.scrollInit) x.scrollTop = Number(x.dataset.scrollInit);
        continue;
      }
      // A log that was at its end follows new lines; otherwise the reader's place stays.
      x.scrollTop = p[2] && x.dataset.follow !== undefined ? x.scrollHeight : p[0];
      x.scrollLeft = p[1];
    }
    if (keys.length) refocus(el, keys);
  };
  paint(store.get());
  const stop = store.subscribe((s) => paint(s));
  return { redraw: () => paint(store.get(), true), stop };
}

// ---------- dialogs ----------

export interface DialogOpts {
  title: string;
  body: Child[];
  actions?: Child[];
  alert?: boolean;
  wide?: boolean;
  /** Where focus goes back on close: the opener, or by key if a redraw replaced it. */
  returnKeys?: string[];
  onClose?: () => void;
  tone?: "danger";
}

let dialogSeq = 0;

/** Keeps Tab inside a dialog: round from the last control to the first, and back with Shift. */
export function trapTab(el: HTMLElement): void {
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...el.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export function openDialog(host: HTMLElement, o: DialogOpts): { el: HTMLDialogElement; close(): void } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const keys = o.returnKeys ?? [];
  if (opener) for (let e: Element | null = opener; e; e = e.parentElement) if (e.getAttribute("data-k")) keys.push(e.getAttribute("data-k") ?? "");
  const id = `vd-dlg-${++dialogSeq}`;
  const close = h("button", { type: "button", class: "vd-icon-btn vd-dialog__x", "aria-label": "Close" }, icon("x"));
  const el = h(
    "dialog",
    { class: `vd-dialog${o.wide ? " vd-dialog--wide" : ""}${o.tone ? ` vd-dialog--${o.tone}` : ""}`, "aria-labelledby": id, role: o.alert ? "alertdialog" : null },
    h("div", { class: "vd-dialog__head" }, h("h3", { id, class: "vd-dialog__title" }, o.tone === "danger" ? icon("warn") : null, o.title), close),
    h("div", { class: "vd-dialog__body" }, o.body),
    o.actions?.length ? h("div", { class: "vd-dialog__actions" }, o.actions) : null,
  );
  const done = (): void => el.close();
  close.addEventListener("click", done);
  trapTab(el);
  el.addEventListener("close", () => {
    el.remove();
    o.onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else refocus(document, keys);
  });
  host.append(el);
  el.showModal();
  const auto = el.querySelector<HTMLElement>("[autofocus]") ?? el.querySelector<HTMLElement>(".vd-dialog__body input, .vd-dialog__body select, .vd-dialog__body textarea") ?? el.querySelector<HTMLElement>(".vd-dialog__actions .vd-btn--primary") ?? close;
  auto.focus({ preventScroll: true });
  return { el, close: done };
}

// ---------- small pieces ----------

const PATHS: Record<string, string> = {
  play: "M8 5v14l11-7z",
  stop: "M7 7h10v10H7z",
  restart: "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5",
  logs: "M4 6l5 5-5 5M11 17h9",
  edit: "M5 4v16M12 4v16M19 4v16M3 8h4M10 15h4M17 10h4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  pin: "M9 3h6l-1 6 4 4H6l4-4zM12 13v8",
  unpin: "M9 3h6l-1 6 4 4H6l4-4zM12 13v8M4 4l16 16",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  warn: "M12 3l10 18H2zM12 10v5M12 18v.01",
  chip: "M7 7h10v10H7zM4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3",
  send: "M4 12l16-8-6 16-3-7z",
  reset: "M4 4v6h6M4.5 15a8 8 0 1 0 1.7-8.3L4 10",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
};

export function icon(name: keyof typeof PATHS | string): SVGElement {
  return svg(
    "svg",
    { class: "vd-ico", viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true", focusable: "false" },
    svg("path", { d: PATHS[name] ?? "", fill: name === "play" || name === "stop" ? "currentColor" : "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  );
}

type BtnOpts = { kind?: "primary" | "danger" | "ghost" | "plain"; icon?: string; k?: string; disabled?: boolean; label?: string; cls?: string };
export function btn(text: string, onClick: () => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = h(
    "button",
    { type: "button", class: `vd-btn vd-btn--${o.kind ?? "plain"}${o.cls ? ` ${o.cls}` : ""}`, "data-k": o.k, disabled: o.disabled, "aria-label": o.label },
    o.icon ? icon(o.icon) : null,
    text ? h("span", {}, text) : null,
  );
  b.addEventListener("click", onClick);
  return b;
}

export const badge = (text: Child | Child[], tone = "neutral", attrs: Record<string, string> = {}): HTMLElement => h("span", { class: `vd-badge vd-badge--${tone}`, ...attrs }, text);

export const field = (label: string, control: HTMLElement, hint?: Child): HTMLElement =>
  h("label", { class: "vd-field" }, h("span", { class: "vd-field__label" }, label), control, hint ? h("span", { class: "vd-field__hint" }, hint) : null);

export function select(options: [string, string][], value: string, attrs: Record<string, string | undefined> = {}): HTMLSelectElement {
  const el = h("select", { class: "vd-input", ...attrs }, options.map(([v, t]) => h("option", { value: v }, t)));
  el.value = value;
  return el;
}

/** A bar's fill: the width goes through CSSOM (the CSP allows no inline style attribute). */
export function fill(cls: string, fraction: number): HTMLElement {
  const el = h("span", { class: cls });
  el.style.setProperty("--w", `${Math.max(0, Math.min(1, fraction)) * 100}%`);
  return el;
}
