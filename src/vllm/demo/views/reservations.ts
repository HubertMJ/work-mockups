// Reservations: a week calendar of bookings. An empty slot books a model for a window; the planner
// decides at once whether the window holds (Scheduled) or not (Unfulfillable, with the reason).
// Overlapping bookings on one deployment share its container and are drawn as a merged pair.

import { h, replace, setText } from "../../../lib/dom";
import * as A from "../actions";
import { DAY, dep, hm, HOUR, iso, span, WEEK0, hours, day as dayName } from "../model";
import type { Reservation, ResStatus, State } from "../types";
import { btn, field, openDialog, region, select, type Ctx } from "../ui";
import { resBadge, showConflict } from "./common";

const H = 30; // px per hour
const DAYS = [0, 1, 2, 3, 4, 5, 6].map((i) => WEEK0 + i * DAY);
const ICON: Record<ResStatus, string> = { Scheduled: "◷", Active: "▶", Completed: "✓", Unfulfillable: "▲" };

interface Seg {
  r: Reservation;
  day: number;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  cont: boolean;
  merged: string | null;
}

function segments(s: State): Seg[] {
  const out: Seg[] = [];
  for (const [di, d0] of DAYS.entries()) {
    const day: Seg[] = [];
    for (const r of s.reservations) {
      const a = Math.max(r.start, d0);
      const b = Math.min(r.end, d0 + DAY);
      if (b <= a) continue;
      const partner = s.reservations.find((x) => x !== r && x.alias === r.alias && x.start < r.end && r.start < x.end);
      day.push({ r, day: di, start: a, end: b, lane: 0, lanes: 1, cont: r.end > d0 + DAY, merged: partner?.name ?? null });
    }
    day.sort((x, y) => x.start - y.start || x.r.created - y.r.created);
    // Lanes: side by side where windows overlap, full width otherwise.
    let cluster: Seg[] = [];
    let clusterEnd = 0;
    const close = (): void => {
      const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
      for (const c of cluster) c.lanes = n;
      cluster = [];
    };
    for (const seg of day) {
      if (seg.start >= clusterEnd) close();
      const used = cluster.filter((c) => c.end > seg.start).map((c) => c.lane);
      let lane = 0;
      while (used.includes(lane)) lane++;
      seg.lane = lane;
      cluster.push(seg);
      clusterEnd = Math.max(clusterEnd, seg.end);
    }
    close();
    out.push(...day);
  }
  return out;
}

export function mountReservations(panel: HTMLElement, ctx: Ctx): void {
  const bar = h(
    "div",
    { class: "vd-cal__bar" },
    h("div", {}, h("h3", { class: "vd-h" }, "19 Oct – 25 Oct 2026"), h("p", { class: "vd-faint" }, "Week view · UTC · click an empty hour to book it")),
    btn("New reservation", () => bookDialog(ctx, WEEK0 + 3 * DAY + 14 * HOUR), { kind: "primary", icon: "plus", k: "new-reservation" }),
  );
  const cal = h("div", { class: "vd-cal", "data-scroll": "cal", "data-scroll-init": String(6 * H) });
  const legend = h(
    "p",
    { class: "vd-cal__legend" },
    (["Scheduled", "Active", "Completed", "Unfulfillable"] as ResStatus[]).map((x) => h("span", { class: `vd-legend vd-legend--${x.toLowerCase()}` }, h("span", { "aria-hidden": "true" }, ICON[x]), x)),
    h("span", { class: "vd-legend vd-legend--merged" }, h("span", { "aria-hidden": "true" }, "⧉"), "Merged: one shared container"),
  );
  panel.append(h("section", { class: "vd-panel" }, bar, cal, legend));
  region(cal, ctx.store, (s) => [s.reservations, s.deps, Math.floor(s.now / 60_000)], (_, s) => grid(ctx, s));
}

function grid(ctx: Ctx, s: State): HTMLElement {
  const segs = segments(s);
  const head = h("div", { class: "vd-cal__head" }, h("span", {}), DAYS.map((d) => h("span", { class: `vd-cal__day${s.now >= d && s.now < d + DAY ? " is-today" : ""}` }, dayName(d))));
  const times = h("div", { class: "vd-cal__times", "aria-hidden": "true" }, Array.from({ length: 24 }, (_, i) => h("span", {}, hours(i))));
  const cols = DAYS.map((d0, di) => {
    const col = h("div", { class: "vd-cal__col" });
    for (let hr = 0; hr < 24; hr++) {
      const t = d0 + hr * HOUR;
      const slot = h("button", { type: "button", class: "vd-cal__slot", tabindex: "-1", "aria-label": `Book ${dayName(d0)} ${hours(hr)}`, "data-k": `slot:${di}:${hr}`, "data-slot": `${di}:${hr}` });
      slot.addEventListener("click", () => bookDialog(ctx, t));
      col.append(slot);
    }
    // A merged pair's shared container: one dashed outline round both windows.
    const groups = new Map<string, [number, number]>();
    for (const g of segs.filter((x) => x.day === di && x.merged)) {
      const k = g.r.alias;
      const cur = groups.get(k);
      groups.set(k, cur ? [Math.min(cur[0], g.start), Math.max(cur[1], g.end)] : [g.start, g.end]);
    }
    for (const [, [a, b]] of groups) col.append(place(h("span", { class: "vd-cal__envelope", "aria-hidden": "true" }), a - d0, b - a, 0, 1));
    for (const g of segs.filter((x) => x.day === di)) {
      const r = g.r;
      const blk = h(
        "button",
        { type: "button", class: `vd-cal__blk vd-cal__blk--${r.status.toLowerCase()}${g.merged ? " is-merged" : ""}${g.end - g.start < 2 * HOUR ? " is-short" : ""}`, "data-k": `res:${r.id}:${di}`, "data-res": r.name,
          "aria-label": `${r.name}, ${r.alias}, ${span(r.start, r.end)}, ${r.status}${g.merged ? `, merged with ${g.merged}` : ""}` },
        h("span", { class: "vd-cal__time" }, h("span", { "aria-hidden": "true" }, ICON[r.status]), ` ${hm(g.start)}–${g.cont ? "24:00↓" : hm(g.end)}`, g.merged ? h("span", { "aria-hidden": "true" }, " ⧉") : null),
        h("span", { class: "vd-cal__name" }, r.name),
        h("code", { class: "vd-cal__alias" }, r.alias),
      );
      blk.addEventListener("click", () => details(ctx, r.id));
      col.append(place(blk, g.start - d0, g.end - g.start, g.lane, g.lanes));
    }
    if (s.now >= d0 && s.now < d0 + DAY) {
      const line = h("span", { class: "vd-cal__now", "aria-hidden": "true" }, h("span", {}, hm(s.now)));
      line.style.setProperty("--top", `${((s.now - d0) / HOUR) * H}px`);
      col.append(line);
    }
    return col;
  });
  return h("div", { class: "vd-cal__grid" }, head, h("div", { class: "vd-cal__body" }, times, cols));
}

function place<T extends HTMLElement>(el: T, from: number, len: number, lane: number, lanes: number): T {
  el.style.setProperty("--top", `${(from / HOUR) * H}px`);
  el.style.setProperty("--h", `${Math.max(H / 2, (len / HOUR) * H)}px`);
  el.style.setProperty("--l", `${(lane / lanes) * 100}%`);
  el.style.setProperty("--wd", `${100 / lanes}%`);
  return el;
}

function details(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  const r = s.reservations.find((x) => x.id === id);
  if (!r) return;
  const d = dep(s, r.alias);
  const partner = s.reservations.find((x) => x !== r && x.alias === r.alias && x.start < r.end && r.start < x.end);
  const dlg = openDialog(ctx.host, {
    title: `Reservation ${r.name}`,
    body: [
      h(
        "dl",
        { class: "vd-info" },
        h("dt", {}, "Status"), h("dd", {}, resBadge(r.status)),
        h("dt", {}, "Deployment"), h("dd", {}, h("code", {}, r.alias), d ? ` on GPU ${d.gpu}` : ""),
        h("dt", {}, "Window"), h("dd", {}, h("code", {}, `${iso(r.start)} → ${iso(r.end)}`)),
        partner ? [h("dt", {}, "Merged"), h("dd", {}, `Shares one container with ${partner.name}`)] : null,
      ),
      r.reason ? h("div", { class: "vd-alert vd-alert--bad" }, h("p", {}, r.reason)) : null,
      h("p", { class: "vd-faint" }, "External callers poll a booking's status; the planner checks it again whenever a pin, edit, delete or measurement changes the plan."),
    ],
    actions: [
      r.status === "Completed"
        ? null
        : btn("Delete reservation", () => {
            ctx.act((x) => A.unbook(x, r.id));
            dlg.close();
          }, { kind: "danger" }),
      btn("Close", () => dlg.close(), { kind: "primary" }),
    ],
  });
}

let bookings = 0;

function bookDialog(ctx: Ctx, at: number): void {
  const s = ctx.store.get();
  const name = h("input", { class: "vd-input", value: `booking-${++bookings}`, maxlength: "40", autocomplete: "off", spellcheck: "false" });
  const who = select(s.deps.map((d) => [d.alias, `${d.alias} (GPU ${d.gpu})`]), dep(s, "model-b") ? "model-b" : s.deps[0]?.alias ?? "");
  const dayIdx = Math.max(0, Math.min(6, Math.floor((at - WEEK0) / DAY)));
  const daySel = select(DAYS.map((d, i) => [String(i), dayName(d)]), String(dayIdx));
  const hourSel = select(Array.from({ length: 24 }, (_, i) => [String(i), hours(i)]), String(new Date(at).getUTCHours()));
  const len = select([1, 2, 3, 4, 6, 8, 12].map((n) => [String(n), `${n} h`]), "2");
  const preview = h("div", { class: "vd-fit", "aria-live": "polite" });
  const err = h("p", { class: "vd-form-error", role: "alert" });
  const spec = (): A.Booking => {
    const start = WEEK0 + Number(daySel.value) * DAY + Number(hourSel.value) * HOUR;
    return { name: name.value, alias: who.value, start, end: start + Number(len.value) * HOUR };
  };
  const upd = (): void => {
    const r = A.book(ctx.store.get(), spec());
    const got = r.state.reservations.find((x) => x.id === r.id);
    if (r.error) replace(preview, h("p", { class: "vd-bad" }, r.error));
    else if (got?.status === "Unfulfillable") replace(preview, h("p", { class: "vd-bad" }, "The planner says Unfulfillable: ", got.reason ?? ""));
    else replace(preview, h("p", { class: "vd-good" }, `The planner says Scheduled: GPU ${dep(s, who.value)?.gpu} can hold it for the whole window.`));
  };
  for (const c of [who, daySel, hourSel, len]) c.addEventListener("change", upd);
  name.addEventListener("input", upd);
  upd();
  const dlg = openDialog(ctx.host, {
    title: "Book a window",
    body: [
      h("p", { class: "vd-faint" }, "A booking reserves a deployment's memory for a window. The planner checks the card over the whole interval; a booking that does not fit is kept as Unfulfillable, with the reason."),
      h("div", { class: "vd-form vd-form--2" }, field("Name", name), field("Deployment", who), field("Day", daySel), field("Start (UTC)", hourSel), field("Length", len)),
      preview,
      err,
    ],
    actions: [
      btn("Cancel", () => dlg.close()),
      btn("Book", () => {
        const r = ctx.act((x) => A.book(x, spec()));
        if (r.error) return setText(err, r.error);
        dlg.close();
        if (r.conflict) showConflict(ctx, r.conflict);
      }, { kind: "primary", k: "book-confirm" }),
    ],
  });
}
