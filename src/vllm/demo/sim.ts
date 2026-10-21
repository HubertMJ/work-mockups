// Time in the demo: tick() moves the State to `now`. Starts and stops follow a scripted engine log
// (ready when the log says so, measured from the same lines), the playground's stream advances token
// by token, and once a second the telemetry takes a sample and downloads move on.

import { plan } from "./planner";
import { budget, CARD_GIB, dep, GIB, isResident, isStale, replaceDep, round2, slug, START_MS, STOP_MS, util, VISITOR_IP } from "./model";
import type { Deployment, Level, LogLine, Phase, Req, State } from "./types";

export const HISTORY = 180;

interface Step {
  at: number;
  level: Level;
  text: (d: Deployment) => string;
  /** The step that changes the deployment itself (ready, stopped, parameters applied). */
  effect?: (d: Deployment, now: number) => Deployment;
}

/** What the engine will report on this start: the estimate is replaced by the measurement. */
export function measured(d: Deployment): number {
  return round2(budget(d) + (d.source === "estimate" ? d.drift : 0));
}
const kvAfter = (d: Deployment): number | null =>
  d.kind === "embed" ? null : d.kvTokens ?? Math.round((Math.min(16, Math.max(2, d.maxSeqs / 4)) * d.maxLen) / 1000) * 1000;
const weights = (d: Deployment): number => measured(d) * CARD_GIB * (d.kind === "embed" ? 0.88 : 0.8);

const finishStart = (d: Deployment, now: number): Deployment => ({
  ...d,
  status: "Running",
  minUtil: measured(d),
  source: "engine-log",
  profileLen: d.maxLen,
  kvTokens: kvAfter(d),
  kvLen: d.maxLen,
  error: null,
  phase: null,
  lastUsed: now,
});

const START: Step[] = [
  { at: 0, level: "INFO", text: (d) => `manager: creating container vllm-${slug(d.alias)} on GPU ${d.gpu}, model cache mounted read-only` },
  { at: 450, level: "INFO", text: (d) => `vLLM API server: model=${d.model} max_model_len=${d.maxLen} max_num_seqs=${d.maxSeqs}` },
  { at: 1000, level: "INFO", text: () => "Loading safetensors checkpoint shards: 100% completed" },
  { at: 1700, level: "INFO", text: (d) => `Model loading took ${weights(d).toFixed(2)} GiB and ${(weights(d) / 6.5).toFixed(1)} seconds` },
  {
    at: 2400,
    level: "INFO",
    text: (d) => `Memory profiling: weights ${weights(d).toFixed(2)} GiB, KV cache ${(measured(d) * CARD_GIB - weights(d) - 1.2).toFixed(2)} GiB, peak activation 1.20 GiB`,
  },
  {
    at: 2900,
    level: "INFO",
    text: (d) => {
      const kv = kvAfter(d);
      return kv === null ? "Pooling model: no KV cache for generation" : `KV cache: ${kv.toLocaleString("en-US")} tokens; maximum concurrency for ${d.maxLen} tokens per request: ${(kv / d.maxLen).toFixed(2)}x`;
    },
  },
  {
    at: 3000,
    level: "WARNING",
    text: (d) => {
      const kv = kvAfter(d);
      return kv !== null && d.maxSeqs > kv / d.maxLen ? `max_num_seqs=${d.maxSeqs} exceeds what the KV cache holds at full length; long requests will queue` : "";
    },
  },
  { at: START_MS - 100, level: "INFO", text: () => "Application startup complete." },
  { at: START_MS, level: "INFO", text: (d) => `manager: ready from the log; measured minUtil ${util(measured(d))} (engine log)${d.source === "estimate" || isStale(d) ? `, was ${util(budget(d))} (${isStale(d) ? "stale, re-estimated" : "estimate"})` : ""}`, effect: finishStart },
];

const STOP: Step[] = [
  { at: 0, level: "INFO", text: (d) => `manager: stopping vllm-${slug(d.alias)}` },
  { at: 500, level: "INFO", text: () => "Shutting down the engine; no requests in flight" },
  {
    at: STOP_MS,
    level: "INFO",
    text: (d) => `manager: container removed; GPU ${d.gpu} budget ${util(budget(d))} released`,
    effect: (d) => ({ ...d, status: "Stopped", phase: null }),
  },
];

const RESTART: Step[] = [
  ...STOP.slice(0, -1),
  {
    at: STOP_MS,
    level: "INFO",
    text: (d) => `manager: container removed${d.pending ? `; applying max_model_len=${d.pending.maxLen} max_num_seqs=${d.pending.maxSeqs}` : ""}`,
    effect: (d) => (d.pending ? { ...d, status: "Starting", maxLen: d.pending.maxLen, maxSeqs: d.pending.maxSeqs, pending: null } : { ...d, status: "Starting" }),
  },
  ...START.map((s) => ({ ...s, at: s.at + STOP_MS })),
];

const SCRIPTS: Record<Phase["kind"], Step[]> = { start: START, stop: STOP, restart: RESTART };

/** The lines a start writes, all at once: the seeded deployments' history. */
export function startupLog(d: Deployment, t: number): LogLine[] {
  return START.map((s) => ({ t: t + s.at, level: s.level, text: s.text(d) })).filter((l) => l.text);
}

export function pushLog(d: Deployment, line: LogLine): Deployment {
  return { ...d, log: [...d.log, line].slice(-200) };
}

/** Memory a card holds right now, GiB: the floors of what runs, ramping while it loads or unloads. */
export function usedGiB(s: State, gpu: number): number {
  let n = 0;
  for (const d of s.deps) {
    if (d.gpu !== gpu || !isResident(d)) continue;
    const full = budget(d) * CARD_GIB;
    const p = d.phase;
    if (!p) n += d.minUtil * CARD_GIB;
    else {
      const e = Math.max(0, s.now - p.at);
      const down = (x: number): number => full * Math.max(0, 1 - x / STOP_MS);
      const up = (x: number): number => full * Math.min(1, Math.max(0, x) / START_MS);
      if (p.kind === "stop") n += down(e);
      else if (p.kind === "start") n += s.now < p.at ? 0 : up(e);
      else n += e < STOP_MS ? down(e) : up(e - STOP_MS);
    }
  }
  return n;
}

/** Budget a card has promised: what runs, plus the full floor of whatever is starting. */
export function budgetOn(s: State, gpu: number): number {
  return s.deps.filter((d) => d.gpu === gpu && isResident(d)).reduce((n, d) => n + budget(d), 0);
}

function advanceDeps(s: State, now: number): State {
  let out = s;
  for (const d0 of s.deps) {
    if (!d0.phase) continue;
    const script = SCRIPTS[d0.phase.kind];
    let d = d0;
    const phase = d0.phase;
    let step = phase.step;
    while (step < script.length && now >= phase.at + script[step].at) {
      const st = script[step];
      const text = st.text(d);
      if (text) d = pushLog(d, { t: phase.at + st.at, level: st.level, text });
      step++;
      if (st.effect) {
        const before = d;
        d = st.effect(d, now);
        if (before.status === "Starting" && d.status === "Running") {
          const was = before.source === "estimate" || isStale(before) ? `, was ${util(budget(before))} (${isStale(before) ? "stale, re-estimated" : "estimate"})` : "";
          const msg = `${d.alias} is running on GPU ${d.gpu}: measured ${util(d.minUtil)} from the engine log${was}.`;
          out = note(out, "info", msg);
        } else if (before.status === "Stopping" && d.status === "Stopped") out = note(out, "info", `${d.alias} stopped; GPU ${d.gpu} released ${util(budget(d))}.`);
      }
    }
    if (d.phase) d = step >= script.length ? { ...d, phase: null } : { ...d, phase: { ...phase, step } };
    if (d !== d0) out = replaceDep(out, d.alias, () => d);
  }
  return out;
}

export function note(s: State, level: "info" | "warn" | "error", text: string): State {
  const id = s.seq + 1;
  return { ...s, seq: id, notice: { id, level, text }, events: [{ t: s.now, level, text }, ...s.events].slice(0, 40) };
}

export function logRequest(s: State, r: Omit<Req, "id" | "ip">): State {
  const id = s.seq + 1;
  const req: Req = { ...r, id: `q${id}`, ip: VISITOR_IP };
  return replaceDep({ ...s, seq: id, requests: [req, ...s.requests].slice(0, 200) }, r.alias, (d) => ({ ...d, lastUsed: s.now }));
}

function advanceStream(s: State, now: number): State {
  const st = s.stream;
  if (!st || st.phase === "done" || st.phase === "failed") return s;
  const d = dep(s, st.alias);
  if (st.phase === "cold") {
    if (d?.status === "Running") return { ...s, stream: { ...st, phase: "streaming", streamStart: now } };
    if (!d || ((d.status === "Stopped" || d.status === "Error") && !d.phase)) {
      const error = `{"error":{"code":503,"message":"${st.alias} did not come up"}}`;
      const out = { ...s, stream: { ...st, phase: "failed" as const, status: 503, error, endedAt: now } };
      return logRequest(out, { t: st.t0, alias: st.alias, path: st.path, status: 503, ms: now - st.t0, cold: true, prompt: st.prompt, output: error });
    }
    return s;
  }
  const start = st.streamStart ?? now;
  const shown = st.tokenMs ? Math.min(st.tokens.length, Math.max(0, Math.floor((now - start) / st.tokenMs))) : now >= start ? st.tokens.length : 0;
  if (shown < st.tokens.length) return shown === st.shown ? s : { ...s, stream: { ...st, shown } };
  const done = { ...s, stream: { ...st, shown, phase: "done" as const, status: 200, endedAt: now } };
  return logRequest(done, { t: st.t0, alias: st.alias, path: st.path, status: 200, ms: now - st.t0, cold: st.cold, prompt: st.prompt, output: st.tokens.join("") });
}

/** One telemetry sample for card `g`: utilization %, memory GiB, temperature °C. */
export function sample(s: State, g: number, prevUtil: number, prevTemp: number, r: () => number): [number, number, number] {
  let target = 0;
  for (const d of s.deps) {
    if (d.gpu !== g) continue;
    if (d.status === "Running") target += d.load * (0.88 + 0.24 * r());
    else if (d.status === "Starting" || d.status === "Stopping") target += 0.22;
  }
  if (s.stream?.phase === "streaming" && dep(s, s.stream.alias)?.gpu === g) target += 0.35;
  const noise = (r() - 0.5) * 2;
  const u = Math.min(100, Math.max(0, prevUtil * 0.8 + Math.min(1, target) * 100 * 0.2 + (target > 0 ? noise : 0)));
  const temp = prevTemp + (36 + 0.36 * u - prevTemp) * 0.12 + (r() - 0.5) * 0.3;
  return [Math.round(u * 10) / 10, Math.round(usedGiB(s, g) * 10) / 10, Math.round(temp * 10) / 10];
}

function sampleAll(s: State, at: number, r: () => number): State {
  const t = s.telemetry;
  const util: number[][] = [];
  const vram: number[][] = [];
  const temp: number[][] = [];
  for (const g of s.gpus) {
    const u0 = t.util[g.index].at(-1) ?? 0;
    const t0 = t.temp[g.index].at(-1) ?? 36;
    const [u, v, c] = sample(s, g.index, u0, t0, r);
    util.push([...t.util[g.index], u].slice(-HISTORY));
    vram.push([...t.vram[g.index], v].slice(-HISTORY));
    temp.push([...t.temp[g.index], c].slice(-HISTORY));
  }
  return { ...s, telemetry: { at, util, vram, temp } };
}

function advanceDownloads(s: State, dt: number, r: () => number): State {
  if (!s.downloads.some((d) => d.state === "running")) return s;
  let out = s;
  const downloads = s.downloads.map((d) => {
    if (d.state !== "running") return d;
    const bytes = Math.min(d.finalBytes, d.bytes + (d.speed * dt) / 1000);
    const speed = d.speed * (0.97 + 0.06 * r());
    if (bytes < d.finalBytes) return { ...d, bytes, speed };
    out = note(out, "info", `Download complete: ${d.repo} (${(d.finalBytes / GIB).toFixed(1)} GiB) is in the model cache.`);
    out = { ...out, catalog: out.catalog.map((m) => (m.repo === d.repo ? { ...m, cached: true } : m)) };
    return { ...d, bytes, total: d.finalBytes, state: "completed" as const };
  });
  return { ...out, downloads };
}

/** True while something moves faster than once a second: a start, a stop or a streaming answer. */
export function busy(s: State): boolean {
  return s.deps.some((d) => d.phase) || (!!s.stream && (s.stream.phase === "cold" || s.stream.phase === "streaming"));
}

export function tick(s0: State, now: number, r: () => number): State {
  let s: State = { ...s0, now };
  s = advanceDeps(s, now);
  s = advanceStream(s, now);
  if (now - s.telemetry.at >= 1000) {
    const dt = Math.min(now - s.telemetry.at, 5000);
    s = advanceDownloads(s, dt, r);
    s = sampleAll(s, now, r);
  }
  const reservations = plan(s);
  return reservations === s.reservations ? s : { ...s, reservations };
}

