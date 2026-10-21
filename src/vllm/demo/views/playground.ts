// The Playground: a prompt through the gateway to a deployment chosen by its alias. A stopped one is
// cold-started first, the stream kept alive with ": keepalive" comments; then a canned answer
// streams token by token inside a fixed box. Every request lands in Recent Requests.

import { h, replace, setText } from "../../../lib/dom";
import * as A from "../actions";
import { PRESETS } from "../answers";
import { clock, dep, ms, VISITOR_IP } from "../model";
import type { Req, State, Stream } from "../types";
import { btn, field, icon, region, type Ctx } from "../ui";

const label = (s: State, alias: string): string => {
  const d = dep(s, alias);
  if (!d) return alias;
  const st = d.status === "Running" ? "running" : d.status === "Starting" ? "starting" : d.status === "Stopping" ? "stopping" : "stopped, cold start";
  return `${alias} (${st}${d.kind === "embed" ? ", embeddings" : ""})`;
};

export function mountPlayground(panel: HTMLElement, ctx: Ctx): void {
  const target = h("select", { class: "vd-input", id: "vd-pg-model" });
  const prompt = h("textarea", { class: "vd-input vd-textarea", rows: "4", id: "vd-pg-prompt", spellcheck: "false" });
  prompt.value = PRESETS[0].prompt;
  const err = h("p", { class: "vd-form-error", role: "alert" });
  const sendBtn = btn("Send", () => submit(), { kind: "primary", icon: "send", k: "pg-send" });
  const presets = h(
    "div",
    { class: "vd-chips", role: "group", "aria-label": "Example prompts" },
    PRESETS.map((p) => {
      const b = h("button", { type: "button", class: "vd-chip vd-chip--btn" }, p.prompt.length > 34 ? `${p.prompt.slice(0, 32)}…` : p.prompt);
      b.addEventListener("click", () => {
        prompt.value = p.prompt;
        prompt.focus({ preventScroll: true });
      });
      return b;
    }),
  );
  const out = h("div", { class: "vd-stream", "data-scroll": "stream", "data-follow": "", tabindex: "0", role: "log", "aria-label": "Response stream" });
  const meta = h("p", { class: "vd-stream__meta", "aria-live": "polite" });
  const recent = h("div", { class: "vd-recent", "data-scroll": "recent", tabindex: "0", role: "region", "aria-label": "Recent requests" });

  panel.append(
    h(
      "div",
      { class: "vd-pg" },
      h(
        "section",
        { class: "vd-panel vd-pg__form", "aria-labelledby": "vd-pg-h" },
        h("h3", { id: "vd-pg-h", class: "vd-h" }, "Quick test playground"),
        h("p", { class: "vd-faint" }, "Goes through the gateway as ", h("code", {}, "POST /v1/chat/completions"), " with ", h("code", {}, "stream: true"), ". The answers are canned: nothing leaves your browser."),
        field("Deployment (the model field)", target),
        presets,
        field("Prompt", prompt),
        err,
        h("div", { class: "vd-pg__send" }, sendBtn, h("span", { class: "vd-faint" }, "Ctrl+Enter sends")),
      ),
      h("section", { class: "vd-panel vd-pg__out", "aria-labelledby": "vd-pg-out-h" }, h("h3", { id: "vd-pg-out-h", class: "vd-h" }, "Response"), out, meta),
    ),
    h("section", { class: "vd-panel", "aria-labelledby": "vd-recent-h" }, h("h3", { id: "vd-recent-h", class: "vd-h" }, "Recent requests"), recent),
  );

  // The select keeps its element (and focus) and only its options' words change.
  let shown = "";
  const options = (s: State): void => {
    const key = s.deps.map((d) => `${d.alias}:${d.status}`).join("|");
    if (key === shown) return;
    shown = key;
    const keep = target.value || "qwen3-32b";
    const opts: [string, string][] = s.deps.map((d) => [d.alias, label(s, d.alias)]);
    for (const d of s.deps) for (const x of d.extraAliases) opts.push([x, `${x} → ${d.alias} (extra alias)`]);
    replace(target, opts.map(([v, t]) => h("option", { value: v }, t)));
    target.value = opts.some(([v]) => v === keep) ? keep : opts[0]?.[0] ?? "";
  };
  options(ctx.store.get());
  ctx.store.subscribe(options);

  const submit = (): void => {
    const r = ctx.act((s) => A.send(s, target.value, prompt.value, ctx.calm()));
    setText(err, r.error ?? "");
  };
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  region(out, ctx.store, (s) => [s.stream, s.stream?.phase === "cold" ? Math.floor(s.now / 1000) : 0], (_, s) => streamView(s.stream, s.now));
  region(meta, ctx.store, (s) => s.stream, (st) => metaLine(st));
  region(recent, ctx.store, (s) => s.requests, (_, s) => requests(s));
  ctx.store.subscribe((s) => {
    sendBtn.disabled = !!s.stream && (s.stream.phase === "cold" || s.stream.phase === "streaming");
  });
}

function streamView(st: Stream | null, now: number): HTMLElement[] {
  if (!st) return [h("p", { class: "vd-empty" }, "Pick a deployment and send a prompt. Try a stopped one, like model-b, to watch the gateway cold-start it.")];
  const lines: HTMLElement[] = [h("div", { class: "vd-stream__req" }, `POST ${st.path}  model=${st.alias}${st.path.endsWith("completions") ? "  stream=true" : ""}`)];
  if (st.cold) {
    const until = st.streamStart ?? st.endedAt ?? now;
    const n = Math.max(1, Math.floor((until - st.t0) / 1000) + 1);
    for (let i = 0; i < n; i++) lines.push(h("div", { class: "vd-stream__ka" }, ": keepalive"));
    if (st.streamStart) lines.push(h("div", { class: "vd-stream__note" }, `${st.alias} is up after ${ms(st.streamStart - st.t0)}; the engine's bytes pass through untouched`));
  }
  if (st.phase === "failed") lines.push(h("div", { class: "vd-stream__err" }, `HTTP 503 ${st.error ?? ""}`));
  if (st.phase === "streaming" || st.phase === "done") {
    const text = st.tokens.slice(0, st.shown).join("");
    lines.push(h("div", { class: "vd-stream__text" }, text, st.phase === "streaming" ? h("span", { class: "vd-caret", "aria-hidden": "true" }) : null));
    if (st.phase === "done" && st.path.endsWith("completions")) lines.push(h("div", { class: "vd-stream__ka" }, "data: [DONE]"));
  }
  return lines;
}

function metaLine(st: Stream | null): string {
  if (!st) return "";
  if (st.phase === "cold") return `Cold start: waiting for ${st.alias}…`;
  if (st.phase === "streaming") return `Streaming from ${st.alias}…`;
  return `${st.status ?? ""} · ${ms((st.endedAt ?? st.t0) - st.t0)}${st.cold ? " · cold start" : ""}`;
}

function requests(s: State): HTMLElement[] {
  const rows: Req[] = [...s.requests, ...s.background.slice(0, 40)].slice(0, 40);
  const head = h("div", { class: "vd-req vd-req--head", "aria-hidden": "true" }, ["Time", "Alias", "Path", "Status", "Duration", "Prompt", "Output"].map((t) => h("span", {}, t)));
  return [
    head,
    ...rows.map((r) =>
      h(
        "div",
        { class: `vd-req${r.ip === VISITOR_IP ? " vd-req--you" : ""}` },
        h("span", { class: "vd-faint" }, clock(r.t)),
        h("code", {}, r.alias),
        h("code", { class: "vd-faint" }, r.path),
        h("span", { class: r.status < 400 ? "vd-good" : "vd-bad" }, String(r.status)),
        h("span", {}, ms(r.ms), r.cold ? h("span", { class: "vd-badge vd-badge--warn vd-badge--tiny", title: "cold start" }, icon("play"), "cold") : null),
        h("span", { class: "vd-req__text", title: r.prompt }, r.prompt),
        h("span", { class: "vd-req__text vd-faint", title: r.output }, r.output),
      ),
    ),
  ];
}
