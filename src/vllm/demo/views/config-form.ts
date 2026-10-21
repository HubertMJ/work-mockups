// The deployment form, for New deployment and for Edit: every setting the engine is started with,
// grouped as the dialog reads top to bottom (model and placement, context and memory, then the engine,
// serving, speculative decoding, adapters, environment, lifecycle and custom flags, folded), with the
// fit on the cards and the resulting `vllm serve` command kept current as the visitor types.

import { h, replace, setText } from "../../../lib/dom";
import { admitCards } from "../admission";
import { drafts } from "../catalog";
import {
  commandText, defaultConfig, estimateFloor, IMAGES, LORA_RANKS, longestContext, parseCommand, PP_SIZES, REASONING_PARSERS, suggestedConfig, TOOL_PARSERS, TP_SIZES,
  validate, words, type Draft, type Problems,
} from "../config";
import { CARD_GIB, CEILING, floorAt, int, slug, util } from "../model";
import { budgetOn } from "../sim";
import type { CachedModel, Deployment, EngineConfig } from "../types";
import { select, type Ctx } from "../ui";

export const LENS = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

export interface ConfigForm {
  el: HTMLElement;
  read(): Draft;
  model(): CachedModel | undefined;
  /** Marks every field a refused save names, opens its group and focuses the first. */
  show(p: Problems): void;
}

type Input = HTMLInputElement;
const input = (attrs: Record<string, string | undefined> = {}): Input => h("input", { class: "vd-input", autocomplete: "off", spellcheck: "false", ...attrs });
const numIn = (attrs: Record<string, string | undefined> = {}): Input => input({ type: "number", inputmode: "decimal", ...attrs });
const check = (on: boolean): Input => h("input", { type: "checkbox", checked: on });
const area = (attrs: Record<string, string | undefined> = {}): HTMLTextAreaElement => h("textarea", { class: "vd-input vd-textarea", spellcheck: "false", rows: "3", ...attrs });
const opt = (v: (string | number)[]): [string, string][] => v.map((x) => [String(x), String(x)]);

export function configForm(ctx: Ctx, o: { mode: "new" | "edit"; dep?: Deployment }): ConfigForm {
  const s0 = ctx.store.get();
  const edit = o.mode === "edit" && o.dep ? o.dep : null;
  const cached = s0.catalog.filter((m) => m.cached);
  const errs = new Map<string, HTMLElement>();
  const ids = new Map<string, HTMLElement>();
  let seq = 0;
  const uid = `vd-cf${Date.now().toString(36)}`;

  /** A labelled control with its help text and an error slot that a refused save fills. */
  const fld = (key: string, label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const id = `${uid}-${++seq}`;
    control.id = id;
    const err = h("span", { class: "vd-field__err", id: `${id}-e`, role: "alert" });
    const help = hint ? h("span", { class: "vd-field__hint", id: `${id}-h` }, hint) : null;
    control.setAttribute("aria-describedby", [help ? `${id}-h` : "", `${id}-e`].filter(Boolean).join(" "));
    errs.set(key, err);
    ids.set(key, control);
    return h("div", { class: "vd-field" }, h("label", { class: "vd-field__label", for: id }, label), control, help, err);
  };
  const tog = (key: string, label: string, control: Input, hint?: string): HTMLElement => {
    const id = `${uid}-${++seq}`;
    control.id = id;
    const err = h("span", { class: "vd-field__err", role: "alert" });
    errs.set(key, err);
    ids.set(key, control);
    return h("div", { class: "vd-field vd-field--check" }, h("label", { class: "vd-check", for: id }, control, h("span", {}, label)), hint ? h("span", { class: "vd-field__hint" }, hint) : null, err);
  };

  // ---------- controls ----------
  const init = edit ? (edit.pending ? { ...edit, maxLen: edit.pending.maxLen, maxSeqs: edit.pending.maxSeqs, cfg: edit.pending.cfg } : edit) : null;
  const c0: EngineConfig = structuredClone(init?.cfg ?? suggestedConfig(cached.find((m) => m.repo === "Qwen/Qwen3-14B") ?? cached[0]));
  const model = select(cached.map((m) => [m.repo, `${m.repo} · ${m.weightsGiB.toFixed(1)} GiB`]), edit?.model ?? "Qwen/Qwen3-14B");
  const alias = input({ maxlength: "40" });
  const extra = input({ placeholder: "chat-default, assistant" });
  const live = !!edit && (edit.status === "Running" || edit.status === "Starting");
  const gpu = select(s0.gpus.map((g) => [String(g.index), `GPU ${g.index}${g.blocked ? " · blocked" : ""}`]), String(edit?.gpu ?? 3));
  if (live) gpu.disabled = true;
  const tp = select(opt(TP_SIZES), String(c0.tp));
  const pp = select(opt(PP_SIZES), String(c0.pp));
  const image = select(IMAGES, c0.image);
  const lens = h("datalist", { id: `${uid}-lens` }, LENS.map((n) => h("option", { value: String(n) })));
  const maxLen = numIn({ min: "256", step: "256", list: `${uid}-lens`, inputmode: "numeric" });
  const maxSeqs = numIn({ min: "1", max: "1024", step: "1", inputmode: "numeric" });
  const maxBatched = numIn({ min: "1", step: "256", placeholder: "engine default", inputmode: "numeric" });
  const memUtil = numIn({ min: "0.05", max: String(CEILING), step: "0.01", placeholder: "measured floor" });
  const kvAuto = h("input", { type: "radio", name: `${uid}-kv`, value: "auto" });
  const kvFp8 = h("input", { type: "radio", name: `${uid}-kv`, value: "fp8" });
  const kvRows = { auto: h("span", { class: "vd-kvrow__fit" }, " "), fp8: h("span", { class: "vd-kvrow__fit" }, " ") };
  const ctxLine = h("p", { class: "vd-ctxline" }, " ");
  const blockSize = select(opt([16, 32]), String(c0.blockSize));
  const swap = numIn({ min: "0", max: "64", step: "1" });
  const offload = numIn({ min: "0", step: "1" });
  const dtype = select([["auto", "auto (from the checkpoint)"], ["bfloat16", "bfloat16"], ["float16", "float16"]], c0.dtype);
  const quant = select([["none", "none (as stored)"], ["fp8", "fp8, quantized at load"], ["bitsandbytes", "bitsandbytes, 4-bit at load"]], c0.quant);
  const prefix = check(c0.prefixCaching);
  const chunked = check(c0.chunkedPrefill);
  const eager = check(c0.eager);
  const trust = check(c0.remoteCode);
  const toolParser = select([["", "none"], ...opt(TOOL_PARSERS)], c0.toolParser);
  const autoTools = check(c0.autoTools);
  const reasoning = select([["", "none"], ...opt(REASONING_PARSERS)], c0.thinkParser);
  const template = input({ placeholder: "/templates/tool_chat.jinja" });
  const kwargs = area({ placeholder: '{"enable_thinking": false}' });
  const genCfg = select([["auto", "auto: the model's generation_config.json"], ["vllm", "vllm: the engine's own defaults"]], c0.generationConfig);
  const specMethod = select([["none", "off"], ["ngram", "n-gram (prompt lookup)"], ["draft", "draft model"]], c0.spec.method);
  const specTokens = numIn({ min: "1", max: "8", step: "1", inputmode: "numeric" });
  const specDraft = select([["", "pick a draft model"], ...drafts().map((m): [string, string] => [m.repo, `${m.repo} · ${m.weightsGiB.toFixed(1)} GiB`])], c0.spec.draft);
  const loraOn = check(c0.lora.on);
  const loraMax = numIn({ min: "1", max: "16", step: "1", inputmode: "numeric" });
  const loraRank = select(opt(LORA_RANKS), String(c0.lora.rank));
  const loraMods = area({ placeholder: "sql-helper=acme/qwen3-sql-lora" });
  const env = area({ placeholder: "VLLM_LOGGING_LEVEL=DEBUG\nNCCL_DEBUG=WARN" });
  const lazy = check(init?.lazy ?? true);
  const idle = numIn({ min: "1", max: "240", step: "1", inputmode: "numeric" });
  const cold = numIn({ min: "60", max: "1800", step: "10", inputmode: "numeric" });
  const flags = area({ placeholder: "--seed 42 --max-logprobs 10" });
  const info = h("dl", { class: "vd-info" });
  const cardsHint = h("span", { class: "vd-field__hint" }, " ");
  const fit = h("div", { class: "vd-fit", "aria-live": "polite" });
  const preview = h("pre", { class: "vd-code vd-cmd", tabindex: "0", "aria-label": "The command the manager will run", "data-scroll": "cmd" });
  const counts = new Map<string, HTMLElement>();

  const fillFrom = (d: Draft): void => {
    const c = d.cfg;
    model.value = d.repo;
    alias.value = d.alias;
    extra.value = d.extraAliases.join(", ");
    gpu.value = String(d.gpu);
    tp.value = String(c.tp);
    pp.value = String(c.pp);
    image.value = c.image;
    maxLen.value = String(d.maxLen);
    maxSeqs.value = String(d.maxSeqs);
    maxBatched.value = c.maxBatched === null ? "" : String(c.maxBatched);
    memUtil.value = c.memUtil === null ? "" : String(c.memUtil);
    (c.kvDtype === "fp8" ? kvFp8 : kvAuto).checked = true;
    blockSize.value = String(c.blockSize);
    swap.value = String(c.swapGiB);
    offload.value = String(c.offloadGiB);
    dtype.value = c.dtype;
    quant.value = c.quant;
    prefix.checked = c.prefixCaching;
    chunked.checked = c.chunkedPrefill;
    eager.checked = c.eager;
    trust.checked = c.remoteCode;
    toolParser.value = c.toolParser;
    autoTools.checked = c.autoTools;
    reasoning.value = c.thinkParser;
    template.value = c.templatePath;
    kwargs.value = c.chatKwargs;
    genCfg.value = c.generationConfig;
    specMethod.value = c.spec.method;
    specTokens.value = String(c.spec.tokens);
    specDraft.value = c.spec.draft;
    loraOn.checked = c.lora.on;
    loraMax.value = String(c.lora.max);
    loraRank.value = String(c.lora.rank);
    loraMods.value = c.lora.modules.join("\n");
    env.value = c.env.map(([k, v]) => `${k}=${v}`).join("\n");
    lazy.checked = d.lazy;
    idle.value = String(c.idleMin);
    cold.value = String(c.coldStartS);
    flags.value = c.customFlags.join(" ");
  };

  const num = (el: Input): number => (el.value.trim() === "" ? Number.NaN : Number(el.value));
  const opt0 = (el: Input): number | null => (el.value.trim() === "" ? null : Number(el.value));
  const read = (): Draft => ({
    alias: edit ? edit.alias : alias.value.trim(),
    repo: edit ? edit.model : model.value,
    gpu: Number(gpu.value),
    maxLen: num(maxLen),
    maxSeqs: num(maxSeqs),
    lazy: lazy.checked,
    extraAliases: extra.value.split(/[\s,]+/).filter(Boolean),
    cfg: {
      tp: Number(tp.value), pp: Number(pp.value), image: image.value, memUtil: opt0(memUtil), maxBatched: opt0(maxBatched),
      kvDtype: kvFp8.checked ? "fp8" : "auto", blockSize: blockSize.value === "32" ? 32 : 16, swapGiB: num(swap), offloadGiB: num(offload),
      dtype: dtype.value as EngineConfig["dtype"], quant: quant.value as EngineConfig["quant"], prefixCaching: prefix.checked, chunkedPrefill: chunked.checked,
      eager: eager.checked, remoteCode: trust.checked, toolParser: toolParser.value, autoTools: autoTools.checked, thinkParser: reasoning.value,
      templatePath: template.value.trim(), chatKwargs: kwargs.value.trim(), generationConfig: genCfg.value === "vllm" ? "vllm" : "auto",
      spec: { method: specMethod.value as EngineConfig["spec"]["method"], tokens: num(specTokens), draft: specDraft.value },
      lora: { on: loraOn.checked, max: num(loraMax), rank: Number(loraRank.value), modules: loraMods.value.split(/\s+/).filter(Boolean) },
      env: env.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l): [string, string] => (l.includes("=") ? [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] : [l, ""])),
      customFlags: words(flags.value),
      coldStartS: num(cold), idleMin: num(idle),
    },
  });
  const current = (): CachedModel | undefined => s0.catalog.find((m) => m.repo === (edit ? edit.model : model.value));

  fillFrom({
    alias: edit?.alias ?? "", repo: edit?.model ?? model.value, gpu: edit?.gpu ?? 3, maxLen: init?.maxLen ?? 32768, maxSeqs: init?.maxSeqs ?? 32,
    lazy: init?.lazy ?? true, extraAliases: edit?.extraAliases ?? [], cfg: c0,
  });

  // ---------- groups ----------
  const groups: [string, string, boolean, HTMLElement[], (c: EngineConfig, d: Draft) => number][] = [];
  const def = defaultConfig();
  const n = (...xs: boolean[]): number => xs.filter(Boolean).length;
  const group = (id: string, title: string, open: boolean, body: HTMLElement[], changed: (c: EngineConfig, d: Draft) => number): HTMLElement => {
    groups.push([id, title, open, body, changed]);
    const count = h("span", { class: "vd-group__count vd-faint" }, " ");
    counts.set(id, count);
    if (open) return h("section", { class: "vd-group", "data-group": id, "aria-label": title }, h("h4", { class: "vd-group__title" }, title, count), ...body);
    return h("details", { class: "vd-group", "data-group": id }, h("summary", { class: "vd-group__title" }, title, count), h("div", { class: "vd-group__body" }, body));
  };

  const modeTabs = !edit ? pasteMode() : null;
  const placement = group("model", "Model & placement", true, [
    edit
      ? h("div", { class: "vd-field" }, h("span", { class: "vd-field__label" }, "Model"), h("code", { class: "vd-fixed" }, edit.model), h("span", { class: "vd-field__hint" }, "A deployment keeps its model; make a new one for another."))
      : fld("repo", "Model (cached)", model, "Only models in the local cache: the engines run offline against a read-only copy."),
    info,
    h("div", { class: "vd-form vd-form--2" },
      edit
        ? h("div", { class: "vd-field" }, h("span", { class: "vd-field__label" }, "Alias (served model name)"), h("code", { class: "vd-fixed" }, edit.alias))
        : fld("alias", "Alias (served model name)", alias, "The name clients put in model, and the deployment's key."),
      fld("extraAliases", "Extra names", extra, "Other names the gateway routes here; no restart needed."),
    ),
    h("div", { class: "vd-form vd-form--3" },
      fld("gpu", "GPU (first card)", gpu, live ? "Stop the deployment to move it." : undefined),
      fld("tp", "Tensor parallel", tp),
      fld("pp", "Pipeline parallel", pp),
    ),
    cardsHint,
    fld("image", "Image", image, "The container the engine runs in; a custom build carries extra packages."),
  ], (c, d) => n(c.tp !== 1, c.pp !== 1, c.image !== def.image, d.extraAliases.length > 0));

  const kvRow = (radio: Input, title: string, fitEl: HTMLElement, note: string): HTMLElement =>
    h("label", { class: "vd-kvrow" }, radio, h("span", { class: "vd-kvrow__text" }, h("strong", {}, title), fitEl, h("span", { class: "vd-faint" }, note)));
  const memory = group("memory", "Context & memory", true, [
    h("div", { class: "vd-form vd-form--2" },
      fld("maxLen", "Max model length (tokens)", maxLen, "The longest prompt plus answer a request may have."),
      fld("maxSeqs", "Max num seqs", maxSeqs, "Requests the engine runs at once; more queue."),
    ),
    h("fieldset", { class: "vd-kvset" }, h("legend", { class: "vd-field__label" }, "KV cache dtype"),
      kvRow(kvAuto, "auto", kvRows.auto, "Keys and values at the model's own precision."),
      kvRow(kvFp8, "fp8", kvRows.fp8, "About twice the context per GiB, at a small cost in accuracy."),
    ),
    ctxLine,
    h("div", { class: "vd-form vd-form--2" },
      fld("memUtil", "GPU memory utilization", memUtil, "Empty: the scheduler passes the measured floor. A number reserves that share of each card."),
      fld("maxBatched", "Max batched tokens", maxBatched, "Tokens one engine step may process; empty for the engine's default."),
      fld("blockSize", "Block size (tokens)", blockSize, "The KV cache's page size."),
      fld("swapGiB", "Swap space (GiB)", swap, "Host memory per card for preempted sequences."),
      fld("offloadGiB", "CPU offload (GiB)", offload, "Weights kept in host memory per card: room on the card, at a speed cost."),
    ),
    fit,
  ], (c) => n(c.memUtil !== null, c.maxBatched !== null, c.kvDtype !== "auto", c.blockSize !== 16, c.swapGiB !== 4, c.offloadGiB !== 0));

  const engine = group("engine", "Engine", false, [
    h("div", { class: "vd-form vd-form--2" },
      fld("dtype", "Dtype", dtype, "Precision of weights and activations."),
      fld("quant", "Quantization", quant, "Shrinks the weights as they load; the floor follows."),
    ),
    h("div", { class: "vd-form vd-form--2" },
      tog("prefixCaching", "Prefix caching", prefix, "Reuses the KV blocks of a prompt prefix seen before."),
      tog("chunkedPrefill", "Chunked prefill", chunked, "Splits long prompts so they do not stall the decoding batch."),
      tog("eager", "Enforce eager", eager, "No CUDA graphs: less memory, slower steps."),
      tog("remoteCode", "Trust remote code", trust, "Runs the model repository's own Python; only for repositories you trust."),
    ),
  ], (c) => n(c.dtype !== "auto", c.quant !== "none", !c.prefixCaching, !c.chunkedPrefill, c.eager, c.remoteCode));

  const serving = group("serving", "Serving & chat", false, [
    h("div", { class: "vd-form vd-form--2" },
      fld("toolParser", "Tool-call parser", toolParser, "Reads tool calls out of the model's text, in its family's format."),
      fld("thinkParser", "Reasoning parser", reasoning, "Moves the model's thinking into reasoning_content."),
    ),
    tog("autoTools", "Auto tool choice", autoTools, "Lets the model decide when to call a tool (tool_choice: auto)."),
    fld("templatePath", "Chat template", template, "A .jinja file inside the image; empty uses the one the model ships."),
    fld("chatKwargs", "Chat template kwargs", kwargs, "Server-wide defaults for the template, as a JSON object, such as turning thinking off."),
    fld("generationConfig", "Generation config", genCfg, "Where default sampling settings come from."),
  ], (c) => n(!!c.toolParser, !!c.thinkParser, c.autoTools, !!c.templatePath, !!c.chatKwargs, c.generationConfig !== "auto"));

  const spec = group("spec", "Speculative decoding", false, [
    h("div", { class: "vd-form vd-form--3" },
      fld("spec", "Method", specMethod, "Proposes tokens cheaply, then verifies them in one step."),
      fld("specTokens", "Tokens per step", specTokens),
      fld("specDraft", "Draft model", specDraft, "Same family as the model, so the tokenizers match."),
    ),
  ], (c) => n(c.spec.method !== "none"));

  const lora = group("lora", "LoRA adapters", false, [
    tog("lora", "Enable LoRA", loraOn, "Serves adapters on top of the base weights; each costs a little memory."),
    h("div", { class: "vd-form vd-form--2" }, fld("loraMax", "Max adapters in a batch", loraMax), fld("loraRank", "Max rank", loraRank)),
    fld("loraModules", "Adapters to load", loraMods, "name=org/adapter, one per line; clients pick one by its name in model."),
  ], (c) => n(c.lora.on));

  const envGroup = group("env", "Environment", false, [
    fld("env", "Variables", env, "NAME=value, one per line, passed to the container. GPU selection and the offline cache are the manager's."),
  ], (c) => c.env.length);

  const life = group("life", "Lifecycle", false, [
    tog("lazy", "Lazy", lazy, "Started on demand by the gateway, and evictable while idle."),
    h("div", { class: "vd-form vd-form--2" },
      fld("idleMin", "Idle timeout (min)", idle, "A lazy deployment stops after this long without a request."),
      fld("coldStartS", "Cold-start ceiling (s)", cold, "A start not ready by then is called stuck and removed."),
    ),
  ], (c, d) => n(!d.lazy, c.idleMin !== def.idleMin, c.coldStartS !== def.coldStartS));

  const custom = group("flags", "Custom flags", false, [
    fld("customFlags", "Flags", flags, "Passed to vllm serve as typed. A flag with a field above is refused here, so there is one way to set it."),
  ], (c) => c.customFlags.length);

  const formBody = h("div", { class: "vd-cform__body" }, placement, memory, engine, serving, spec, lora, envGroup, life, custom, lens);
  const el = h(
    "div",
    { class: "vd-cform" },
    modeTabs?.el ?? null,
    formBody,
    h("div", { class: "vd-cmdbox" }, h("p", { class: "vd-eyebrow" }, "Command the manager will run"), preview),
  );

  // ---------- keeping it current ----------
  const upd = (): void => {
    const s = ctx.store.get();
    const m = current();
    const d = read();
    const c = d.cfg;
    if (m) {
      replace(info,
        h("dt", {}, "Architecture"), h("dd", {}, m.arch),
        h("dt", {}, "Parameters"), h("dd", {}, `${m.params} · stored ${m.precision}`),
        h("dt", {}, "Weights"), h("dd", {}, `${m.weightsGiB.toFixed(1)} GiB`),
        h("dt", {}, "Max context"), h("dd", {}, int(m.maxCtx)),
        h("dt", {}, "Runner"), h("dd", {}, m.kind === "embed" ? "pooling: /v1/embeddings only" : "generate: chat and completions"),
      );
    }
    const nCards = c.tp * c.pp;
    setText(cardsHint, nCards > 1 ? `${nCards} cards: GPU ${d.gpu}–${d.gpu + nCards - 1}. Tensor parallel splits every layer across cards; pipeline parallel splits the stack of layers between them.` : "One card. Tensor and pipeline parallel multiply: 2 × 2 is four cards.");
    const floor = (cf: EngineConfig): number => (m ? (edit ? floorAt(edit, cf, Number.isFinite(d.maxLen) ? d.maxLen : edit.maxLen) : estimateFloor(m, Number.isFinite(d.maxLen) ? d.maxLen : 4096, cf)) : 0);
    if (m) {
      for (const k of ["auto", "fp8"] as const) {
        const cf = { ...c, kvDtype: k, memUtil: null };
        setText(kvRows[k], ` · ${Math.round(floor(cf) * 100)}% of each card · up to ${int(longestContext(m, cf))} tokens`);
      }
      setText(ctxLine, `Longest context under the ${CEILING} ceiling, ${c.kvDtype} KV: ${[1, 2, 4].map((k) => `${k} card${k > 1 ? "s" : ""} ${int(longestContext(m, { ...c, tp: k, pp: 1 }))}`).join(" · ")}`);
    }
    const est = c.memUtil ?? floor(c);
    const gpus = Array.from({ length: nCards }, (_, i) => d.gpu + i).filter((g) => g < s.gpus.length);
    const where = nCards > 1 ? `GPU ${d.gpu}–${d.gpu + nCards - 1}` : `GPU ${d.gpu}`;
    if (edit) {
      const now = edit.pending ? floorAt(edit, edit.pending.cfg, edit.pending.maxLen) : floorAt(edit, edit.cfg, edit.maxLen);
      replace(fit, h("p", {}, `Floor at these settings: about ${util(est)} of each card, ${(est * CARD_GIB).toFixed(1)} GiB (now ${util(now)}). ${live ? "A running engine picks changes up on restart; a change that crowds out a booking is refused." : "Applied at the next start, which measures it."}`));
    } else if (gpus.length < nCards) replace(fit, h("p", { class: "vd-bad" }, `${where} runs past the last card.`));
    else {
      const a = admitCards(s, gpus, est);
      const now = Math.max(...gpus.map((g) => budgetOn(s, g)));
      if (a.ok && !a.evict.length) replace(fit, h("p", { class: "vd-good" }, `Fits ${where} now: ${util(now)} + ${util(est)} = ${util(now + est)} of ${util(CEILING)}${nCards > 1 ? " on the fullest card" : ""}.`));
      else if (a.ok) replace(fit, h("p", { class: "vd-warn" }, `Fits ${where} after evicting ${a.evict.join(", ")} (idle, lazy).`));
      else replace(fit, h("p", { class: "vd-bad" }, `Does not fit ${where} now: ${a.reason}. ${a.detail.replace(" Nothing was stopped.", "")} It is created stopped either way.`));
    }
    setText(preview, commandText(d, m, est));
    for (const [id, , , , changed] of groups) setText(counts.get(id) as HTMLElement, changed(c, d) ? ` · ${changed(c, d)} set` : "");
    if (shown) mark(validate(d, m, s.gpus.length, o.mode));
  };

  let typed = !!edit;
  alias.addEventListener("input", () => (typed = true));
  model.addEventListener("change", () => {
    const m = current();
    if (!m) return;
    const sug = suggestedConfig(m);
    toolParser.value = sug.toolParser;
    autoTools.checked = sug.autoTools;
    reasoning.value = sug.thinkParser;
    prefix.checked = sug.prefixCaching;
    chunked.checked = sug.chunkedPrefill;
    if (Number(maxLen.value) > m.maxCtx) maxLen.value = String(LENS.filter((x) => x <= m.maxCtx).at(-1) ?? 4096);
    if (!typed) alias.value = slug(m.repo.split("/").pop() ?? m.repo).slice(0, 40);
  });
  if (!edit) alias.value = slug(model.value.split("/").pop() ?? model.value).slice(0, 40);
  el.addEventListener("input", upd);
  el.addEventListener("change", upd);

  let shown = false;
  const mark = (p: Problems): void => {
    for (const [k, e] of errs) {
      setText(e, p[k] ?? "");
      ids.get(k)?.setAttribute("aria-invalid", String(!!p[k]));
    }
  };
  upd();

  function pasteMode(): { el: HTMLElement } {
    const text = area({ rows: "5", placeholder: "vllm serve Qwen/Qwen3-14B --max-model-len 32768 --enable-prefix-caching --kv-cache-dtype fp8" });
    const msg = h("p", { class: "vd-hint", role: "status" }, "Paste a vllm serve command: the fields below are filled from it, so you can check them before Create.");
    const go = h("button", { type: "button", class: "vd-btn", "data-k": "cf-parse" }, "Read the command");
    go.addEventListener("click", () => {
      const r = parseCommand(text.value, read());
      if (r.error) return setText(msg, r.error);
      fillFrom(r.draft);
      typed = true;
      upd();
      const extraN = r.draft.cfg.customFlags.length;
      setText(msg, `Read: ${r.draft.repo}, ${r.draft.maxLen} tokens${extraN ? `; ${extraN} word${extraN === 1 ? "" : "s"} kept as custom flags` : ""}. Check the fields below, then Create.`);
    });
    const id = `${uid}-paste`;
    text.id = id;
    return { el: h("details", { class: "vd-group vd-paste" }, h("summary", { class: "vd-group__title" }, "Paste a full command instead"), h("div", { class: "vd-group__body" }, h("label", { class: "vd-field__label", for: id }, "vllm serve command"), text, h("div", { class: "vd-paste__row" }, go, msg))) };
  }

  return {
    el,
    read,
    model: current,
    show(p) {
      shown = true;
      mark(p);
      const firstKey = Object.keys(p).find((k) => p[k]);
      const target = firstKey ? ids.get(firstKey) : undefined;
      for (const k of Object.keys(p)) {
        const det = ids.get(k)?.closest("details");
        if (det) det.open = true;
      }
      target?.focus();
    },
  };
}
