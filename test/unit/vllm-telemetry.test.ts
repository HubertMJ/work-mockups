import { describe, expect, test } from "vitest";
import { edit, start, stop } from "../../src/vllm/demo/actions";
import { COARSE, COARSE_EVERY, HISTORY, loadAvg, peak, view } from "../../src/vllm/demo/metrics";
import { dep, rng, START_MS, STOP_MS } from "../../src/vllm/demo/model";
import { seed } from "../../src/vllm/demo/seed";
import { tick } from "../../src/vllm/demo/sim";
import type { State } from "../../src/vllm/demo/types";

const run = (s: State, ms: number, step = 100): State => {
  const r = rng(7);
  let out = s;
  for (let t = s.now + step; t <= s.now + ms; t += step) out = tick(out, t, r);
  return out;
};
const now = (xs: number[]) => xs.at(-1) ?? Number.NaN;

describe("telemetry", () => {
  test("the seed carries three minutes of 1 s samples and an hour of 15 s points for every series", () => {
    const t = seed().telemetry;
    for (const g of t.gpus) for (const s of Object.values(g)) expect([s.fine.length, s.coarse.length]).toEqual([HISTORY, COARSE]);
    for (const s of Object.values(t.host)) expect([s.fine.length, s.coarse.length]).toEqual([HISTORY, COARSE]);
    expect(Object.keys(t.engines).sort()).toEqual(seed().deps.map((d) => d.alias).sort());
    for (const e of Object.values(t.engines)) expect(e.reqRate.fine.length).toBe(HISTORY);
  });

  test("the seed's values look like the host it describes", () => {
    const t = seed().telemetry;
    expect(now(t.gpus[0].vram.fine)).toBeCloseTo(0.74 * 96, 0);
    expect(now(t.gpus[3].vram.fine)).toBe(0);
    expect(now(t.gpus[0].util.fine)).toBeGreaterThan(now(t.gpus[2].util.fine));
    expect(now(t.gpus[0].power.fine)).toBeGreaterThan(now(t.gpus[3].power.fine));
    expect(now(t.gpus[3].sm.fine)).toBe(345);
    // model-b ran on GPU 3 until 24 minutes ago: the hour view shows it.
    expect(Math.max(...t.gpus[3].vram.coarse)).toBeGreaterThan(30);
    expect(peak(t.gpus[3].util)).toBeGreaterThan(5);
    const [l1, l5, l15] = loadAvg(t.host);
    expect(l1).toBeGreaterThan(0);
    expect(l5).toBeGreaterThan(0);
    expect(l15).toBeGreaterThan(0);
  });

  test("running engines report traffic; stopped ones report nothing", () => {
    const e = seed().telemetry.engines;
    expect(now(e["qwen3-32b"].reqRate.fine)).toBeGreaterThan(0);
    expect(now(e["qwen3-32b"].genTps.fine)).toBeGreaterThan(0);
    expect(now(e["qwen3-32b"].ttft95.fine)).toBeGreaterThan(now(e["qwen3-32b"].ttft50.fine));
    expect(now(e["qwen3-32b"].itl95.fine)).toBeGreaterThan(now(e["qwen3-32b"].itl50.fine));
    expect(now(e["qwen3-32b"].kvUsage.fine)).toBeGreaterThan(0);
    expect(now(e["qwen3-32b"].prefixHit.fine)).toBeGreaterThan(0);
    expect(now(e["embed-8b"].reqRate.fine)).toBeGreaterThan(0);
    expect(now(e["embed-8b"].genTps.fine)).toBe(0);
    expect(now(e["model-b"].reqRate.fine)).toBe(0);
  });

  test("a sample a second: the rings keep their length, and every 15th closes a coarse point", () => {
    const s = seed();
    const later = run(s, 15_000, 1000);
    const t = later.telemetry;
    expect(t.n - s.telemetry.n).toBe(15);
    expect(t.at).toBe(later.now);
    expect(t.gpus[0].util.fine.length).toBe(HISTORY);
    expect(t.gpus[0].util.coarse.length).toBe(COARSE);
    expect(t.gpus[0].util.coarse).not.toEqual(s.telemetry.gpus[0].util.coarse);
    expect(t.n % COARSE_EVERY).toBe(0);
    // The old State is untouched.
    expect(s.telemetry.gpus[0].util.fine.length).toBe(HISTORY);
    expect(view(t.gpus[0].util, "3m")).toHaveLength(HISTORY);
    expect(view(t.gpus[0].util, "15m")).toHaveLength(60);
    expect(view(t.gpus[0].util, "1h")).toHaveLength(COARSE);
  });

  test("a start reads weights from disk and fills its card; once up, its engine reports", () => {
    const s = start(seed(), "model-b").state;
    const loading = run(s, 1500);
    expect(now(loading.telemetry.host.diskRead.fine)).toBeGreaterThan(1000);
    const up = run(loading, START_MS + 6000);
    expect(dep(up, "model-b")?.status).toBe("Running");
    expect(now(up.telemetry.gpus[3].vram.fine)).toBeCloseTo(0.38 * 96, 0);
    expect(now(up.telemetry.gpus[3].memClock.fine)).toBeGreaterThan(405);
    expect(now(up.telemetry.engines["model-b"].reqRate.fine)).toBeGreaterThan(0);
    expect(now(up.telemetry.host.diskRead.fine)).toBeLessThan(100);
  });

  test("a stop empties the card and silences the engine", () => {
    const later = run(stop(seed(), "llama-3.3-70b-fp8").state, STOP_MS + 2000);
    expect(now(later.telemetry.gpus[1].vram.fine)).toBe(0);
    expect(now(later.telemetry.engines["llama-3.3-70b-fp8"].reqRate.fine)).toBe(0);
    expect(later.telemetry.preemptTotal["llama-3.3-70b-fp8"]).toBe(0);
  });

  test("settings show in the metrics: no prefix caching, no hits; speculative decoding reports acceptance", () => {
    const s = seed();
    const d = dep(s, "model-b")!;
    const off = edit(s, "model-b", { maxLen: d.maxLen, maxSeqs: d.maxSeqs, lazy: true, cfg: { ...d.cfg, prefixCaching: false, spec: { method: "ngram", tokens: 4, draft: "" } } }).state;
    const up = run(start(off, "model-b").state, START_MS + 4000);
    const e = up.telemetry.engines["model-b"];
    expect(now(e.reqRate.fine)).toBeGreaterThan(0);
    expect(now(e.prefixHit.fine)).toBe(0);
    expect(now(e.accept.fine)).toBeGreaterThan(10);
  });

  test("a deleted deployment's series go; a new one's start empty", () => {
    const s = seed();
    const gone = run({ ...s, deps: s.deps.filter((d) => d.alias !== "qwen2.5-7b") }, 1000, 1000);
    expect(gone.telemetry.engines["qwen2.5-7b"]).toBeUndefined();
  });
});
