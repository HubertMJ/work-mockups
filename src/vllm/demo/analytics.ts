// The Analytics tab's numbers: computed from the request ring (the seeded background plus what the
// visitor sent in this session), never stored.

import type { Req } from "./types";

export interface Stats {
  requests: number;
  ok: number;
  errors: number;
  successPct: number;
  avgMs: number;
  p95Ms: number;
  cold: number;
  models: { alias: string; count: number; avgMs: number; errors: number }[];
  clients: { ip: string; count: number }[];
  endpoints: { path: string; count: number }[];
}

/** Nearest-rank percentile of an unsorted list; 0 for none. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function aggregate(reqs: Req[], top = 7): Stats {
  const ok = reqs.filter((r) => r.status < 400).length;
  const models = new Map<string, { count: number; ms: number; errors: number }>();
  const clients = new Map<string, number>();
  const endpoints = new Map<string, number>();
  for (const r of reqs) {
    const m = models.get(r.alias) ?? { count: 0, ms: 0, errors: 0 };
    m.count++;
    m.ms += r.ms;
    if (r.status >= 400) m.errors++;
    models.set(r.alias, m);
    clients.set(r.ip, (clients.get(r.ip) ?? 0) + 1);
    endpoints.set(r.path, (endpoints.get(r.path) ?? 0) + 1);
  }
  const byCount = <T extends { count: number }>(a: T, b: T): number => b.count - a.count;
  return {
    requests: reqs.length,
    ok,
    errors: reqs.length - ok,
    successPct: reqs.length ? (ok / reqs.length) * 100 : 0,
    avgMs: reqs.length ? reqs.reduce((n, r) => n + r.ms, 0) / reqs.length : 0,
    p95Ms: percentile(reqs.map((r) => r.ms), 95),
    cold: reqs.filter((r) => r.cold).length,
    models: [...models].map(([alias, m]) => ({ alias, count: m.count, avgMs: m.ms / m.count, errors: m.errors })).sort(byCount).slice(0, top),
    clients: [...clients].map(([ip, count]) => ({ ip, count })).sort(byCount).slice(0, top),
    endpoints: [...endpoints].map(([path, count]) => ({ path, count })).sort(byCount),
  };
}
