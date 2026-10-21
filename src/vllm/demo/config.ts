// A deployment's engine settings as data: the defaults, the choices the form offers, the checks a
// draft must pass before it is saved, the `vllm serve` command it turns into, and the reverse, a
// pasted command read back into a draft. Pure functions, so the unit tests check them directly.

import { CATALOG, drafts, family } from "./catalog";
import { CARD_GIB, CEILING, cardsOf, floorGiB, round2 } from "./model";
import type { CachedModel, EngineConfig, ModelMem } from "./types";

export const STOCK_IMAGE = "vllm/vllm-openai:v0.11.0";
export const IMAGES: [string, string][] = [
  [STOCK_IMAGE, `${STOCK_IMAGE} (default)`],
  ["local/vllm-extras:2026-10-12", "local/vllm-extras:2026-10-12 · flash-attn, extra parsers"],
  ["local/vllm-nightly:2026-10-20", "local/vllm-nightly:2026-10-20 · nightly wheel"],
];
export const TOOL_PARSERS = ["hermes", "llama3_json", "mistral", "pythonic", "qwen3_coder", "granite"];
export const REASONING_PARSERS = ["qwen3", "deepseek_r1", "mistral", "granite"];
export const TP_SIZES = [1, 2, 4];
export const PP_SIZES = [1, 2, 3, 4];
export const LORA_RANKS = [8, 16, 32, 64];
/** Set by the manager on every container, so a deployment cannot. */
export const MANAGED_ENV = ["CUDA_VISIBLE_DEVICES", "HF_HUB_OFFLINE", "HF_HOME", "VLLM_HOST_IP", "VLLM_PORT"];
/** Flags the manager decides, never the deployment: where it listens and where the cache is. */
export const MANAGED_FLAGS = ["--host", "--port", "--download-dir", "--api-key"];

export function defaultConfig(): EngineConfig {
  return {
    tp: 1, pp: 1, image: STOCK_IMAGE, memUtil: null, maxBatched: null, kvDtype: "auto", blockSize: 16, swapGiB: 4, offloadGiB: 0,
    dtype: "auto", quant: "none", prefixCaching: true, chunkedPrefill: true, eager: false, remoteCode: false,
    toolParser: "", autoTools: false, thinkParser: "", templatePath: "", chatKwargs: "", generationConfig: "auto",
    spec: { method: "none", tokens: 3, draft: "" }, lora: { on: false, max: 4, rank: 16, modules: [] }, env: [], customFlags: [],
    coldStartS: 300, idleMin: 20,
  };
}

/** The defaults a model suggests: a reasoning parser for the families that think, a tool parser for chat models. */
export function suggestedConfig(m: CachedModel): EngineConfig {
  const c = defaultConfig();
  if (m.kind === "embed") return { ...c, prefixCaching: false, chunkedPrefill: false };
  if (/^Qwen\/Qwen3-(?!Embedding)/.test(m.repo)) return { ...c, thinkParser: m.repo.includes("Instruct-2507") ? "" : "qwen3", toolParser: "hermes", autoTools: true };
  if (m.repo.startsWith("meta-llama/")) return { ...c, toolParser: "llama3_json", autoTools: true };
  if (m.repo.startsWith("mistralai/")) return { ...c, toolParser: "mistral", autoTools: true };
  return c;
}

export const memOf = (m: CachedModel): ModelMem => ({ weightsGiB: m.weightsGiB, kvPerK: m.kvPerK, precision: m.precision });

/** The floor a new deployment is admitted on, per card, until its first start measures it. */
export const estimateFloor = (m: CachedModel, maxLen: number, c: EngineConfig = defaultConfig()): number => round2(floorGiB(memOf(m), c, maxLen) / CARD_GIB);

/** The longest context that keeps one card's floor under the ceiling, in steps of 1,024, capped by the model. */
export function longestContext(m: CachedModel, c: EngineConfig): number {
  const fixed = floorGiB(memOf(m), c, 0);
  const perK = floorGiB(memOf(m), c, 1024) - fixed;
  const room = CEILING * CARD_GIB - fixed;
  if (room <= perK) return 0;
  return Math.min(m.maxCtx, Math.floor(room / perK) * 1024);
}

// ---------- the draft the form edits ----------

export interface Draft {
  alias: string;
  repo: string;
  gpu: number;
  maxLen: number;
  maxSeqs: number;
  lazy: boolean;
  extraAliases: string[];
  cfg: EngineConfig;
}

export type Problems = Partial<Record<string, string>>;

const ALIAS = /^[a-z0-9][a-z0-9.-]{1,39}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;

/** Flags that have a field of their own: typed in Custom flags they would fight it, so they are refused there. */
export const FIELD_FLAGS: Record<string, string> = {
  "--served-model-name": "Alias", "--tensor-parallel-size": "Tensor parallel", "--pipeline-parallel-size": "Pipeline parallel",
  "--max-model-len": "Max model length", "--max-num-seqs": "Max num seqs", "--max-num-batched-tokens": "Max batched tokens",
  "--gpu-memory-utilization": "GPU memory utilization", "--kv-cache-dtype": "KV cache dtype", "--block-size": "Block size",
  "--swap-space": "Swap space", "--cpu-offload-gb": "CPU offload", "--dtype": "Dtype", "--quantization": "Quantization",
  "--enable-prefix-caching": "Prefix caching", "--no-enable-prefix-caching": "Prefix caching", "--enable-chunked-prefill": "Chunked prefill",
  "--no-enable-chunked-prefill": "Chunked prefill", "--enforce-eager": "Enforce eager", "--trust-remote-code": "Trust remote code",
  "--tool-call-parser": "Tool-call parser", "--enable-auto-tool-choice": "Auto tool choice", "--reasoning-parser": "Reasoning parser",
  "--chat-template": "Chat template", "--default-chat-template-kwargs": "Chat template kwargs", "--generation-config": "Generation config",
  "--speculative-config": "Speculative decoding", "--enable-lora": "LoRA", "--max-loras": "LoRA", "--max-lora-rank": "LoRA",
  "--lora-modules": "LoRA", "--runner": "the model's runner", "--task": "the model's runner",
};

/** Every reason a draft cannot be saved, keyed by the field that has to change. Empty when it can. */
export function validate(d: Draft, m: CachedModel | undefined, gpus: number, mode: "new" | "edit" = "new"): Problems {
  const p: Problems = {};
  const c = d.cfg;
  if (mode === "new" && !ALIAS.test(d.alias.trim())) p.alias = "2 to 40 characters: lower-case letters, digits, dots and dashes.";
  if (!m) p.repo = "Pick a model from the cache.";
  const bad = d.extraAliases.find((a) => !ALIAS.test(a) || a === d.alias);
  if (bad !== undefined) p.extraAliases = `${bad || "(empty)"} is not a usable name: 2 to 40 lower-case letters, digits, dots and dashes, other than the alias.`;
  const n = cardsOf(c);
  if (!TP_SIZES.includes(c.tp)) p.tp = "1, 2 or 4 cards.";
  else if (!PP_SIZES.includes(c.pp) || n > gpus) p.pp = `Tensor × pipeline is ${n}; the host has ${gpus} cards.`;
  else if (d.gpu + n > gpus) p.gpu = `${n} cards from GPU ${d.gpu} would run past GPU ${gpus - 1}; anchor it on GPU ${gpus - n} or lower.`;
  const maxCtx = m?.maxCtx ?? 131072;
  if (!int(d.maxLen, 256, maxCtx)) p.maxLen = `A whole number from 256 to ${maxCtx.toLocaleString("en-US")}, the model's own limit.`;
  if (!int(d.maxSeqs, 1, 1024)) p.maxSeqs = "Max seqs must be a whole number from 1 to 1024.";
  if (c.maxBatched !== null) {
    if (!int(c.maxBatched, 1, 1_048_576)) p.maxBatched = "A whole number of tokens, or empty for the engine's default.";
    else if (c.maxBatched < d.maxSeqs) p.maxBatched = `At least max num seqs (${d.maxSeqs}): every running sequence needs a slot in a step.`;
    else if (!c.chunkedPrefill && c.maxBatched < d.maxLen) p.maxBatched = `Without chunked prefill a whole prompt goes in one step: at least max model length (${d.maxLen}).`;
  }
  if (c.memUtil !== null) {
    if (!(c.memUtil >= 0.05 && c.memUtil <= CEILING)) p.memUtil = `From 0.05 to the ${CEILING} ceiling, or empty to let the scheduler pass the measured floor.`;
    else if (m && c.memUtil < round2(floorGiB(memOf(m), c, d.maxLen) / CARD_GIB)) p.memUtil = `Below the estimated floor of ${round2(floorGiB(memOf(m), c, d.maxLen) / CARD_GIB).toFixed(2)}: the engine would find no room for the KV cache and fail its start.`;
  }
  if (!(c.swapGiB >= 0 && c.swapGiB <= 64)) p.swapGiB = "0 to 64 GiB of host memory per card.";
  if (!(c.offloadGiB >= 0 && c.offloadGiB <= (m ? Math.floor(m.weightsGiB / n) : 64))) p.offloadGiB = `0 to ${m ? Math.floor(m.weightsGiB / n) : 64} GiB: no more than one card's share of the weights.`;
  if (m?.kind === "embed") {
    if (c.toolParser || c.thinkParser || c.autoTools) p.toolParser = "An embedding model generates no text: no tool or reasoning parser.";
    if (c.spec.method !== "none") p.spec = "Speculative decoding needs a model that generates.";
    if (c.lora.on) p.lora = "LoRA adapters are for generating models here.";
  }
  if (c.autoTools && !c.toolParser) p.toolParser = "Auto tool choice needs a tool-call parser to read the model's calls.";
  if (c.chatKwargs.trim()) {
    try {
      const v: unknown = JSON.parse(c.chatKwargs);
      if (typeof v !== "object" || v === null || Array.isArray(v)) p.chatKwargs = "A JSON object, such as {\"enable_thinking\": false}.";
    } catch {
      p.chatKwargs = "Not valid JSON.";
    }
  }
  if (c.templatePath && !/^\/[\w./-]+\.jinja$/.test(c.templatePath)) p.templatePath = "An absolute path to a .jinja file inside the image, or empty for the model's own.";
  if (c.spec.method !== "none" && !int(c.spec.tokens, 1, 8)) p.spec = "1 to 8 speculative tokens per step.";
  else if (c.spec.method === "draft") {
    const dm = drafts().find((x) => x.repo === c.spec.draft);
    if (!dm) p.spec = "Pick a draft model from the cache.";
    else if (m && family(dm.repo) !== family(m.repo)) p.spec = `${dm.repo} does not share ${m.repo}'s tokenizer; pick a draft of the same family.`;
  }
  if (c.lora.on) {
    if (!int(c.lora.max, 1, 16)) p.lora = "1 to 16 adapters in a batch.";
    else if (!LORA_RANKS.includes(c.lora.rank)) p.lora = "A rank of 8, 16, 32 or 64.";
    else {
      const wrong = c.lora.modules.find((x) => !/^[a-z0-9][\w.-]*=[\w.-]+\/[\w.-]+$/i.test(x));
      if (wrong !== undefined) p.lora = `${wrong} is not name=org/adapter.`;
    }
  }
  for (const [k, v] of c.env) {
    if (!ENV_NAME.test(k)) p.env = `${k || "(empty)"} is not a variable name: capitals, digits and underscores.`;
    else if (MANAGED_ENV.includes(k)) p.env = `${k} is set by the manager on every container.`;
    else if (/[\n\0]/.test(v)) p.env = `${k}: a value is one line.`;
    if (p.env) break;
  }
  for (const t of c.customFlags) {
    const flag = t.split("=")[0];
    if (!t.startsWith("-")) continue;
    if (MANAGED_FLAGS.includes(flag)) p.customFlags = `${flag} is decided by the manager, not the deployment.`;
    else if (FIELD_FLAGS[flag]) p.customFlags = `${flag} has a field of its own (${FIELD_FLAGS[flag]}); set it there.`;
    if (p.customFlags) break;
  }
  if (c.customFlags.length && !c.customFlags[0].startsWith("--")) p.customFlags = `${c.customFlags[0]} is a value without a flag before it.`;
  if (!int(c.coldStartS, 60, 1800)) p.coldStartS = "60 to 1,800 seconds.";
  if (!int(c.idleMin, 1, 240)) p.idleMin = "1 to 240 minutes.";
  return p;
}

// ---------- the command ----------

const q = (v: string): string => (/^[\w./:=,@+-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`);

/** The command the manager runs, flag by flag ([flag, value | null]); managed values are marked so the preview can say so. */
export function argv(d: Draft, m: CachedModel | undefined, floor: number): { env: [string, string][]; args: [string, string | null, string?][] } {
  const c = d.cfg;
  const a: [string, string | null, string?][] = [];
  const add = (f: string, v: string | null = null, note?: string): void => void a.push([f, v, note]);
  add("--served-model-name", d.alias || "<alias>", "the alias is the routing key");
  if (m?.kind === "embed") add("--runner", "pooling", "from the model");
  add("--max-model-len", String(d.maxLen));
  add("--max-num-seqs", String(d.maxSeqs));
  add("--gpu-memory-utilization", (c.memUtil ?? floor).toFixed(2), c.memUtil === null ? "the scheduler's, from the floor" : "explicit");
  if (c.tp > 1) add("--tensor-parallel-size", String(c.tp));
  if (c.pp > 1) add("--pipeline-parallel-size", String(c.pp));
  if (c.maxBatched !== null) add("--max-num-batched-tokens", String(c.maxBatched));
  if (c.kvDtype !== "auto") add("--kv-cache-dtype", c.kvDtype);
  if (c.blockSize !== 16) add("--block-size", String(c.blockSize));
  if (c.swapGiB !== 4) add("--swap-space", String(c.swapGiB));
  if (c.offloadGiB > 0) add("--cpu-offload-gb", String(c.offloadGiB));
  if (c.dtype !== "auto") add("--dtype", c.dtype);
  if (c.quant !== "none") add("--quantization", c.quant);
  if (!c.prefixCaching) add("--no-enable-prefix-caching");
  if (!c.chunkedPrefill) add("--no-enable-chunked-prefill");
  if (c.eager) add("--enforce-eager");
  if (c.remoteCode) add("--trust-remote-code");
  if (c.toolParser) add("--tool-call-parser", c.toolParser);
  if (c.autoTools) add("--enable-auto-tool-choice");
  if (c.thinkParser) add("--reasoning-parser", c.thinkParser);
  if (c.templatePath) add("--chat-template", c.templatePath);
  if (c.chatKwargs.trim()) add("--default-chat-template-kwargs", compactJson(c.chatKwargs));
  if (c.generationConfig !== "auto") add("--generation-config", c.generationConfig);
  if (c.spec.method === "ngram") add("--speculative-config", JSON.stringify({ method: "ngram", num_speculative_tokens: c.spec.tokens, prompt_lookup_max: 4 }));
  if (c.spec.method === "draft") add("--speculative-config", JSON.stringify({ model: c.spec.draft, num_speculative_tokens: c.spec.tokens }));
  if (c.lora.on) {
    add("--enable-lora");
    add("--max-loras", String(c.lora.max));
    add("--max-lora-rank", String(c.lora.rank));
    if (c.lora.modules.length) add("--lora-modules", c.lora.modules.join(" "));
  }
  const rest = [...c.customFlags];
  while (rest.length) {
    const f = rest.shift() ?? "";
    add(f, rest.length && !rest[0].startsWith("-") ? (rest.shift() ?? null) : null, "custom");
  }
  const cards = Array.from({ length: cardsOf(c) }, (_, i) => d.gpu + i).join(",");
  return { env: [["CUDA_VISIBLE_DEVICES", cards], ["HF_HUB_OFFLINE", "1"], ...c.env], args: a };
}

function compactJson(t: string): string {
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return t.trim();
  }
}

/** The command as one shell line per flag, for the preview and for copying. */
export function commandText(d: Draft, m: CachedModel | undefined, floor: number): string {
  const { env, args } = argv(d, m, floor);
  const lines = [...env.map(([k, v]) => `${k}=${q(v)}`), `vllm serve ${q(d.repo || "<model>")}`, ...args.map(([f, v]) => (v === null ? f : `${f} ${f === "--lora-modules" ? v : q(v)}`))];
  return lines.map((l, i) => (i < lines.length - 1 ? `${l} \\` : l)).join("\n  ");
}

// ---------- reading a pasted command back ----------

/** Splits a shell line into words: quotes group, a backslash-newline joins, nothing is expanded. */
export function words(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let any = false;
  const t = text.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

const BOOL_ON: Record<string, (c: EngineConfig) => void> = {
  "--enable-prefix-caching": (c) => void (c.prefixCaching = true),
  "--no-enable-prefix-caching": (c) => void (c.prefixCaching = false),
  "--enable-chunked-prefill": (c) => void (c.chunkedPrefill = true),
  "--no-enable-chunked-prefill": (c) => void (c.chunkedPrefill = false),
  "--enforce-eager": (c) => void (c.eager = true),
  "--trust-remote-code": (c) => void (c.remoteCode = true),
  "--enable-auto-tool-choice": (c) => void (c.autoTools = true),
  "--enable-lora": (c) => void (c.lora.on = true),
};

/**
 * Reads `vllm serve <model> --flag value ...` (with leading VAR=value words) into a draft over `base`.
 * Flags with a field fill it; managed ones are refused with the reason; anything else is kept as a custom flag.
 */
export function parseCommand(text: string, base: Draft): { draft: Draft; error?: string } {
  const w = words(text.trim());
  const c: EngineConfig = structuredClone(base.cfg);
  const d: Draft = { ...base, cfg: c, extraAliases: [...base.extraAliases] };
  c.env = [];
  c.customFlags = [];
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) {
    const [k, ...v] = (w.shift() ?? "").split("=");
    if (!MANAGED_ENV.includes(k)) c.env.push([k, v.join("=")]);
  }
  if (w[0] === "vllm" && w[1] === "serve") w.splice(0, 2);
  else if (w[0] === "python" || w[0] === "python3") return { draft: base, error: "Start it with vllm serve <model>; the API server module form is not read here." };
  else return { draft: base, error: "A command starts with vllm serve <model>." };
  const repo = w[0] && !w[0].startsWith("-") ? (w.shift() ?? "") : "";
  if (!repo) return { draft: base, error: "No model after vllm serve." };
  if (!CATALOG.some((m) => m.repo === repo && m.cached)) return { draft: base, error: `${repo} is not in the model cache; download it first.` };
  d.repo = repo;
  const num = (v: string | undefined, f: string): number => {
    const n = Number(v);
    if (v === undefined || v === "" || !Number.isFinite(n)) throw new Error(`${f} needs a number.`);
    return n;
  };
  try {
    while (w.length) {
      const tok = w.shift() ?? "";
      const [flag, inline] = tok.includes("=") ? [tok.slice(0, tok.indexOf("=")), tok.slice(tok.indexOf("=") + 1)] : [tok, undefined];
      if (!flag.startsWith("--")) throw new Error(`${tok} is a value without a flag before it.`);
      if (MANAGED_FLAGS.includes(flag)) throw new Error(`${flag} is decided by the manager, not the deployment; leave it out.`);
      if (BOOL_ON[flag]) {
        BOOL_ON[flag](c);
        continue;
      }
      const takes = FIELD_FLAGS[flag] !== undefined || (w.length > 0 && !w[0].startsWith("-"));
      const v = inline ?? (takes && w.length && !w[0].startsWith("--") ? w.shift() : undefined);
      switch (flag) {
        case "--served-model-name": d.alias = v ?? d.alias; break;
        case "--tensor-parallel-size": c.tp = num(v, flag); break;
        case "--pipeline-parallel-size": c.pp = num(v, flag); break;
        case "--max-model-len": d.maxLen = num(v, flag); break;
        case "--max-num-seqs": d.maxSeqs = num(v, flag); break;
        case "--max-num-batched-tokens": c.maxBatched = num(v, flag); break;
        case "--gpu-memory-utilization": c.memUtil = num(v, flag); break;
        case "--kv-cache-dtype": c.kvDtype = v?.startsWith("fp8") ? "fp8" : "auto"; break;
        case "--block-size": c.blockSize = num(v, flag) === 32 ? 32 : 16; break;
        case "--swap-space": c.swapGiB = num(v, flag); break;
        case "--cpu-offload-gb": c.offloadGiB = num(v, flag); break;
        case "--dtype": c.dtype = v === "bfloat16" || v === "float16" ? v : "auto"; break;
        case "--quantization": c.quant = v === "fp8" || v === "bitsandbytes" ? v : "none"; break;
        case "--tool-call-parser": c.toolParser = v ?? ""; break;
        case "--reasoning-parser": c.thinkParser = v ?? ""; break;
        case "--chat-template": c.templatePath = v ?? ""; break;
        case "--default-chat-template-kwargs": c.chatKwargs = v ?? ""; break;
        case "--generation-config": c.generationConfig = v === "vllm" ? "vllm" : "auto"; break;
        case "--max-loras": c.lora.max = num(v, flag); break;
        case "--max-lora-rank": c.lora.rank = num(v, flag); break;
        case "--lora-modules": {
          const mods = v ? [v] : [];
          while (w.length && !w[0].startsWith("--")) mods.push(w.shift() ?? "");
          c.lora.modules = mods;
          break;
        }
        case "--speculative-config": {
          const sc = JSON.parse(v ?? "{}") as { method?: string; model?: string; num_speculative_tokens?: number };
          c.spec = sc.method === "ngram" ? { method: "ngram", tokens: sc.num_speculative_tokens ?? 3, draft: "" } : { method: "draft", tokens: sc.num_speculative_tokens ?? 3, draft: sc.model ?? "" };
          break;
        }
        case "--runner": case "--task": break;
        default:
          c.customFlags.push(flag, ...(v === undefined ? [] : [v]));
      }
    }
  } catch (e) {
    return { draft: base, error: e instanceof Error ? e.message : String(e) };
  }
  return { draft: d };
}

/** The flags a running deployment would change on restart, for the card's "Restart to apply" note. */
export function changedFlags(a: Draft, b: Draft, m: CachedModel | undefined): string[] {
  const pick = (d: Draft): Map<string, string> => new Map(argv(d, m, 0).args.filter(([f]) => f !== "--gpu-memory-utilization").map(([f, v]) => [f, v ?? ""]));
  const x = pick(a);
  const y = pick(b);
  const out: string[] = [];
  for (const f of new Set([...x.keys(), ...y.keys()])) if (x.get(f) !== y.get(f)) out.push(f);
  if (a.cfg.image !== b.cfg.image) out.push("image");
  if (JSON.stringify(a.cfg.env) !== JSON.stringify(b.cfg.env)) out.push("env");
  return out;
}
