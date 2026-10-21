// The local model cache: what a deployment can be made from. Public model names, or the portfolio's
// placeholders; sizes are close to the real checkpoints, the rest is invented.

import type { CachedModel } from "./types";

export const CATALOG: CachedModel[] = [
  { repo: "Qwen/Qwen3-32B", arch: "Qwen3ForCausalLM, dense", params: "32.8B", weightsGiB: 61.0, maxCtx: 40960, kvPerK: 0.25, precision: "bf16", kind: "generate", cached: true },
  { repo: "meta-llama/Llama-3.3-70B-Instruct-FP8", arch: "LlamaForCausalLM, dense, FP8", params: "70.6B", weightsGiB: 68.0, maxCtx: 131072, kvPerK: 0.31, precision: "fp8", kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-Embedding-8B", arch: "Qwen3Model, embedding", params: "7.6B", weightsGiB: 15.1, maxCtx: 32768, kvPerK: 0.14, precision: "bf16", kind: "embed", cached: true },
  { repo: "Qwen/Qwen2.5-7B-Instruct", arch: "Qwen2ForCausalLM, dense", params: "7.6B", weightsGiB: 14.2, maxCtx: 32768, kvPerK: 0.055, precision: "bf16", kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-14B", arch: "Qwen3ForCausalLM, dense", params: "14.8B", weightsGiB: 27.5, maxCtx: 40960, kvPerK: 0.16, precision: "bf16", kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-8B", arch: "Qwen3ForCausalLM, dense", params: "8.2B", weightsGiB: 15.3, maxCtx: 40960, kvPerK: 0.14, precision: "bf16", kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-0.6B", arch: "Qwen3ForCausalLM, dense", params: "0.6B", weightsGiB: 1.4, maxCtx: 40960, kvPerK: 0.11, precision: "bf16", kind: "generate", cached: true },
  { repo: "meta-llama/Llama-3.2-1B-Instruct", arch: "LlamaForCausalLM, dense", params: "1.2B", weightsGiB: 2.3, maxCtx: 131072, kvPerK: 0.03, precision: "bf16", kind: "generate", cached: true },
  { repo: "mistralai/Mistral-Small-3.2-24B-Instruct-2506", arch: "Mistral3ForConditionalGeneration, dense", params: "24.0B", weightsGiB: 44.7, maxCtx: 131072, kvPerK: 0.16, precision: "bf16", kind: "generate", cached: true },
  { repo: "google/gemma-3-27b-it", arch: "Gemma3ForConditionalGeneration, dense", params: "27.4B", weightsGiB: 51.2, maxCtx: 131072, kvPerK: 0.24, precision: "bf16", kind: "generate", cached: true },
  { repo: "model-a (MoE 30B-A3B)", arch: "MoE, 3B active", params: "30.5B", weightsGiB: 56.9, maxCtx: 65536, kvPerK: 0.09, precision: "bf16", kind: "generate", cached: true },
  { repo: "model-b-14b", arch: "dense", params: "14.0B", weightsGiB: 26.1, maxCtx: 32768, kvPerK: 0.16, precision: "bf16", kind: "generate", cached: true },
  { repo: "model-c-8b", arch: "dense", params: "8.0B", weightsGiB: 15.0, maxCtx: 32768, kvPerK: 0.13, precision: "bf16", kind: "generate", cached: true },
  { repo: "Qwen/Qwen3-30B-A3B-Instruct-2507", arch: "Qwen3MoeForCausalLM, MoE, 3.3B active", params: "30.5B", weightsGiB: 56.9, maxCtx: 262144, kvPerK: 0.09, precision: "bf16", kind: "generate", cached: false },
  { repo: "meta-llama/Llama-3.1-8B-Instruct", arch: "LlamaForCausalLM, dense", params: "8.0B", weightsGiB: 15.0, maxCtx: 131072, kvPerK: 0.125, precision: "bf16", kind: "generate", cached: false },
  { repo: "meta-llama/Llama-3.3-70B-Instruct", arch: "LlamaForCausalLM, dense", params: "70.6B", weightsGiB: 131.4, maxCtx: 131072, kvPerK: 0.31, precision: "bf16", kind: "generate", cached: false },
];

/** The checkpoint's publisher: a draft model for speculative decoding has to share the target's tokenizer. */
export const family = (repo: string): string => (repo.includes("/") ? repo.split("/")[0] : "");

/** Small checkpoints in the cache that can serve as a draft model. */
export const drafts = (): CachedModel[] => CATALOG.filter((m) => m.cached && m.kind === "generate" && m.weightsGiB < 4);

export const draftGiB = (repo: string): number => CATALOG.find((m) => m.repo === repo)?.weightsGiB ?? 0;
