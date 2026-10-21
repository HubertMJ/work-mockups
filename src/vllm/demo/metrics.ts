// Telemetry, as the manager samples it once a second: every card's sensors, the host's, and what each
// engine's /metrics endpoint reports. The values are made up but follow what runs in the demo: a start
// reads weights from disk and fills its cards, load moves utilization, power, clocks and heat, and an
// engine's throughput, latencies, queue and KV cache follow its traffic and its settings.

import { CATALOG } from "./catalog";
import { budget, CARD_GIB, cardsOf, GIB, isResident, MIB, onCard, STOP_MS, START_MS } from "./model";
import type { Deployment, EngineSeries, CardSeries, HostSeries, Series, State, Telemetry } from "./types";

/** Samples at 1 s kept for the short view: three minutes. */
export const HISTORY = 180;
/** Coarse points kept: 15 s averages over an hour. */
export const COARSE = 240;
export const COARSE_EVERY = 15;
export const POWER_LIMIT_W = 600;
export const HOST_RAM_GIB = 512;
export const HOST_THREADS = 128;
export const CACHE_VOLUME_GIB = 560;

export const GPU_KEYS = ["util", "vram", "temp", "power", "sm", "memClock", "fan"] as const;
export const HOST_KEYS = ["cpu", "cpuTemp", "ram", "load", "diskRead", "diskWrite", "netRx"] as const;
export const ENGINE_KEYS = ["reqRate", "promptTps", "genTps", "ttft50", "ttft95", "itl50", "itl95", "e2e50", "e2e95", "running", "waiting", "kvUsage", "prefixHit", "preempt", "accept"] as const;
type GpuR = Record<(typeof GPU_KEYS)[number], number>;
type HostR = Record<(typeof HOST_KEYS)[number], number>;
export type EngineR = Record<(typeof ENGINE_KEYS)[number], number>;

export interface Readings {
  gpus: GpuR[];
  host: HostR;
  engines: Record<string, EngineR>;
}

const series = (): Series => ({ fine: [], coarse: [] });
const group = <K extends string>(keys: readonly K[]): Record<K, Series> => Object.fromEntries(keys.map((k) => [k, series()])) as Record<K, Series>;

export function emptyTelemetry(gpus: number, at: number): Telemetry {
  return { at, n: 0, gpus: Array.from({ length: gpus }, () => group(GPU_KEYS) as CardSeries), host: group(HOST_KEYS) as HostSeries, engines: {}, preemptTotal: {} };
}

/** The newest value of a series, or `or` before the first sample. */
export const last = (s: Series | undefined, or = 0): number => s?.fine.at(-1) ?? s?.coarse.at(-1) ?? or;

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function pushed(s: Series, v: number, close: boolean): Series {
  const fine = s.fine.length >= HISTORY ? [...s.fine.slice(1 - HISTORY), v] : [...s.fine, v];
  if (!close) return { fine, coarse: s.coarse };
  const point = r1(avg(fine.slice(-COARSE_EVERY)));
  return { fine, coarse: s.coarse.length >= COARSE ? [...s.coarse.slice(1 - COARSE), point] : [...s.coarse, point] };
}

function pushAll<K extends string>(g: Record<K, Series>, r: Record<K, number>, close: boolean): Record<K, Series> {
  const out = {} as Record<K, Series>;
  for (const k of Object.keys(g) as K[]) out[k] = pushed(g[k], r[k], close);
  return out;
}

/** Adds one sample at `at`: a new State-ready Telemetry, nothing mutated. */
export function record(t: Telemetry, rd: Readings, at: number, deps: Deployment[]): Telemetry {
  const n = t.n + 1;
  const close = n % COARSE_EVERY === 0;
  const engines: Record<string, EngineSeries> = {};
  const preemptTotal: Record<string, number> = {};
  for (const d of deps) {
    const r = rd.engines[d.alias];
    engines[d.alias] = pushAll(t.engines[d.alias] ?? (group(ENGINE_KEYS) as EngineSeries), r, close) as EngineSeries;
    preemptTotal[d.alias] = d.status === "Running" ? (t.preemptTotal[d.alias] ?? 0) + Math.round(r.preempt) : 0;
  }
  return {
    at,
    n,
    gpus: t.gpus.map((g, i) => pushAll(g, rd.gpus[i], close) as CardSeries),
    host: pushAll(t.host, rd.host, close) as HostSeries,
    engines,
    preemptTotal,
  };
}

/** Puts a sample straight into the coarse ring: the seed's older history, built in place. */
export function recordCoarse(t: Telemetry, rd: Readings, deps: Deployment[]): void {
  t.gpus.forEach((g, i) => GPU_KEYS.forEach((k) => g[k].coarse.push(r1(rd.gpus[i][k]))));
  HOST_KEYS.forEach((k) => t.host[k].coarse.push(r1(rd.host[k])));
  for (const d of deps) {
    const e = (t.engines[d.alias] ??= group(ENGINE_KEYS) as EngineSeries);
    ENGINE_KEYS.forEach((k) => e[k].coarse.push(r1(rd.engines[d.alias][k])));
  }
}

// ---------- the simulation ----------

const hash = (t: string): number => [...t].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** How busy a deployment's clients keep it at `t`, 0 to about 1.2: its baseline load shaped by a wave of its own. */
function traffic(d: Deployment, t: number, r: () => number): number {
  const h = hash(d.alias);
  const sec = t / 1000;
  const period = 70 + (h % 110);
  const ph = ((h >>> 8) % 628) / 100;
  const x = Math.sin((2 * Math.PI * sec) / period + ph);
  const shape = h % 3 === 0 ? 0.55 + 0.45 * (x > 0.1 ? 1 : 0.15) : h % 3 === 1 ? 0.8 + 0.2 * x : 0.6 + 0.4 * Math.max(0, x) ** 3;
  return d.load * shape * (0.9 + 0.2 * r());
}

const ZERO_ENGINE: EngineR = Object.fromEntries(ENGINE_KEYS.map((k) => [k, 0])) as EngineR;
const AVG_PROMPT = 900;
const AVG_OUT = 260;
const AVG_CTX = 4200;

/** One engine's /metrics at `t`, smoothed against its previous sample. */
function engine(s: State, d: Deployment, prev: EngineSeries | undefined, t: number, r: () => number): EngineR {
  if (d.status !== "Running") return ZERO_ENGINE;
  const c = d.cfg;
  const n = cardsOf(c);
  const m = CATALOG.find((x) => x.repo === d.model);
  const weights = (m?.weightsGiB ?? d.mem.weightsGiB) * (c.quant === "bitsandbytes" ? 0.28 : c.quant === "fp8" && d.mem.precision === "bf16" ? 0.5 : 1);
  const streaming = s.stream?.phase === "streaming" && s.stream.alias === d.alias;
  const a = traffic(d, t, r);
  const ease = (k: (typeof ENGINE_KEYS)[number], v: number, keep = 0.55): number => {
    const p = prev ? last(prev[k], v) : v;
    return Math.max(0, p * keep + v * (1 - keep));
  };
  if (d.kind === "embed") {
    const rate = a * 42 + (streaming ? 1 : 0);
    const e2e = 22 + rate * 0.9 + r() * 6;
    return {
      ...ZERO_ENGINE,
      reqRate: ease("reqRate", rate), promptTps: ease("promptTps", rate * 340), running: ease("running", rate * 0.04, 0.3),
      ttft50: ease("ttft50", e2e), ttft95: ease("ttft95", e2e * 2.1), e2e50: ease("e2e50", e2e), e2e95: ease("e2e95", e2e * 2.1),
    };
  }
  const base = clamp((2400 * n) / Math.max(1, weights), 18, 160) * (c.eager ? 0.8 : 1);
  const acceptance = c.spec.method === "none" ? 0 : clamp((c.spec.method === "draft" ? 0.62 : 0.34) + (r() - 0.5) * 0.12, 0, 0.95);
  const speedup = 1 + acceptance * Math.min(c.spec.tokens, 4) * 0.35;
  const kvTok = (d.kvTokens ?? 100_000) * 1;
  const kvCap = Math.max(1, kvTok / AVG_CTX);
  const cap = Math.min(d.maxSeqs, kvCap);
  const demand = a * d.maxSeqs * 0.6 + (streaming ? 1 : 0);
  const running = Math.min(demand, cap);
  const waiting = Math.max(0, demand - cap) + (a > 0.95 ? r() * 2 : 0);
  const perSeq = (base / (1 + running / 48)) * speedup;
  const gen = running * perSeq;
  const rate = gen / AVG_OUT;
  const hit = c.prefixCaching ? clamp(0.42 + 0.14 * Math.sin(t / 47_000 + hash(d.alias)) + (r() - 0.5) * 0.06, 0, 0.95) : 0;
  const prefill = base * 55 * (c.chunkedPrefill ? 1 : 1.15);
  const ttft50 = 40 + ((AVG_PROMPT * (1 - hit)) / prefill) * 1000 + waiting * 110;
  const ttft95 = ttft50 * 2.3 + (c.chunkedPrefill ? 0 : 380);
  const itl50 = 1000 / perSeq;
  const itl95 = itl50 * (c.chunkedPrefill ? 1.5 : 2.6);
  const kvUse = clamp((running * AVG_CTX) / kvTok, 0, 1);
  const preempt = kvUse > 0.92 ? Math.max(0, demand - kvCap) * 0.08 + r() * 0.4 : 0;
  return {
    reqRate: ease("reqRate", rate), promptTps: ease("promptTps", rate * AVG_PROMPT), genTps: ease("genTps", gen),
    ttft50: ease("ttft50", ttft50), ttft95: ease("ttft95", ttft95), itl50: ease("itl50", itl50), itl95: ease("itl95", itl95),
    e2e50: ease("e2e50", ttft50 + AVG_OUT * itl50), e2e95: ease("e2e95", ttft95 + 2 * AVG_OUT * itl50 * 1.2),
    running: ease("running", running, 0.4), waiting: ease("waiting", waiting, 0.4), kvUsage: ease("kvUsage", kvUse * 100, 0.4),
    prefixHit: ease("prefixHit", hit * 100, 0.7), preempt, accept: acceptance * 100,
  };
}

/** Memory a card holds right now, GiB: the floors of what runs, ramping while it loads or unloads. */
export function usedGiB(s: State, gpu: number): number {
  let n = 0;
  for (const d of s.deps) {
    if (!onCard(d, gpu) || !isResident(d)) continue;
    const full = budget(d) * CARD_GIB;
    const p = d.phase;
    if (!p) n += full;
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

/** The model cache volume: every cached checkpoint plus what downloads have written so far, GiB. */
export function cacheUsedGiB(s: State): number {
  const cached = s.catalog.filter((m) => m.cached).reduce((n, m) => n + m.weightsGiB, 0);
  return cached + s.downloads.filter((d) => d.state !== "completed").reduce((n, d) => n + d.bytes / GIB, 0);
}

/** Everything sampled at `t`, from the previous sample in `prev` (smoothing, heat, the load average). */
export function readings(s: State, prev: Telemetry, t: number, r: () => number): Readings {
  const engines: Record<string, EngineR> = {};
  for (const d of s.deps) engines[d.alias] = engine(s, d, prev.engines[d.alias], t, r);
  const gpus = s.gpus.map((g, i): GpuR => {
    const pg = prev.gpus[i];
    let target = 0;
    for (const d of s.deps) {
      if (!onCard(d, g.index)) continue;
      if (d.status === "Running") {
        const e = engines[d.alias];
        const busy = d.kind === "embed" ? e.reqRate / 40 : e.running / Math.max(1, Math.min(d.maxSeqs, 40));
        target += Math.min(1, 0.06 + busy * 0.9) * (0.92 + 0.16 * r());
      } else if (d.status === "Starting" || d.status === "Stopping") target += 0.22;
    }
    const noise = (r() - 0.5) * 2;
    const u0 = last(pg.util);
    const u = clamp(u0 * 0.6 + Math.min(1, target) * 100 * 0.4 + (target > 0 ? noise : 0), 0, 100);
    const t0 = last(pg.temp, 36);
    const temp = t0 + (35 + 0.36 * u - t0) * 0.12 + (r() - 0.5) * 0.3;
    const vram = usedGiB(s, g.index);
    const resident = vram > 0.05;
    const power = u > 0.5 ? 72 + (u / 100) * (POWER_LIMIT_W - 72) * 0.86 + (r() - 0.5) * 14 : resident ? 88 + r() * 4 : 64 + r() * 3;
    const sm = u > 0.5 ? 1990 - u * 1.4 + (r() - 0.5) * 30 : resident ? 1065 : 345;
    return { util: r1(u), vram: r1(vram), temp: r1(temp), power: Math.round(power), sm: Math.round(sm), memClock: u > 0.5 || resident ? 2619 : 405, fan: Math.round(clamp(30 + (temp - 40) * 1.2, 30, 100)) };
  });
  const ph = prev.host;
  const downloads = s.downloads.filter((d) => d.state === "running");
  const starting = s.deps.filter((d) => d.status === "Starting" && d.phase && s.now >= d.phase.at);
  const reqs = Object.values(engines).reduce((n, e) => n + e.reqRate, 0);
  const cpu0 = last(ph.cpu, 6);
  const cpuT = clamp(4 + reqs * 0.55 + starting.length * 9 + downloads.length * 2.5, 0, 100);
  const cpu = clamp(cpu0 * 0.6 + cpuT * 0.4 + (r() - 0.5) * 1.6, 0.5, 100);
  const cpuTemp0 = last(ph.cpuTemp, 41);
  const resident = s.deps.filter(isResident);
  const ram = 88 + resident.reduce((n, d) => n + d.mem.weightsGiB * 0.08 + d.cfg.swapGiB * cardsOf(d.cfg) + d.cfg.offloadGiB * cardsOf(d.cfg), 0) + downloads.length * 6;
  const load0 = last(ph.load, 6);
  const dl = downloads.reduce((n, d) => n + d.speed, 0) / MIB;
  return {
    gpus,
    host: {
      cpu: r1(cpu),
      cpuTemp: r1(cpuTemp0 + (36 + cpu * 0.42 - cpuTemp0) * 0.1 + (r() - 0.5) * 0.2),
      ram: r1(clamp(last(ph.ram, ram) * 0.7 + ram * 0.3 + (r() - 0.5) * 0.4, 0, HOST_RAM_GIB)),
      load: Math.round((load0 + ((cpu / 100) * HOST_THREADS - load0) * 0.08) * 100) / 100,
      diskRead: Math.round(starting.length ? 4800 + r() * 900 : 18 + r() * 22),
      diskWrite: Math.round(dl + 4 + r() * 6),
      netRx: Math.round(dl * 1.02 + reqs * 0.05 + r() * 2),
    },
    engines,
  };
}

/** The load average over the last 1, 5 and 15 minutes, from the load series. */
export function loadAvg(h: HostSeries): [number, number, number] {
  const f = h.load.fine;
  const c = h.load.coarse;
  return [avg(f.slice(-60)), avg(c.slice(-20)), avg(c.slice(-60))].map((x) => Math.round(x * 100) / 100) as [number, number, number];
}

/** The highest value a series reached in the window it keeps. */
export const peak = (s: Series): number => Math.max(0, ...s.fine, ...s.coarse);

/** Samples for a chart: the fine ring for the last three minutes, the coarse one for longer views. */
export function view(s: Series, range: Range): number[] {
  if (range === "3m") return s.fine;
  return s.coarse.slice(range === "15m" ? -60 : -COARSE);
}
export type Range = "3m" | "15m" | "1h";
export const RANGES: Record<Range, { label: string; points: number; step: number }> = {
  "3m": { label: "3 min", points: HISTORY, step: 1 },
  "15m": { label: "15 min", points: 60, step: COARSE_EVERY },
  "1h": { label: "1 h", points: COARSE, step: COARSE_EVERY },
};
