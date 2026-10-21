// What the visitor can do, as pure functions of the State. Each returns the next State, plus the
// refusal or conflict when there is one, so the view can show it and the unit tests can check it.

import { admit, admitCards, type Admission } from "./admission";
import { answerFor, tokens } from "./answers";
import { defaultConfig, estimateFloor, memOf, validate, type Draft, type Problems } from "./config";
import { budget, cardsOf, CEILING, dep, GIB, cardsText, planBudget, replaceDep, resolveAlias, span, STOP_MS, util } from "./model";
import { deleteConflict, editConflict, pinConflict, plan } from "./planner";
import { logRequest, note, pushLog } from "./sim";
import type { CachedModel, Conflict, Deployment, EngineConfig, Reservation, State } from "./types";

export interface Result {
  state: State;
  refused?: Admission & { ok: false };
  conflict?: Conflict;
  error?: string;
  /** Every field a refused save has to change, for the form to mark. */
  problems?: Problems;
}

const replan = (s: State): State => {
  const reservations = plan(s);
  return reservations === s.reservations ? s : { ...s, reservations };
};

const logOn = (s: State, alias: string, level: "INFO" | "WARNING" | "ERROR", text: string): State =>
  replaceDep(s, alias, (d) => pushLog(d, { t: s.now, level, text }));

/** Marks the victims stopping and the deployment starting; a start after an eviction waits for the memory. */
function begin(s: State, alias: string, evict: string[]): State {
  let out = s;
  for (const v of evict) {
    out = replaceDep(out, v, (d) => ({ ...d, status: "Stopping", phase: { kind: "stop", at: s.now, step: 0, why: `evicted for ${alias}` } }));
    out = logOn(out, v, "INFO", `manager: evicted to make room for ${alias} (idle, lazy, least recently used)`);
  }
  const at = evict.length ? s.now + STOP_MS : s.now;
  out = replaceDep(out, alias, (d) => ({ ...d, status: "Starting", error: null, refused: null, phase: { kind: "start", at, step: 0, why: "operator" } }));
  if (evict.length) out = logOn(out, alias, "INFO", `manager: waiting for ${evict.join(", ")} to release GPU ${dep(s, alias)?.gpu}`);
  return out;
}

function refuse(s: State, alias: string, a: Admission & { ok: false }, what = "Start"): Result {
  const logged = replaceDep(logOn(s, alias, "WARNING", `manager: ${what.toLowerCase()} refused, 503: ${a.reason}`), alias, (d) => ({ ...d, refused: `503: ${a.reason}. ${a.detail}` }));
  const out = note(logged, "error", `${what} ${alias} refused, 503: ${a.reason}. ${a.detail}`);
  return { state: out, refused: a };
}

export function start(s: State, alias: string): Result {
  const d = dep(s, alias);
  if (!d || d.phase || d.status === "Running") return { state: s };
  const a = admit(s, alias);
  if (!a.ok) return refuse(s, alias, a);
  const src = d.source === "estimate" ? "estimate" : "measured";
  const out = begin(s, alias, a.evict);
  const text = a.evict.length
    ? `Evicted ${a.evict.join(", ")} (idle, lazy, least recently used) from ${cardsText(d)} to make room; starting ${alias} on ${util(budget(d))} (${src}).`
    : `Starting ${alias} on ${cardsText(d)}: admitted on ${util(budget(d))}${cardsOf(d.cfg) > 1 ? " per card" : ""} (${src}); the ${cardsOf(d.cfg) > 1 ? "fullest card's" : "card's"} budget goes ${util(a.load)} → ${util(a.after)} of ${util(CEILING)}.`;
  return { state: note(logOn(out, alias, "INFO", `manager: admitted on ${cardsText(d)}, budget ${util(budget(d))} (${src})`), "info", text) };
}

export function stop(s: State, alias: string): Result {
  const d = dep(s, alias);
  if (!d || (d.status !== "Running" && d.status !== "Starting")) return { state: s };
  const out = replaceDep(s, alias, (x) => ({ ...x, status: "Stopping", phase: { kind: "stop", at: s.now, step: 0, why: "operator" } }));
  return { state: note(out, "info", `Stopping ${alias} on GPU ${d.gpu}.`) };
}

export function restart(s: State, alias: string): Result {
  const d = dep(s, alias);
  if (!d || d.status !== "Running" || d.phase) return { state: s };
  const n = cardsOf(d.pending?.cfg ?? d.cfg);
  const a = admitCards(s, Array.from({ length: n }, (_, i) => d.gpu + i), planBudget(d), alias);
  if (!a.ok) return refuse(s, alias, a, "Restart");
  let out = s;
  for (const v of a.evict) out = replaceDep(out, v, (x) => ({ ...x, status: "Stopping", phase: { kind: "stop", at: s.now, step: 0, why: `evicted for ${alias}` } }));
  out = replaceDep(out, alias, (x) => ({ ...x, status: "Stopping", phase: { kind: "restart", at: s.now, step: 0, why: "restart" } }));
  return { state: note(out, "info", `Restarting ${alias}${d.pending ? " to apply its new parameters" : ""}.`) };
}

export function togglePin(s: State, alias: string): Result {
  const d = dep(s, alias);
  if (!d) return { state: s };
  if (d.pinned) return { state: replan(note(replaceDep(s, alias, (x) => ({ ...x, pinned: false })), "info", `Unpinned ${alias}: it may be evicted again while idle.`)) };
  const conflict = pinConflict(s, alias);
  if (conflict) return { state: note(s, "warn", `Pin on ${alias} refused, 409: conflicts with reservation ${conflict.item.name}.`), conflict };
  const out = replaceDep(s, alias, (x) => ({ ...x, pinned: true }));
  return { state: replan(note(out, "info", `Pinned ${alias}: never evicted, and the planner counts its ${util(planBudget(d))} on GPU ${d.gpu} at all times.`)) };
}

export interface Edit {
  maxLen: number;
  maxSeqs: number;
  lazy: boolean;
  /** Left out: the engine settings stay as they are. */
  cfg?: EngineConfig;
  extraAliases?: string[];
  /** A new first card; only taken while the deployment is down. */
  gpu?: number;
}

/** Settings the manager and the gateway read themselves: a running engine never needs a restart for them. */
const engineSide = (c: EngineConfig): string => JSON.stringify({ ...c, coldStartS: 0, idleMin: 0 });

/** The first problem of a set, as the one-line error the status shows. */
const first = (p: Problems): string | undefined => Object.values(p).find(Boolean);

/** Names another deployment already answers to. */
function taken(s: State, names: string[], self: string): string | undefined {
  return names.find((n) => s.deps.some((d) => d.alias !== self && (d.alias === n || d.extraAliases.includes(n))));
}

export function edit(s: State, alias: string, e: Edit): Result {
  const d = dep(s, alias);
  if (!d || d.status === "Stopping") return { state: s };
  const cfg = e.cfg ?? d.cfg;
  const extraAliases = e.extraAliases ?? d.extraAliases;
  const m = s.catalog.find((x) => x.repo === d.model);
  const live = d.status === "Running" || d.status === "Starting";
  const gpu = live ? d.gpu : (e.gpu ?? d.gpu);
  const draft: Draft = { alias, repo: d.model, gpu, maxLen: e.maxLen, maxSeqs: e.maxSeqs, lazy: e.lazy, extraAliases, cfg };
  const problems = validate(draft, m ?? { ...placeholder, maxCtx: Math.max(d.maxLen, e.maxLen), kind: d.kind }, s.gpus.length, "edit");
  const clash = taken(s, extraAliases, alias);
  if (clash) problems.extraAliases = `${clash} already reaches another deployment.`;
  if (first(problems)) return { state: s, error: first(problems), problems };
  const changed = e.maxLen !== d.maxLen || e.maxSeqs !== d.maxSeqs || engineSide(cfg) !== engineSide(d.cfg);
  const next: Deployment = live
    ? { ...d, lazy: e.lazy, extraAliases, cfg: { ...d.cfg, coldStartS: cfg.coldStartS, idleMin: cfg.idleMin }, pending: changed ? { maxLen: e.maxLen, maxSeqs: e.maxSeqs, cfg } : null }
    : { ...d, gpu, lazy: e.lazy, extraAliases, cfg, maxLen: e.maxLen, maxSeqs: e.maxSeqs, pending: null };
  const after = replaceDep(s, alias, () => next);
  const moved = gpu !== d.gpu || cardsOf(next.pending?.cfg ?? next.cfg) !== cardsOf(d.pending?.cfg ?? d.cfg);
  if (planBudget(next) > planBudget(d) || moved) {
    const conflict = editConflict(s, after, alias);
    if (conflict) return { state: note(s, "warn", `Edit of ${alias} refused, 409: conflicts with reservation ${conflict.item.name}.`), conflict };
  }
  const what = live && changed ? "restart to apply" : changed && planBudget(next) !== planBudget(d) ? `its floor is re-estimated at ${util(planBudget(next))} until the next start measures it` : "saved";
  return { state: replan(note(after, "info", `Saved ${alias}: max length ${e.maxLen}, max seqs ${e.maxSeqs}; ${what}.`)) };
}

/** Stands in for a cache entry that has gone, so an edit can still be checked. */
const placeholder: CachedModel = { repo: "", arch: "", params: "", weightsGiB: 0, maxCtx: 131072, kvPerK: 0, precision: "bf16", kind: "generate", cached: true };

export function remove(s: State, alias: string): Result {
  const d = dep(s, alias);
  if (!d) return { state: s };
  if (d.phase) return { state: note(s, "warn", `${alias} is ${d.status.toLowerCase()}; delete it once that finishes.`) };
  const conflict = deleteConflict(s, alias);
  if (conflict) return { state: note(s, "warn", `Delete of ${alias} refused, 409: reservation ${conflict.item.name} targets it.`), conflict };
  const out = { ...s, deps: s.deps.filter((x) => x.alias !== alias) };
  return { state: replan(note(out, "info", `Deleted ${alias}${d.status === "Running" ? " (stopped first, GPU " + d.gpu + " released)" : ""}.`)) };
}

export function dismissError(s: State, alias: string): Result {
  return { state: replaceDep(s, alias, (d) => ({ ...d, error: null, refused: null, status: d.status === "Error" ? "Stopped" : d.status })) };
}

export function clearErrors(s: State): Result {
  const n = s.deps.filter((d) => d.error).length;
  if (!n) return { state: s };
  const out = { ...s, deps: s.deps.map((d) => (d.error ? { ...d, error: null, status: d.status === "Error" ? ("Stopped" as const) : d.status } : d)) };
  return { state: note(out, "info", `Cleared ${n} error${n === 1 ? "" : "s"}.`) };
}

export function block(s: State, gpu: number, reason: string): Result {
  const r = reason.trim() || "maintenance";
  const out = { ...s, gpus: s.gpus.map((g) => (g.index === gpu ? { ...g, blocked: r } : g)) };
  return { state: note(out, "warn", `GPU ${gpu} blocked for new loads: ${r}. What runs there keeps running.`) };
}

export function unblock(s: State, gpu: number): Result {
  const out = { ...s, gpus: s.gpus.map((g) => (g.index === gpu ? { ...g, blocked: null } : g)) };
  return { state: note(out, "info", `GPU ${gpu} accepts new loads again.`) };
}

// ---------- new deployments ----------

/** The floor a new deployment is admitted on until its first start measures it. */
export const estimate = (m: CachedModel, maxLen: number, cfg: EngineConfig = defaultConfig()): number => estimateFloor(m, maxLen, cfg);

export interface NewDeployment {
  alias: string;
  repo: string;
  gpu: number;
  maxLen: number;
  maxSeqs: number;
  lazy: boolean;
  /** Left out: the defaults. */
  cfg?: EngineConfig;
  extraAliases?: string[];
}

export function create(s: State, n: NewDeployment): Result {
  const alias = n.alias.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,39}$/.test(alias)) return { state: s, error: "An alias is 2 to 40 characters: lower-case letters, digits, dots and dashes.", problems: { alias: "2 to 40 characters: lower-case letters, digits, dots and dashes." } };
  if (resolveAlias(s, alias)) return { state: s, error: `${alias} is taken.`, problems: { alias: `${alias} is taken.` } };
  const m = s.catalog.find((c) => c.repo === n.repo && c.cached);
  if (!m) return { state: s, error: "Pick a model from the cache.", problems: { repo: "Pick a model from the cache." } };
  if (!Number.isInteger(n.maxSeqs) || n.maxSeqs < 1 || n.maxSeqs > 1024) return { state: s, error: "Max seqs must be a whole number from 1 to 1024.", problems: { maxSeqs: "Max seqs must be a whole number from 1 to 1024." } };
  const cfg = n.cfg ?? defaultConfig();
  const extraAliases = n.extraAliases ?? [];
  const problems = validate({ ...n, alias, cfg, extraAliases }, m, s.gpus.length);
  const clash = taken(s, extraAliases, alias);
  if (clash) problems.extraAliases = `${clash} already reaches another deployment.`;
  if (first(problems)) return { state: s, error: first(problems), problems };
  const est = cfg.memUtil ?? estimate(m, n.maxLen, cfg);
  const d: Deployment = {
    alias, model: m.repo, gpu: n.gpu, kind: m.kind, status: "Stopped", pinned: false, lazy: n.lazy,
    minUtil: est, source: "estimate", profileLen: n.maxLen, profileCfg: cfg, cfg, mem: memOf(m), drift: 0.03, maxLen: n.maxLen, maxSeqs: n.maxSeqs,
    kvTokens: null, kvLen: n.maxLen, pending: null, extraAliases, error: null, refused: null, lastUsed: s.now, phase: null, log: [], load: 0.3,
  };
  const where = cardsOf(cfg) > 1 ? `GPU ${n.gpu}–${n.gpu + cardsOf(cfg) - 1}` : `GPU ${n.gpu}`;
  return { state: note({ ...s, deps: [...s.deps, d] }, "info", `Created ${alias} on ${where}, stopped, admitted on an estimate of ${util(est)}${cardsOf(cfg) > 1 ? " per card" : ""} until its first start.`) };
}

// ---------- reservations ----------

export interface Booking {
  name: string;
  alias: string;
  start: number;
  end: number;
}

export function book(s: State, b: Booking): Result & { id?: string } {
  const name = b.name.trim();
  if (!/^[a-z0-9][a-z0-9.-]{0,39}$/i.test(name)) return { state: s, error: "A name is 1 to 40 letters, digits, dots and dashes." };
  if (!dep(s, b.alias)) return { state: s, error: "Pick a deployment." };
  if (!(b.end > b.start)) return { state: s, error: "The window must end after it starts." };
  if (b.start < s.now) return { state: s, error: "The window starts in the past." };
  const id = `r${s.seq + 1}`;
  const r: Reservation = { id, name, alias: b.alias, start: b.start, end: b.end, created: s.seq + 1, status: "Scheduled", reason: null };
  const out = replan({ ...s, seq: s.seq + 1, reservations: [...s.reservations, r] });
  const got = out.reservations.find((x) => x.id === id) ?? r;
  const text =
    got.status === "Unfulfillable"
      ? `Booked ${name} for ${b.alias} (${span(b.start, b.end)}), but it is Unfulfillable. ${got.reason ?? ""}`
      : `Booked ${name} for ${b.alias} (${span(b.start, b.end)}): the planner holds GPU ${dep(s, b.alias)?.gpu} for it.`;
  return { state: note(out, got.status === "Unfulfillable" ? "warn" : "info", text), id };
}

export function unbook(s: State, id: string): Result {
  const r = s.reservations.find((x) => x.id === id);
  if (!r) return { state: s };
  return { state: replan(note({ ...s, reservations: s.reservations.filter((x) => x.id !== id) }, "info", `Deleted reservation ${r.name}.`)) };
}

// ---------- downloads ----------

const hash = (t: string): number => [...t].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function download(s: State, repo: string): Result {
  const name = repo.trim();
  if (!/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(name)) return { state: s, error: "Use org/model, for example Qwen/Qwen3-8B." };
  if (s.downloads.some((d) => d.repo === name && d.state === "running")) return { state: s, error: `${name} is already downloading.` };
  if (s.catalog.some((m) => m.repo === name && m.cached)) return { state: s, error: `${name} is already in the cache.` };
  const known = s.catalog.find((m) => m.repo === name);
  const h = hash(name);
  const finalBytes = (known ? known.weightsGiB : 2 + (h % 3800) / 100) * GIB;
  const id = `d${s.seq + 1}`;
  const d = { id, repo: name, state: "running" as const, bytes: 0, total: finalBytes, finalBytes, speed: (120 + (h % 70)) * 1024 ** 2, error: null };
  return { state: note({ ...s, seq: s.seq + 1, downloads: [d, ...s.downloads] }, "info", `Downloading ${name} into the model cache.`) };
}

export function cancelDownload(s: State, id: string): Result {
  const d = s.downloads.find((x) => x.id === id);
  if (!d || d.state !== "running") return { state: s };
  return { state: note({ ...s, downloads: s.downloads.map((x) => (x.id === id ? { ...x, state: "cancelled" as const } : x)) }, "info", `Cancelled ${d.repo}; the bytes on disk stay for a resume.`) };
}

// ---------- the playground, through the gateway ----------

export function send(s: State, name: string, prompt: string, calm = false): Result {
  if (s.stream && (s.stream.phase === "cold" || s.stream.phase === "streaming")) return { state: s, error: "A request is still streaming." };
  const text = prompt.trim();
  if (!text) return { state: s, error: "Write a prompt first." };
  const d = resolveAlias(s, name);
  if (!d) return { state: s, error: "Pick a deployment." };
  const embed = d.kind === "embed";
  const path = embed ? "/v1/embeddings" : "/v1/chat/completions";
  const base = {
    id: `p${s.seq + 1}`, alias: d.alias, path, prompt: text, tokens: embed ? ["embedding · 4096 dims"] : tokens(answerFor(text)),
    t0: s.now, cold: false, streamStart: null, shown: 0, tokenMs: calm || embed ? 0 : 45, status: null, error: null, endedAt: null,
  };
  let out: State = { ...s, seq: s.seq + 1 };
  if (d.status === "Running") return { state: { ...out, stream: { ...base, phase: "streaming", streamStart: s.now + (embed ? 60 : 280) } } };
  if (d.status === "Starting") return { state: { ...out, stream: { ...base, phase: "cold", cold: true } } };
  const fail = (reason: string, from: State): Result => {
    const error = `{"error":{"code":503,"message":"${reason}"}}`;
    const st = { ...base, phase: "failed" as const, cold: true, status: 503, error, endedAt: s.now };
    return { state: logRequest({ ...from, stream: st }, { t: s.now, alias: d.alias, path, status: 503, ms: 14, cold: true, prompt: text, output: error }) };
  };
  if (d.status === "Stopping") return fail(`${d.alias} is stopping; retry in a moment`, out);
  const r = start(out, d.alias);
  if (r.refused) return { ...fail(r.refused.reason, r.state), refused: r.refused };
  out = note(r.state, "info", `The gateway is cold-starting ${d.alias} for your request and keeps the stream alive meanwhile.`);
  return { state: { ...out, stream: { ...base, phase: "cold", cold: true } } };
}
