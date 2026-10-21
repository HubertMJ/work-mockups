// Admission control: may a deployment start on its card now? Each card is a budget of memory floors
// against the 0.95 ceiling, one start at a time. A start that does not fit first evicts idle lazy
// instances, least recently used first; pinned and reserved ones never go. If it would not fit even
// then, it is refused before anything is stopped.

import { budget, CEILING, isResident, util } from "./model";
import type { Deployment, State } from "./types";

export type Admission =
  | { ok: true; evict: string[]; load: number; after: number }
  | { ok: false; code: 503; reason: string; detail: string; evictable: number };

/** Inside the window of an Active reservation right now. */
export const reservedNow = (s: State, alias: string, now = s.now): boolean =>
  s.reservations.some((r) => r.alias === alias && r.start <= now && now < r.end);

/** Serving a request right now (the playground's stream). */
const busy = (s: State, alias: string): boolean => !!s.stream && s.stream.alias === alias && (s.stream.phase === "cold" || s.stream.phase === "streaming");

/** What admission may stop on a card, in the order it would: idle lazy instances, least recently used first. */
export function evictable(s: State, gpu: number, except?: string): Deployment[] {
  return s.deps
    .filter((d) => d.gpu === gpu && d.alias !== except && d.status === "Running" && d.lazy && !d.pinned && !reservedNow(s, d.alias) && !busy(s, d.alias))
    .sort((a, b) => a.lastUsed - b.lastUsed);
}

const why = (s: State, d: Deployment): string =>
  d.pinned ? "pinned" : reservedNow(s, d.alias) ? "reserved now" : !d.lazy ? "not lazy" : d.status !== "Running" ? d.status.toLowerCase() : busy(s, d.alias) ? "serving" : "idle";

/** May `need` of card `gpu` be admitted now? `except` is the deployment asking (its own budget is not counted twice). */
export function admitOnCard(s: State, gpu: number, need: number, except?: string): Admission {
  const card = s.gpus[gpu];
  if (card.blocked) return { ok: false, code: 503, reason: `GPU ${gpu} is blocked for new loads`, detail: `Blocked by the operator: ${card.blocked}. Allow loads again to start here.`, evictable: 0 };
  const starting = s.deps.find((d) => d.gpu === gpu && d.status === "Starting" && d.alias !== except);
  if (starting) return { ok: false, code: 503, reason: `GPU ${gpu} has a start in progress`, detail: `${starting.alias} is starting; one start at a time per card. Retry when it is up.`, evictable: 0 };
  const residents = s.deps.filter((d) => d.gpu === gpu && d.alias !== except && isResident(d));
  const load = residents.reduce((n, d) => n + budget(d), 0);
  if (load + need <= CEILING + 1e-9) return { ok: true, evict: [], load, after: load + need };
  const cand = evictable(s, gpu, except);
  const evict: string[] = [];
  let left = load;
  for (const d of cand) {
    evict.push(d.alias);
    left -= budget(d);
    if (left + need <= CEILING + 1e-9) return { ok: true, evict, load, after: left + need };
  }
  const held = residents.filter((d) => !cand.includes(d));
  const parts = held.map((d) => `${d.alias} ${util(budget(d))} (${why(s, d)})`).join(" + ");
  return {
    ok: false,
    code: 503,
    reason: `would not fit even after evicting ${cand.length}`,
    detail: `GPU ${gpu} would need ${util(left + need)} of its ${util(CEILING)} ceiling: ${parts ? `${parts} + ` : ""}${util(need)} for this start. Nothing was stopped.`,
    evictable: cand.length,
  };
}

/** Admission for a deployment's own start. */
export function admit(s: State, alias: string): Admission {
  const d = s.deps.find((x) => x.alias === alias);
  if (!d) return { ok: false, code: 503, reason: "no such deployment", detail: alias, evictable: 0 };
  return admitOnCard(s, d.gpu, budget(d), d.alias);
}
