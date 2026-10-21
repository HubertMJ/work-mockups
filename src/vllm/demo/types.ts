// The demo's model of a multi-GPU deployment manager: everything the page shows is derived from one
// State, and every change to it is a pure function in actions.ts or tick.ts. Nothing here talks to a
// network or a GPU; the numbers are made up.

export type Status = "Running" | "Starting" | "Stopping" | "Stopped" | "Error";
/** Where a deployment's memory floor came from: the engine's own log, the driver, or a guess from config.json. */
export type UtilSource = "engine-log" | "nvidia-smi" | "estimate";
export type Level = "INFO" | "WARNING" | "ERROR";

export interface LogLine {
  t: number;
  level: Level;
  text: string;
}

/** A start, stop or restart in progress: which scripted step it has reached since `at`. */
export interface Phase {
  kind: "start" | "stop" | "restart";
  at: number;
  step: number;
  /** Why it stops ("operator", "evicted for model-a-moe", ...). */
  why: string;
}

/** Engine settings beyond length and batch width: what `vllm serve` is started with (config.ts builds the argv). */
export interface EngineConfig {
  /** Cards one layer is split across, and stages the layer stack is cut into; the deployment holds tp × pp cards from `gpu` up. */
  tp: number;
  pp: number;
  image: string;
  /** Explicit --gpu-memory-utilization; null leaves it to the scheduler, which passes the measured floor. */
  memUtil: number | null;
  /** Null: the engine's own default. */
  maxBatched: number | null;
  kvDtype: "auto" | "fp8";
  blockSize: 16 | 32;
  swapGiB: number;
  offloadGiB: number;
  dtype: "auto" | "bfloat16" | "float16";
  quant: "none" | "fp8" | "bitsandbytes";
  prefixCaching: boolean;
  chunkedPrefill: boolean;
  eager: boolean;
  remoteCode: boolean;
  toolParser: string;
  autoTools: boolean;
  thinkParser: string;
  templatePath: string;
  /** A JSON object as typed, "" for none; validated before it is saved. */
  chatKwargs: string;
  generationConfig: "auto" | "vllm";
  spec: { method: "none" | "ngram" | "draft"; tokens: number; draft: string };
  lora: { on: boolean; max: number; rank: number; modules: string[] };
  env: [string, string][];
  customFlags: string[];
  coldStartS: number;
  idleMin: number;
}

/** What the estimate knows about the weights, copied from the cache entry when the deployment is made. */
export interface ModelMem {
  weightsGiB: number;
  kvPerK: number;
  precision: "bf16" | "fp8";
}

/** Edits a running engine has not picked up yet. */
export interface Pending {
  maxLen: number;
  maxSeqs: number;
  cfg: EngineConfig;
}

export interface Deployment {
  alias: string;
  model: string;
  gpu: number;
  kind: "generate" | "embed";
  status: Status;
  pinned: boolean;
  /** Started on demand by the gateway, and evictable while idle. */
  lazy: boolean;
  /** The memory floor as a fraction of the card: measured, or the estimate when `source` says so. */
  minUtil: number;
  source: UtilSource;
  /** The max length `minUtil` was taken at; when it differs from maxLen the profile is stale. */
  profileLen: number;
  /** The settings `minUtil` was taken at; a memory-relevant change makes the profile stale too. */
  profileCfg: EngineConfig;
  cfg: EngineConfig;
  mem: ModelMem;
  /** What the engine will measure above the estimate on its first start (the simulation's truth). */
  drift: number;
  maxLen: number;
  maxSeqs: number;
  /** KV cache in tokens, as the engine last reported it; null for embeddings or never measured. */
  kvTokens: number | null;
  kvLen: number;
  /** Edited parameters a running engine has not picked up yet ("Restart to apply"). */
  pending: Pending | null;
  extraAliases: string[];
  error: string | null;
  /** The last refused start, shown on the card until the next start or a dismiss. */
  refused: string | null;
  lastUsed: number;
  phase: Phase | null;
  log: LogLine[];
  /** Baseline utilization while it runs (telemetry). */
  load: number;
}

export interface Gpu {
  index: number;
  blocked: string | null;
}

export type ResStatus = "Scheduled" | "Active" | "Completed" | "Unfulfillable";

export interface Reservation {
  id: string;
  name: string;
  alias: string;
  start: number;
  end: number;
  /** Admission order: an earlier booking keeps its promise over a later one. */
  created: number;
  status: ResStatus;
  reason: string | null;
}

export interface Req {
  id: string;
  t: number;
  alias: string;
  path: string;
  status: number;
  ms: number;
  cold: boolean;
  ip: string;
  prompt: string;
  output: string;
}

export interface Download {
  id: string;
  repo: string;
  state: "running" | "completed" | "failed" | "cancelled";
  bytes: number;
  /** Null when the hub did not report a size: the page then says "unknown", never a guess. */
  total: number | null;
  /** The size the simulation finishes at (hidden while `total` is null). */
  finalBytes: number;
  speed: number;
  error: string | null;
}

export interface CachedModel {
  repo: string;
  arch: string;
  params: string;
  weightsGiB: number;
  maxCtx: number;
  /** KV cache per 1k tokens of context, GiB. */
  kvPerK: number;
  precision: "bf16" | "fp8";
  kind: "generate" | "embed";
  cached: boolean;
}

export interface Stream {
  id: string;
  alias: string;
  path: string;
  prompt: string;
  tokens: string[];
  t0: number;
  phase: "cold" | "streaming" | "done" | "failed";
  cold: boolean;
  streamStart: number | null;
  shown: number;
  tokenMs: number;
  status: number | null;
  error: string | null;
  endedAt: number | null;
}

/** One metric over time: the last HISTORY samples at 1 s, and a longer ring of 15 s averages. */
export interface Series {
  fine: number[];
  coarse: number[];
}

export interface CardSeries {
  util: Series;
  vram: Series;
  temp: Series;
  power: Series;
  sm: Series;
  memClock: Series;
  fan: Series;
}

export interface HostSeries {
  cpu: Series;
  cpuTemp: Series;
  ram: Series;
  load: Series;
  diskRead: Series;
  diskWrite: Series;
  netRx: Series;
}

/** What one engine's /metrics endpoint reports, sampled once a second (zeros while it is down). */
export interface EngineSeries {
  reqRate: Series;
  promptTps: Series;
  genTps: Series;
  ttft50: Series;
  ttft95: Series;
  itl50: Series;
  itl95: Series;
  e2e50: Series;
  e2e95: Series;
  running: Series;
  waiting: Series;
  kvUsage: Series;
  prefixHit: Series;
  preempt: Series;
  accept: Series;
}

export interface Telemetry {
  at: number;
  /** Samples taken so far: every 15th closes a coarse point. */
  n: number;
  gpus: CardSeries[];
  host: HostSeries;
  engines: Record<string, EngineSeries>;
  /** Preemptions since each engine started, as the counter reads. */
  preemptTotal: Record<string, number>;
}

export interface Notice {
  id: number;
  level: "info" | "warn" | "error";
  text: string;
}

export interface Event {
  t: number;
  level: "info" | "warn" | "error";
  text: string;
}

export interface Conflict {
  action: string;
  message: string;
  remedy: string;
  item: Reservation;
}

export interface State {
  now: number;
  gpus: Gpu[];
  deps: Deployment[];
  reservations: Reservation[];
  requests: Req[];
  background: Req[];
  downloads: Download[];
  catalog: CachedModel[];
  telemetry: Telemetry;
  stream: Stream | null;
  notice: Notice | null;
  events: Event[];
  seq: number;
}
