import { describe, expect, test } from "vitest";
import { create, edit, restart, start } from "../../src/vllm/demo/actions";
import { CATALOG } from "../../src/vllm/demo/catalog";
import { commandText, defaultConfig, estimateFloor, longestContext, parseCommand, validate, words, type Draft } from "../../src/vllm/demo/config";
import { budget, cards, dep, isStale, rng, round2, START_MS, STOP_MS } from "../../src/vllm/demo/model";
import { seed } from "../../src/vllm/demo/seed";
import { tick, usedGiB } from "../../src/vllm/demo/sim";
import type { EngineConfig, State } from "../../src/vllm/demo/types";

const model = (repo: string) => CATALOG.find((m) => m.repo === repo)!;
const cfg = (over: Partial<EngineConfig> = {}): EngineConfig => ({ ...defaultConfig(), ...over });
const draft = (over: Partial<Draft> = {}, c: Partial<EngineConfig> = {}): Draft => ({
  alias: "qwen3-14b", repo: "Qwen/Qwen3-14B", gpu: 3, maxLen: 32768, maxSeqs: 32, lazy: true, extraAliases: [], cfg: cfg(c), ...over,
});
const run = (s: State, ms: number): State => {
  const r = rng(1);
  let out = s;
  for (let t = s.now + 100; t <= s.now + ms; t += 100) out = tick(out, t, r);
  return out;
};

describe("the memory estimate follows the settings", () => {
  const q14 = model("Qwen/Qwen3-14B");

  test("with the defaults it is the formula new deployments always used", () => {
    expect(estimateFloor(q14, 32768)).toBe(round2((27.5 * 1.05 + 1.5 + 32 * 0.16) / 96));
  });

  test("fp8 KV, tensor parallel, quantization and eager mode each lower the floor per card", () => {
    const base = estimateFloor(q14, 32768);
    expect(estimateFloor(q14, 32768, cfg({ kvDtype: "fp8" }))).toBeLessThan(base);
    expect(estimateFloor(q14, 32768, cfg({ tp: 2 }))).toBeCloseTo(base / 2, 1);
    expect(estimateFloor(q14, 32768, cfg({ quant: "fp8" }))).toBeLessThan(base * 0.6);
    expect(estimateFloor(q14, 32768, cfg({ eager: true }))).toBeLessThan(base);
    expect(estimateFloor(q14, 32768, cfg({ offloadGiB: 10 }))).toBeLessThan(base);
  });

  test("an fp8 checkpoint is not shrunk again by fp8 quantization; adapters and a draft model add", () => {
    const llama = model("meta-llama/Llama-3.3-70B-Instruct-FP8");
    expect(estimateFloor(llama, 16384, cfg({ quant: "fp8" }))).toBe(estimateFloor(llama, 16384));
    expect(estimateFloor(q14, 32768, cfg({ lora: { on: true, max: 8, rank: 64, modules: [] } }))).toBeGreaterThan(estimateFloor(q14, 32768));
    expect(estimateFloor(q14, 32768, cfg({ spec: { method: "draft", tokens: 3, draft: "Qwen/Qwen3-0.6B" } }))).toBeGreaterThan(estimateFloor(q14, 32768));
  });

  test("the longest context grows with fp8 KV and with cards, up to the model's own limit", () => {
    const big = model("meta-llama/Llama-3.3-70B-Instruct-FP8");
    const one = longestContext(big, cfg());
    expect(one).toBeGreaterThan(0);
    expect(longestContext(big, cfg({ kvDtype: "fp8" }))).toBeGreaterThan(one);
    expect(longestContext(big, cfg({ tp: 4 }))).toBe(big.maxCtx);
    expect(estimateFloor(big, one)).toBeLessThanOrEqual(0.95);
  });
});

describe("validation", () => {
  const q14 = model("Qwen/Qwen3-14B");
  const v = (d: Draft, m = q14) => validate(d, m, 4);

  test("a default draft passes", () => {
    expect(v(draft())).toEqual({});
  });

  test("placement: tensor × pipeline must fit the host, from the first card up", () => {
    expect(v(draft({}, { tp: 4, pp: 2 })).pp).toMatch(/the host has 4 cards/);
    expect(v(draft({ gpu: 3 }, { tp: 2 })).gpu).toMatch(/run past GPU 3/);
    expect(v(draft({ gpu: 2 }, { tp: 2 }))).toEqual({});
    expect(v(draft({}, { tp: 3 })).tp).toBeDefined();
  });

  test("context and batching", () => {
    expect(v(draft({ maxLen: 65536 })).maxLen).toMatch(/40,960/);
    expect(v(draft({ maxSeqs: 0 })).maxSeqs).toBeDefined();
    expect(v(draft({}, { maxBatched: 16 })).maxBatched).toMatch(/at least max num seqs/i);
    expect(v(draft({}, { maxBatched: 8192, chunkedPrefill: false })).maxBatched).toMatch(/Without chunked prefill/);
    expect(v(draft({}, { maxBatched: 8192 }))).toEqual({});
  });

  test("an explicit memory utilization stays under the ceiling and above what the model needs", () => {
    expect(v(draft({}, { memUtil: 0.99 })).memUtil).toMatch(/ceiling/);
    expect(v(draft({}, { memUtil: 0.2 })).memUtil).toMatch(/Below the estimated floor/);
    expect(v(draft({}, { memUtil: 0.6 }))).toEqual({});
  });

  test("serving: JSON kwargs, a parser for auto tools, and nothing generative on an embedding model", () => {
    expect(v(draft({}, { chatKwargs: "{nope" })).chatKwargs).toBe("Not valid JSON.");
    expect(v(draft({}, { chatKwargs: "[1]" })).chatKwargs).toMatch(/JSON object/);
    expect(v(draft({}, { autoTools: true, toolParser: "" })).toolParser).toMatch(/needs a tool-call parser/);
    expect(v(draft({}, { templatePath: "template.txt" })).templatePath).toBeDefined();
    const emb = model("Qwen/Qwen3-Embedding-8B");
    expect(v(draft({ repo: emb.repo, maxLen: 8192 }, { thinkParser: "qwen3" }), emb).toolParser).toMatch(/embedding model/);
  });

  test("speculative decoding wants a draft of the same family; LoRA modules are name=org/adapter", () => {
    expect(v(draft({}, { spec: { method: "draft", tokens: 3, draft: "meta-llama/Llama-3.2-1B-Instruct" } })).spec).toMatch(/tokenizer/);
    expect(v(draft({}, { spec: { method: "draft", tokens: 3, draft: "Qwen/Qwen3-0.6B" } }))).toEqual({});
    expect(v(draft({}, { spec: { method: "ngram", tokens: 12, draft: "" } })).spec).toMatch(/1 to 8/);
    expect(v(draft({}, { lora: { on: true, max: 4, rank: 16, modules: ["no-equals"] } })).lora).toMatch(/name=org\/adapter/);
    expect(v(draft({}, { lora: { on: true, max: 4, rank: 16, modules: ["sql=acme/sql-lora"] } }))).toEqual({});
  });

  test("environment and custom flags cannot take what the manager or a field owns", () => {
    expect(v(draft({}, { env: [["CUDA_VISIBLE_DEVICES", "0"]] })).env).toMatch(/set by the manager/);
    expect(v(draft({}, { env: [["lower", "1"]] })).env).toMatch(/not a variable name/);
    expect(v(draft({}, { env: [["NCCL_DEBUG", "WARN"]] }))).toEqual({});
    expect(v(draft({}, { customFlags: ["--port", "9000"] })).customFlags).toMatch(/decided by the manager/);
    expect(v(draft({}, { customFlags: ["--max-model-len=8192"] })).customFlags).toMatch(/field of its own \(Max model length\)/);
    expect(v(draft({}, { customFlags: ["--seed", "42"] }))).toEqual({});
  });

  test("extra names must be usable and not the alias", () => {
    expect(v(draft({ extraAliases: ["qwen3-14b"] })).extraAliases).toBeDefined();
    expect(v(draft({ extraAliases: ["Bad Name"] })).extraAliases).toBeDefined();
  });
});

describe("the command", () => {
  test("names every set flag; the GPU selection and offline cache come from the manager", () => {
    const d = draft({ gpu: 2 }, { tp: 2, kvDtype: "fp8", prefixCaching: false, toolParser: "hermes", autoTools: true, chatKwargs: '{ "thinking_budget": 512 }', customFlags: ["--seed", "42"] });
    const t = commandText(d, model(d.repo), 0.31);
    expect(t).toMatch(/^CUDA_VISIBLE_DEVICES=2,3 \\\n {2}HF_HUB_OFFLINE=1 \\\n {2}vllm serve Qwen\/Qwen3-14B \\/);
    for (const f of ["--served-model-name qwen3-14b", "--tensor-parallel-size 2", "--kv-cache-dtype fp8", "--no-enable-prefix-caching", "--tool-call-parser hermes", "--enable-auto-tool-choice", "--gpu-memory-utilization 0.31", "--seed 42"])
      expect(t).toContain(f);
    expect(t).toContain(`--default-chat-template-kwargs '{"thinking_budget":512}'`);
    expect(t).not.toContain("--pipeline-parallel-size");
  });

  test("an embedding model runs as a pooling runner", () => {
    const emb = model("Qwen/Qwen3-Embedding-8B");
    expect(commandText(draft({ repo: emb.repo, maxLen: 8192 }), emb, 0.2)).toContain("--runner pooling");
  });

  test("words: quotes group, a backslash-newline joins", () => {
    expect(words(`a 'b c' "d" \\\n e`)).toEqual(["a", "b c", "d", "e"]);
  });

  test("a pasted command reads back into the same settings", () => {
    const d = draft({ gpu: 0, maxLen: 16384, maxSeqs: 48 }, { tp: 2, pp: 2, kvDtype: "fp8", maxBatched: 4096, eager: true, thinkParser: "qwen3", spec: { method: "ngram", tokens: 4, draft: "" }, lora: { on: true, max: 2, rank: 32, modules: ["a=acme/a", "b=acme/b"] }, env: [["NCCL_DEBUG", "WARN"]], customFlags: ["--seed", "42"] });
    const text = commandText(d, model(d.repo), 0.4).replace("--gpu-memory-utilization 0.40 \\\n  ", "");
    const r = parseCommand(text, draft());
    expect(r.error).toBeUndefined();
    expect(r.draft).toMatchObject({ repo: d.repo, alias: d.alias, maxLen: 16384, maxSeqs: 48 });
    expect(r.draft.cfg).toEqual({ ...d.cfg });
  });

  test("a pasted command is refused for a managed flag, a model not in the cache, or no vllm serve", () => {
    expect(parseCommand("vllm serve Qwen/Qwen3-14B --port 9000", draft()).error).toMatch(/--port is decided by the manager/);
    expect(parseCommand("vllm serve acme/unknown-7b", draft()).error).toMatch(/not in the model cache/);
    expect(parseCommand("docker run vllm", draft()).error).toMatch(/starts with vllm serve/);
    expect(parseCommand("vllm serve Qwen/Qwen3-14B --max-num-seqs", draft()).error).toMatch(/needs a number/);
  });

  test("an explicit utilization in a paste is kept; unknown flags become custom flags", () => {
    const r = parseCommand("vllm serve Qwen/Qwen3-8B --gpu-memory-utilization 0.5 --max-logprobs 10 --disable-log-stats", draft());
    expect(r.draft.cfg.memUtil).toBe(0.5);
    expect(r.draft.cfg.customFlags).toEqual(["--max-logprobs", "10", "--disable-log-stats"]);
  });
});

describe("settings reach admission, the planner and the engine", () => {
  test("a tensor-parallel deployment holds both cards, is admitted on both, and fills both", () => {
    let s = seed();
    const made = create(s, { alias: "q14-tp2", repo: "Qwen/Qwen3-14B", gpu: 2, maxLen: 32768, maxSeqs: 32, lazy: true, cfg: cfg({ tp: 2 }) });
    expect(made.error).toBeUndefined();
    s = made.state;
    const d = dep(s, "q14-tp2")!;
    expect(cards(d)).toEqual([2, 3]);
    expect(budget(d)).toBe(estimateFloor(model("Qwen/Qwen3-14B"), 32768, cfg({ tp: 2 })));
    // GPU 2 is blocked: the whole start is refused.
    expect(start(s, "q14-tp2").refused?.reason).toBe("GPU 2 is blocked for new loads");
    s = { ...s, gpus: s.gpus.map((g) => ({ ...g, blocked: null })) };
    const before = [usedGiB(s, 2), usedGiB(s, 3)];
    const later = run(start(s, "q14-tp2").state, START_MS + 300);
    expect(dep(later, "q14-tp2")?.status).toBe("Running");
    expect(usedGiB(later, 2)).toBeGreaterThan(before[0] + 10);
    expect(usedGiB(later, 3)).toBeGreaterThan(before[1] + 10);
    expect(dep(later, "q14-tp2")?.log.some((l) => l.text.includes("tensor_parallel_size=2"))).toBe(true);
  });

  test("an edit that switches a measured deployment to fp8 KV makes its profile stale and lowers its floor", () => {
    const s = seed();
    const d0 = dep(s, "model-b")!;
    const r = edit(s, "model-b", { maxLen: d0.maxLen, maxSeqs: d0.maxSeqs, lazy: true, cfg: { ...d0.cfg, kvDtype: "fp8" } });
    expect(r.error).toBeUndefined();
    const d = dep(r.state, "model-b")!;
    expect(isStale(d)).toBe(true);
    expect(budget(d)).toBeLessThan(budget(d0));
    const up = run(start(r.state, "model-b").state, START_MS + 300);
    expect(isStale(dep(up, "model-b")!)).toBe(false);
  });

  test("on a running engine a settings change waits for a restart, which applies it", () => {
    const s = seed();
    const d0 = dep(s, "qwen3-32b")!;
    const r = edit(s, "qwen3-32b", { maxLen: d0.maxLen, maxSeqs: d0.maxSeqs, lazy: false, cfg: { ...d0.cfg, prefixCaching: false } });
    expect(dep(r.state, "qwen3-32b")?.pending?.cfg.prefixCaching).toBe(false);
    expect(dep(r.state, "qwen3-32b")?.cfg.prefixCaching).toBe(true);
    const later = run(restart(r.state, "qwen3-32b").state, STOP_MS + START_MS + 400);
    expect(dep(later, "qwen3-32b")).toMatchObject({ status: "Running", pending: null });
    expect(dep(later, "qwen3-32b")?.cfg.prefixCaching).toBe(false);
    // Lifecycle settings are the manager's and apply at once.
    const now = edit(s, "qwen3-32b", { maxLen: d0.maxLen, maxSeqs: d0.maxSeqs, lazy: false, cfg: { ...d0.cfg, idleMin: 45 } });
    expect(dep(now.state, "qwen3-32b")).toMatchObject({ pending: null, cfg: { idleMin: 45 } });
  });

  test("an explicit utilization is what admission counts; one below the model's need fails the start", () => {
    const s = seed();
    const d0 = dep(s, "model-b")!;
    const set = (u: number) => edit(s, "model-b", { maxLen: d0.maxLen, maxSeqs: d0.maxSeqs, lazy: true, cfg: { ...d0.cfg, memUtil: u } });
    expect(budget(dep(set(0.5).state, "model-b")!)).toBe(0.5);
    // 0.36 clears the estimate (0.35) the form checks, but not the 0.38 the engine measured: the start fails.
    expect(set(0.3).problems?.memUtil).toMatch(/Below the estimated floor/);
    const low = set(0.36);
    expect(low.error).toBeUndefined();
    const later = run(start(low.state, "model-b").state, START_MS + 300);
    expect(dep(later, "model-b")?.status).toBe("Error");
    expect(dep(later, "model-b")?.error).toMatch(/below the 0\.38/);
    expect(later.notice?.level).toBe("error");
  });

  test("a refused save returns every problem for the form", () => {
    const s = seed();
    const r = create(s, { alias: "x-1", repo: "Qwen/Qwen3-14B", gpu: 3, maxLen: 32768, maxSeqs: 32, lazy: true, cfg: cfg({ tp: 2, maxBatched: 1 }) });
    expect(r.problems).toMatchObject({ gpu: expect.any(String), maxBatched: expect.any(String) });
    expect(r.state).toBe(s);
    expect(create(s, { alias: "x-2", repo: "Qwen/Qwen3-14B", gpu: 3, maxLen: 32768, maxSeqs: 32, lazy: true, extraAliases: ["chat-default"] }).problems?.extraAliases).toMatch(/another deployment/);
  });

  test("a lazy deployment idle past its timeout is stopped", () => {
    let s = run(start(seed(), "model-b").state, START_MS + 300);
    s = { ...s, deps: s.deps.map((d) => (d.alias === "model-b" ? { ...d, lastUsed: s.now - 21 * 60_000 } : d)) };
    const later = run(s, STOP_MS + 300);
    expect(dep(later, "model-b")?.status).toBe("Stopped");
    expect(dep(later, "model-b")?.log.some((l) => l.text.includes("idle for 20 min"))).toBe(true);
  });
});
