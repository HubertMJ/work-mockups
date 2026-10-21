// Constants and small pure helpers shared by the planner, admission and the views.

import type { Deployment, State } from "./types";

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

/** True when the profile was taken at another max length than the one configured now. */
export const isStale = (d: Deployment): boolean => d.source !== "estimate" && d.profileLen !== d.maxLen;

/** What admission and the planner count for a deployment: its floor, re-estimated when stale. */
export function budget(d: Deployment): number {
  return isStale(d) ? utilAt(d.minUtil, d.profileLen, d.maxLen) : d.minUtil;
}

/** The budget a future window needs: edits a running engine has not applied yet count already. */
export function planBudget(d: Deployment): number {
  return d.pending ? utilAt(d.minUtil, d.profileLen, d.pending.maxLen) : budget(d);
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
