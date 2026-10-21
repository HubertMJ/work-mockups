// The demo's starting point: gpu-host-1 with four 96 GiB cards, seven deployments, a week of
// bookings, a few downloads and a request history. Values follow the portfolio's example data;
// what it did not give is invented in the same style. Everything comes from one seed, so the page
// looks the same on every load.

import { DAY, GIB, HOUR, MIB, rng, SEED_NOW, slug, WEEK0 } from "./model";
import { plan } from "./planner";
import { HISTORY, pushLog, sample, startupLog } from "./sim";
import type { CachedModel, Deployment, Download, Event, Req, Reservation, State } from "./types";

const at = (day: number, h: number, m = 0): number => WEEK0 + day * DAY + h * HOUR + m * 60_000;
const ago = (min: number): number => SEED_NOW - min * 60_000;

type Base = Omit<Deployment, "status" | "pinned" | "lazy" | "drift" | "pending" | "extraAliases" | "error" | "refused" | "phase" | "log" | "kvLen" | "profileLen"> &
  Partial<Deployment>;
const mk = (d: Base): Deployment => ({
  status: "Stopped", pinned: false, lazy: false, drift: 0, pending: null, extraAliases: [], error: null, refused: null, phase: null, log: [],
  kvLen: d.maxLen, profileLen: d.maxLen, ...d,
});

function deployments(): Deployment[] {
  const list = [
    mk({ alias: "qwen3-32b", model: "Qwen/Qwen3-32B", gpu: 0, kind: "generate", status: "Running", pinned: true, minUtil: 0.74, source: "engine-log",
      maxLen: 32768, maxSeqs: 64, kvTokens: 410_000, extraAliases: ["chat-default"], lastUsed: ago(0.2), load: 0.78 }),
    mk({ alias: "llama-3.3-70b-fp8", model: "meta-llama/Llama-3.3-70B-Instruct-FP8", gpu: 1, kind: "generate", status: "Running", minUtil: 0.91,
      source: "engine-log", maxLen: 16384, maxSeqs: 32, kvTokens: 96_000, lastUsed: ago(0.5), load: 0.41 }),
    mk({ alias: "embed-8b", model: "Qwen/Qwen3-Embedding-8B", gpu: 2, kind: "embed", status: "Running", minUtil: 0.23, source: "nvidia-smi",
      maxLen: 8192, maxSeqs: 128, kvTokens: null, lastUsed: ago(0.4), load: 0.12 }),
    mk({ alias: "model-a-moe", model: "model-a (MoE 30B-A3B)", gpu: 3, kind: "generate", lazy: true, minUtil: 0.66, source: "estimate", drift: 0.04,
      maxLen: 65536, maxSeqs: 48, kvTokens: null, lastUsed: ago(300), load: 0.55 }),
    mk({ alias: "model-b", model: "model-b-14b", gpu: 3, kind: "generate", lazy: true, minUtil: 0.38, source: "engine-log",
      maxLen: 32768, maxSeqs: 32, kvTokens: 212_000, lastUsed: ago(24), load: 0.35 }),
    mk({ alias: "model-c", model: "model-c-8b", gpu: 2, kind: "generate", status: "Error", lazy: true, minUtil: 0.31, source: "engine-log",
      profileLen: 16384, kvLen: 16384, maxLen: 32768, maxSeqs: 16, kvTokens: 148_000, lastUsed: ago(130), load: 0.3,
      error: "start exceeded cold-start ceiling (300 s), container removed" }),
    mk({ alias: "qwen2.5-7b", model: "Qwen/Qwen2.5-7B-Instruct", gpu: 0, kind: "generate", lazy: true, minUtil: 0.3, source: "engine-log",
      maxLen: 32768, maxSeqs: 32, kvTokens: 380_000, lastUsed: ago(900), load: 0.3 }),
  ];
  const log = (d: Deployment, lines: [number, Deployment["log"][number]["level"], string][]): Deployment =>
    lines.reduce((x, [t, level, text]) => pushLog(x, { t, level, text }), d);
  const stopLines = (d: Deployment, t: number, why: string): [number, "INFO", string][] => [
    [t, "INFO", `manager: stopping vllm-${slug(d.alias)} (${why})`],
    [t + 500, "INFO", "Shutting down the engine; no requests in flight"],
    [t + 1200, "INFO", `manager: container removed; GPU ${d.gpu} budget ${d.minUtil.toFixed(2)} released`],
  ];
  return list.map((d) => {
    const withStart = (t: number): Deployment => ({ ...d, log: startupLog(d, t) });
    switch (d.alias) {
      case "qwen3-32b":
        return withStart(SEED_NOW - (3 * 24 + 4) * HOUR);
      case "llama-3.3-70b-fp8":
        return withStart(SEED_NOW - 6 * HOUR);
      case "embed-8b":
        return log(withStart(SEED_NOW - (9 * 24 + 12) * HOUR), [[SEED_NOW - (9 * 24 + 12) * HOUR + 3700, "WARNING", "manager: no memory profile in the log for a pooling model; minUtil 0.23 read from nvidia-smi"]]);
      case "model-b":
        return log(withStart(ago(85)), stopLines(d, ago(24), "idle for 20 min, lazy"));
      case "qwen2.5-7b":
        return log(withStart(ago(1800)), stopLines(d, ago(900), "idle for 20 min, lazy"));
      case "model-c": {
        const t = ago(130);
        const head = startupLog({ ...d, maxLen: 32768 }, t).slice(0, 3);
        return log({ ...d, log: head }, [
          [t + 120_000, "WARNING", "manager: still no \"Application startup complete\" after 120 s"],
          [t + 300_000, "ERROR", "manager: start exceeded cold-start ceiling (300 s), container removed"],
          [t + 300_500, "WARNING", "manager: profile marked stale: maxModelLen changed 16384 → 32768"],
        ]);
      }
      default:
        return d;
    }
  });
}

function reservations(): Reservation[] {
  const list: [string, string, number, number][] = [
    ["nightly-eval", "qwen3-32b", at(0, 8, 30), at(0, 12)],
    ["smoke-test", "embed-8b", at(0, 14), at(0, 15, 30)],
    ["nightly-eval", "qwen3-32b", at(1, 8, 30), at(1, 12)],
    ["nightly-eval", "qwen3-32b", at(2, 8, 30), at(2, 12)],
    ["ab-test", "model-b", at(2, 13), at(2, 15)],
    ["eval-run", "model-a-moe", at(2, 14), at(2, 16)],
    ["load-test-1", "llama-3.3-70b-fp8", at(2, 18), at(2, 20)],
    ["load-test-2", "llama-3.3-70b-fp8", at(2, 19), at(2, 21)],
    ["nightly-eval", "qwen3-32b", at(3, 8, 30), at(3, 12)],
    ["batch-team-x", "model-c", at(3, 22), at(4, 6)],
    ["nightly-eval", "qwen3-32b", at(4, 8, 30), at(4, 12)],
    ["rag-reindex", "embed-8b", at(5, 13), at(5, 17)],
  ];
  return list.map(([name, alias, start, end], i) => ({ id: `s${i + 1}`, name, alias, start, end, created: i + 1, status: "Scheduled", reason: null }));
}

export const CATALOG: CachedModel[] = [
  { repo: "Qwen/Qwen3-32B", arch: "Qwen3ForCausalLM, dense", params: "32.8B", weightsGiB: 61.0, maxCtx: 40960, kvPerK: 0.25, kind: "generate", cached: true },
  { repo: "meta-llama/Llama-3.3-70B-Instruct-FP8", arch: "LlamaForCausalLM, dense, FP8", params: "70.6B", weightsGiB: 68.0, maxCtx: 131072, kvPerK: 0.31, kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-Embedding-8B", arch: "Qwen3Model, embedding", params: "7.6B", weightsGiB: 15.1, maxCtx: 32768, kvPerK: 0.14, kind: "embed", cached: true },
  { repo: "Qwen/Qwen2.5-7B-Instruct", arch: "Qwen2ForCausalLM, dense", params: "7.6B", weightsGiB: 14.2, maxCtx: 32768, kvPerK: 0.055, kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-14B", arch: "Qwen3ForCausalLM, dense", params: "14.8B", weightsGiB: 27.5, maxCtx: 40960, kvPerK: 0.16, kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-8B", arch: "Qwen3ForCausalLM, dense", params: "8.2B", weightsGiB: 15.3, maxCtx: 40960, kvPerK: 0.14, kind: "generate", cached: true },
  { repo: "model-a (MoE 30B-A3B)", arch: "MoE, 3B active", params: "30.5B", weightsGiB: 56.9, maxCtx: 65536, kvPerK: 0.09, kind: "generate", cached: true },
  { repo: "model-b-14b", arch: "dense", params: "14.0B", weightsGiB: 26.1, maxCtx: 32768, kvPerK: 0.16, kind: "generate", cached: true },
  { repo: "model-c-8b", arch: "dense", params: "8.0B", weightsGiB: 15.0, maxCtx: 32768, kvPerK: 0.13, kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-30B-A3B-Instruct-2507", arch: "Qwen3MoeForCausalLM, MoE, 3.3B active", params: "30.5B", weightsGiB: 56.9, maxCtx: 262144, kvPerK: 0.09, kind: "generate", cached: false },
  { repo: "meta-llama/Llama-3.1-8B-Instruct", arch: "LlamaForCausalLM, dense", params: "8.0B", weightsGiB: 15.0, maxCtx: 131072, kvPerK: 0.125, kind: "generate", cached: false },
  { repo: "meta-llama/Llama-3.3-70B-Instruct", arch: "LlamaForCausalLM, dense", params: "70.6B", weightsGiB: 131.4, maxCtx: 131072, kvPerK: 0.31, kind: "generate", cached: false },
];

const DOWNLOADS: Download[] = [
  { id: "d-1", repo: "Qwen/Qwen3-30B-A3B-Instruct-2507", state: "running", bytes: 38.2 * GIB, total: 56.9 * GIB, finalBytes: 56.9 * GIB, speed: 182 * MIB, error: null },
  // The hub did not report a size: the page says "unknown" and never guesses.
  { id: "d-2", repo: "meta-llama/Llama-3.1-8B-Instruct", state: "running", bytes: 6.4 * GIB, total: null, finalBytes: 15.0 * GIB, speed: 95 * MIB, error: null },
  { id: "d-3", repo: "Qwen/Qwen3-Embedding-8B", state: "completed", bytes: 15.1 * GIB, total: 15.1 * GIB, finalBytes: 15.1 * GIB, speed: 0, error: null },
  { id: "d-4", repo: "meta-llama/Llama-3.3-70B-Instruct", state: "failed", bytes: 2.3 * GIB, total: 131.4 * GIB, finalBytes: 131.4 * GIB, speed: 0,
    error: "disk headroom check failed: 131.4 GiB needed, 96.2 GiB free on the cache volume" },
];

const EVENTS: Event[] = [
  { t: ago(4), level: "info", text: "model-b stopped: idle for 20 min (lazy)" },
  { t: ago(17), level: "info", text: "VRAM profile measured for llama-3.3-70b-fp8: minUtil 0.91 (source: engine log)" },
  { t: ago(34), level: "info", text: "reservation nightly-eval became Active" },
  { t: ago(52), level: "warn", text: "pin on model-c refused: 409, conflicts with reservation batch-team-x" },
  { t: ago(69), level: "warn", text: "GPU 2 blocked by operator: driver update" },
  { t: ago(84), level: "error", text: "reservation eval-run is unfulfillable: GPU 3 cannot hold model-a-moe next to ab-test's model-b" },
  { t: ago(125), level: "error", text: "model-c: start exceeded cold-start ceiling (300 s), container removed" },
];

const PROMPTS: [string, string][] = [
  ['Summarize this log line: "disk usage at 91% on /var, threshold 90%"', "The /var partition is at 91% and has crossed its 90% alert threshold."],
  ['Rewrite in plain English: "Utilize the aforementioned methodology."', "Use the method mentioned above."],
  ["Write a haiku about GPUs", "Ninety-six gigs hum, four cards share the evening load…"],
  ["Classify this ticket: printer offline on floor 3", "category: hardware · priority: low"],
  ["Translate to French: the build is green", "Le build est vert."],
  ["Extract the date from: invoice issued 2026-10-14", "2026-10-14"],
  ["List three uses of a reverse proxy", "TLS termination, load balancing, caching."],
];

/** 2,000 requests over the 6.5 hours before the page's "now", shaped like the example's day. */
function background(): Req[] {
  const r = rng(20261021);
  const normal = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const aliases = [...Array(945).fill("qwen3-32b"), ...Array(583).fill("embed-8b"), ...Array(385).fill("llama-3.3-70b-fp8"), ...Array(87).fill("model-b")];
  for (let i = aliases.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [aliases[i], aliases[j]] = [aliases[j], aliases[i]];
  }
  const ips: [string, number][] = [["192.0.2.14", 470], ["192.0.2.27", 354], ["192.0.2.38", 252], ["192.0.2.51", 223], ["192.0.2.66", 189], ["192.0.2.73", 173], ["192.0.2.90", 151], ["192.0.2.105", 188]];
  const ipList = ips.flatMap(([ip, n]) => Array<string>(n).fill(ip));
  const mean: Record<string, number> = { "qwen3-32b": 880, "embed-8b": 64, "llama-3.3-70b-fp8": 1500, "model-b": 1900 };
  const errorAt = new Set<number>();
  while (errorAt.size < 13) errorAt.add(Math.floor(r() * 2000));
  const codes = [503, 400, 499, 504];
  let cold = 0;
  const span = 6.5 * HOUR;
  return aliases.map((alias, i) => {
    const t = SEED_NOW - span + Math.floor(((i + r()) / aliases.length) * span) - 5000;
    const embed = alias === "embed-8b";
    const isCold = alias === "model-b" && cold < 4 && r() < 0.06 && ++cold > 0;
    const ms = Math.max(12, mean[alias] * Math.exp(0.75 * normal() - 0.28)) + (isCold ? 38_000 + r() * 9000 : 0);
    const status = errorAt.has(i) ? codes[Math.floor(r() * codes.length)] : 200;
    const [prompt, output] = embed ? [`chunk ${String(i).padStart(4, "0")}: sshd: session closed for user deploy`, "embedding · 4096 dims"] : PROMPTS[Math.floor(r() * PROMPTS.length)];
    const path = embed ? "/v1/embeddings" : r() < 0.137 ? "/v1/completions" : "/v1/chat/completions";
    return { id: `b${i}`, t, alias, path, status, ms: Math.round(ms), cold: isCold, ip: ipList[Math.floor(r() * ipList.length)], prompt, output: status === 200 ? output : `{"error":{"code":${status}}}` };
  }).reverse();
}

export function seed(): State {
  const s0: State = {
    now: SEED_NOW,
    gpus: [0, 1, 2, 3].map((index) => ({ index, blocked: index === 2 ? "driver update" : null })),
    deps: deployments(),
    reservations: reservations(),
    requests: [],
    background: background(),
    downloads: DOWNLOADS,
    catalog: CATALOG,
    telemetry: { at: SEED_NOW, util: [[], [], [], []], vram: [[], [], [], []], temp: [[], [], [], []] },
    stream: null,
    notice: null,
    events: EVENTS,
    seq: 100,
  };
  // The last three minutes of telemetry, played from the same seed.
  const r = rng(96);
  const t = s0.telemetry;
  const prev = [78, 41, 12, 0];
  const temp = [64, 55, 41, 36];
  for (let i = 0; i < HISTORY; i++) {
    for (const g of s0.gpus) {
      const [u, v, c] = sample(s0, g.index, prev[g.index], temp[g.index], r);
      prev[g.index] = u;
      temp[g.index] = c;
      t.util[g.index].push(u);
      t.vram[g.index].push(v);
      t.temp[g.index].push(c);
    }
  }
  return { ...s0, reservations: plan(s0) };
}

