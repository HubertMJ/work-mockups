// The reservation planner: one interval check for every promise. A booking holds when, at every
// moment of its window, its card can carry the pinned deployments, the deployments of earlier
// bookings that overlap, and its own deployment under the ceiling. Pins, memory-affecting edits and
// deletes go through the same check and are refused (409) with the booking they would break.

import { CEILING, dep, planBudget, replaceDep, span, util, dayHm } from "./model";
import type { Conflict, Deployment, Reservation, State } from "./types";

interface Part {
  alias: string;
  util: number;
  why: string;
}
export type Fit = { ok: true } | { ok: false; at: number; gpu: number; need: number; parts: Part[] };

/** Does `d` fit its card over [start, end) next to the bookings already admitted? */
export function fitWindow(s: State, admitted: Reservation[], d: Deployment, start: number, end: number): Fit {
  const onCard = (r: Reservation): boolean => dep(s, r.alias)?.gpu === d.gpu && r.alias !== d.alias;
  const others = admitted.filter((r) => r.end > start && r.start < end && onCard(r));
  const points = [start, ...others.map((r) => r.start).filter((t) => t > start && t < end)];
  for (const t of points) {
    const parts = new Map<string, Part>();
    for (const p of s.deps) if (p.gpu === d.gpu && p.pinned && p.alias !== d.alias) parts.set(p.alias, { alias: p.alias, util: planBudget(p), why: "pinned" });
    for (const r of others) {
      const p = dep(s, r.alias);
      if (p && r.start <= t && t < r.end && !parts.has(p.alias)) parts.set(p.alias, { alias: p.alias, util: planBudget(p), why: `reservation ${r.name}` });
    }
    parts.set(d.alias, { alias: d.alias, util: planBudget(d), why: d.source === "estimate" ? "this booking, estimate" : "this booking" });
    const list = [...parts.values()];
    const need = list.reduce((n, p) => n + p.util, 0);
    if (need > CEILING + 1e-9) return { ok: false, at: t, gpu: d.gpu, need, parts: list };
  }
  return { ok: true };
}

export function describe(f: Exclude<Fit, { ok: true }>): string {
  const parts = f.parts.map((p) => `${p.alias} ${util(p.util)} (${p.why})`).join(" + ");
  return `At ${dayHm(f.at)} GPU ${f.gpu} would need ${util(f.need)} of its ${util(CEILING)} ceiling: ${parts}.`;
}

/** Every booking's status, in admission order. Returns the same array when nothing changed. */
export function plan(s: State): Reservation[] {
  const admitted: Reservation[] = [];
  const next = new Map<string, Reservation>();
  for (const r of [...s.reservations].sort((a, b) => a.created - b.created)) {
    let status: Reservation["status"];
    let reason: string | null = null;
    const d = dep(s, r.alias);
    if (r.end <= s.now) status = "Completed";
    else if (r.start <= s.now) status = "Active";
    else if (!d) {
      status = "Unfulfillable";
      reason = `${r.alias} no longer exists.`;
    } else {
      const f = fitWindow(s, admitted, d, r.start, r.end);
      status = f.ok ? "Scheduled" : "Unfulfillable";
      if (!f.ok) reason = describe(f);
    }
    if (status === "Active" || status === "Scheduled") admitted.push(r);
    next.set(r.id, status === r.status && reason === r.reason ? r : { ...r, status, reason });
  }
  const out = s.reservations.map((r) => next.get(r.id) ?? r);
  return out.every((r, i) => r === s.reservations[i]) ? s.reservations : out;
}

/** Bookings on a deployment that have not ended, soonest first. */
export const bookings = (s: State, alias: string): Reservation[] =>
  s.reservations.filter((r) => r.alias === alias && r.end > s.now).sort((a, b) => a.start - b.start);

/** The first booking a change would break: one that holds now and would not after. */
export function wouldBreak(before: State, after: State): Reservation | null {
  for (const r of plan(after)) {
    const was = before.reservations.find((x) => x.id === r.id);
    if (was && (was.status === "Scheduled" || was.status === "Active") && r.status === "Unfulfillable") return r;
  }
  return null;
}

export function pinConflict(s: State, alias: string): Conflict | null {
  const d = dep(s, alias);
  if (!d || d.pinned) return null; // unpinning never breaks a promise
  const own = bookings(s, alias).find((r) => r.start > s.now);
  if (own)
    return {
      action: `Pin ${alias}`,
      message: `Pinning ${alias} on GPU ${d.gpu} would keep its ${util(planBudget(d))} on the card outside reservation ${own.name} (${span(own.start, own.end)}), and the planner booked GPU ${d.gpu} around that window.`,
      remedy: `Delete or move the reservation, or pin ${alias} after it ends.`,
      item: own,
    };
  const broke = wouldBreak(s, replaceDep(s, alias, (x) => ({ ...x, pinned: true })));
  if (broke)
    return {
      action: `Pin ${alias}`,
      message: `Pinning ${alias} keeps its ${util(planBudget(d))} on GPU ${d.gpu} for good, which leaves no room for reservation ${broke.name} (${span(broke.start, broke.end)}). ${broke.reason ?? ""}`.trim(),
      remedy: "Delete or move that reservation, or pin a smaller deployment.",
      item: broke,
    };
  return null;
}

export function deleteConflict(s: State, alias: string): Conflict | null {
  const r = bookings(s, alias)[0];
  if (!r) return null;
  return {
    action: `Delete ${alias}`,
    message: `Reservation ${r.name} (${span(r.start, r.end)}) targets ${alias}; deleting the deployment would break that booking.`,
    remedy: "Delete the reservation first, or wait until it has completed.",
    item: r,
  };
}

/** An edit that raises the memory floor, checked against every booking it could crowd out. */
export function editConflict(before: State, after: State, alias: string): Conflict | null {
  const broke = wouldBreak(before, after);
  const d = dep(after, alias);
  if (!broke || !d) return null;
  return {
    action: `Edit ${alias}`,
    message: `The new max length raises ${alias}'s floor to ${util(planBudget(d))}, which leaves no room for reservation ${broke.name} (${span(broke.start, broke.end)}). ${broke.reason ?? ""}`.trim(),
    remedy: "Keep the current max length, or delete or move that reservation first.",
    item: broke,
  };
}
