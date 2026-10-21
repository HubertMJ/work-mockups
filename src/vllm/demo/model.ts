// Constants and small pure helpers shared by the planner, admission and the views.

import { draftGiB } from "./catalog";
import type { Deployment, EngineConfig, ModelMem, State } from "./types";

export const CARD_GIB = 96;
export const CEILING = 0.95;
export const START_MS = 3600;
export const STOP_MS = 1200;
export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;
/** The demo's "now" when the page loads: Wed 21 Oct 2026, 09:04:30 UTC. The clock runs on from there. */
export const SEED_NOW = Date.UTC(2026, 9, 21, 9, 4, 30);
/** Monday of the calendar's week. */
export const WEEK0 = Date.UTC(2026, 9, 19);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** The visitor, as the gateway sees them. */
export const VISITOR_IP = "192.0.2.200";

/** Mulberry32: a small seeded generator, so the page looks the same on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The floor at another max length: about 0.002 of the card per 1k tokens of context. */
export const utilAt = (util: number, fromLen: number, toLen: number): number => round2(util + ((toLen - fromLen) / 1024) * 0.002);

/** Cards a deployment holds: tensor × pipeline parallel of them, from its anchor card up. */
export const cardsOf = (c: EngineConfig): number => c.tp * c.pp;
export const cards = (d: Deployment): number[] => Array.from({ length: cardsOf(d.cfg) }, (_, i) => d.gpu + i);
export const onCard = (d: Deployment, g: number): boolean => g >= d.gpu && g < d.gpu + cardsOf(d.cfg);
export const cardsText = (d: Deployment): string => (cardsOf(d.cfg) > 1 ? `GPU ${d.gpu}–${d.gpu + cardsOf(d.cfg) - 1}` : `GPU ${d.gpu}`);

/**
 * Memory one card of a deployment holds, GiB, as the estimate sees it: its share of the weights
 * (re-quantized, minus what is offloaded to the host), the CUDA graphs, adapters, a draft model and the
 * KV cache for one request at full length. With the defaults this is the formula new deployments always used.
 */
export function floorGiB(mem: ModelMem, c: EngineConfig, maxLen: number): number {
  const n = cardsOf(c);
  const src = mem.precision === "fp8" ? 1 : 2;
  const dst = c.quant === "fp8" ? Math.min(src, 1) : c.quant === "bitsandbytes" ? 0.56 : src;
  const weights = Math.max(0, (mem.weightsGiB * (dst / src) * 1.05) / n - c.offloadGiB);
  const kv = ((maxLen / 1024) * mem.kvPerK * (c.kvDtype === "fp8" ? 0.5 : 1)) / n;
  const graphs = c.eager ? 0.6 : 1.5;
  const lora = c.lora.on ? c.lora.max * c.lora.rank * 0.004 : 0;
  const draft = c.spec.method === "draft" ? draftGiB(c.spec.draft) * 1.05 + 0.4 : 0;
  return weights + kv + graphs + lora + draft;
}

/** The settings that change what a card holds; any other edit leaves a measured profile valid. */
const memKey = (c: EngineConfig): string =>
  [c.tp, c.pp, c.kvDtype, c.quant, c.eager, c.offloadGiB, c.lora.on && `${c.lora.max}x${c.lora.rank}`, c.spec.method === "draft" && c.spec.draft].join("|");
export const sameMem = (a: EngineConfig, b: EngineConfig): boolean => memKey(a) === memKey(b);

/** True when the profile was taken at another max length, or other memory settings, than the ones configured now. */
export const isStale = (d: Deployment): boolean => d.source !== "estimate" && (d.profileLen !== d.maxLen || !sameMem(d.profileCfg, d.cfg));

/**
 * A deployment's floor under settings `c` and length `maxLen`: an explicit --gpu-memory-utilization wins;
 * otherwise the measured (or estimated) floor, moved by the length change and by what the estimate says
 * the other settings add or save.
 */
export function floorAt(d: Deployment, c: EngineConfig, maxLen: number): number {
  if (c.memUtil !== null) return c.memUtil;
  const delta = sameMem(c, d.profileCfg) ? 0 : (floorGiB(d.mem, c, maxLen) - floorGiB(d.mem, d.profileCfg, maxLen)) / CARD_GIB;
  return round2(Math.max(0.02, utilAt(d.minUtil, d.profileLen, maxLen) + delta));
}

/** What admission and the planner count for a deployment, on each of its cards: its floor, re-estimated when stale. */
export function budget(d: Deployment): number {
  return floorAt(d, d.cfg, d.maxLen);
}

/** The budget a future window needs: edits a running engine has not applied yet count already. */
export function planBudget(d: Deployment): number {
  return d.pending ? floorAt(d, d.pending.cfg, d.pending.maxLen) : budget(d);
}

/** Holding memory on its card: running, or on its way up or down. */
export const isResident = (d: Deployment): boolean => d.status === "Running" || d.status === "Starting" || d.status === "Stopping";

export const concurrency = (d: Deployment): number | null => (d.kvTokens === null ? null : d.kvTokens / d.kvLen);

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function dep(s: State, alias: string): Deployment | undefined {
  return s.deps.find((d) => d.alias === alias);
}

/** The alias a request names, with extra aliases resolved (the gateway only rewrites `model`). */
export function resolveAlias(s: State, name: string): Deployment | undefined {
  return s.deps.find((d) => d.alias === name || d.extraAliases.includes(name));
}

export function replaceDep(s: State, alias: string, f: (d: Deployment) => Deployment): State {
  return { ...s, deps: s.deps.map((d) => (d.alias === alias ? f(d) : d)) };
}

// ---------- formatting ----------
const pad = (n: number): string => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const clock = (t: number): string => new Date(t).toISOString().slice(11, 19);
export const hm = (t: number): string => new Date(t).toISOString().slice(11, 16);
export const dayHm = (t: number): string => `${DAYS[new Date(t).getUTCDay()]} ${hm(t)}`;
export const stamp = (t: number): string => new Date(t).toISOString().slice(0, 19).replace("T", " ");
export const iso = (t: number): string => `${new Date(t).toISOString().slice(0, 19)}Z`;
export const span = (s: number, e: number): string => `${dayHm(s)} – ${dayHm(e)}`;
export const gib = (bytes: number): string => `${(bytes / GIB).toFixed(1)} GiB`;
export const ms = (n: number): string => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
export const util = (u: number): string => u.toFixed(2);
export const int = (n: number): string => Math.round(n).toLocaleString("en-US");
export const day = (t: number): string => `${DAYS[new Date(t).getUTCDay()]} ${new Date(t).getUTCDate()}`;
export const hours = (n: number): string => `${pad(n)}:00`;
