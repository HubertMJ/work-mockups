// The Deployments tab: what runs where, the VRAM budget per card, recent events and every deployment
// as a card with its actions. Each part redraws only from its own slice of the State.

import { h, replace, setText } from "../../../lib/dom";
import * as A from "../actions";
import { admitOnCard } from "../admission";
import { budget, CARD_GIB, CEILING, concurrency, int, isResident, isStale, planBudget, slug, stamp, clock, util, utilAt } from "../model";
import { budgetOn, usedGiB } from "../sim";
import type { Deployment, Level, State } from "../types";
import { badge, btn, field, icon, openDialog, region, select, type Ctx } from "../ui";
import { showConflict, statusBadge } from "./common";

export function mountDeployments(panel: HTMLElement, ctx: Ctx): void {
  const active = h("div", { class: "vd-active__list" });
  const events = h("ol", { class: "vd-events__list", "data-scroll": "events" });
  const vram = h("div", { class: "vd-vram" });
  const grid = h("div", { class: "vd-grid" });
  const toolbar = h("div", { class: "vd-grid__bar" });
  panel.append(
    h(
      "div",
      { class: "vd-row" },
      h("section", { class: "vd-panel vd-active", "aria-labelledby": "vd-active-h" }, h("h3", { id: "vd-active-h", class: "vd-h" }, "Active deployments"), active),
      h("section", { class: "vd-panel vd-events", "aria-labelledby": "vd-events-h" }, h("h3", { id: "vd-events-h", class: "vd-h" }, "Events"), events),
    ),
    h("section", { class: "vd-panel", "aria-labelledby": "vd-vram-h" }, h("h3", { id: "vd-vram-h", class: "vd-h" }, icon("chip"), "GPU VRAM"), vram),
    h("section", { class: "vd-deps", "aria-labelledby": "vd-deps-h" }, toolbar, grid),
  );

  region(active, ctx.store, (s) => s.deps, (deps) => {
    const live = deps.filter(isResident);
    if (!live.length) return h("p", { class: "vd-empty" }, "Nothing runs. Start a deployment below, or send it a prompt in the Playground.");
    return live.map((d) =>
      h("div", { class: "vd-active__row" }, h("code", { class: "vd-alias" }, d.alias), statusBadge(d.status), h("span", { class: "vd-kv" }, h("span", {}, "GPU"), String(d.gpu)), h("span", { class: "vd-kv" }, h("span", {}, "Min util"), minUtil(d))),
    );
  });

  region(events, ctx.store, (s) => s.events, (list) =>
    list.map((e) => h("li", { class: `vd-event vd-event--${e.level}` }, h("time", { class: "vd-faint" }, clock(e.t)), h("span", {}, e.text))),
  );

  for (const g of ctx.store.get().gpus) vram.append(gpuTile(ctx, g.index));

  region(toolbar, ctx.store, (s) => s.deps, (deps) => {
    const errors = deps.filter((d) => d.error).length;
    return [
      h("h3", { id: "vd-deps-h", class: "vd-h" }, "Deployments ", h("span", { class: "vd-faint" }, `(${deps.length})`)),
      h(
        "div",
        { class: "vd-grid__tools" },
        btn(`Clear errors (${errors})`, () => ctx.act(A.clearErrors), { k: "clear-errors", disabled: !errors }),
        btn("New deployment", () => newDeployment(ctx), { kind: "primary", icon: "plus", k: "new-deployment" }),
      ),
    ];
  });

  region(grid, ctx.store, (s) => [s.deps, s.reservations], (_, s) => s.deps.map((d) => card(ctx, d)));
}

// ---------- the VRAM panel: four tiles built once and patched, so their bars can move ----------

function gpuTile(ctx: Ctx, i: number): HTMLElement {
  const used = h("span", { class: "vd-badge vd-badge--mono" });
  const blocked = badge("blocked", "bad");
  const bar = h("div", { class: "vd-bar", role: "img" });
  const usedFill = h("span", { class: "vd-bar__used" });
  const reserved = h("span", { class: "vd-bar__reserved" });
  const ceiling = h("span", { class: "vd-bar__ceiling" });
  ceiling.style.setProperty("--w", `${CEILING * 100}%`);
  bar.append(usedFill, reserved, ceiling);
  const meta = h("p", { class: "vd-tile__meta" });
  const lower = h("div", { class: "vd-tile__lower" });
  const tile = h(
    "article",
    { class: "vd-tile", "data-k": `gpu:${i}`, tabindex: "-1", "aria-label": `GPU ${i}` },
    h("div", { class: "vd-tile__head" }, h("div", {}, h("h4", { class: "vd-tile__name" }, `GPU ${i}`), h("p", { class: "vd-faint" }, "96 GB card · gpu-host-1")), h("div", { class: "vd-tile__badges" }, blocked, used)),
    bar,
    meta,
    lower,
  );
  const patch = (s: State): void => {
    const g = s.gpus[i];
    const gib = usedGiB(s, i);
    const promised = budgetOn(s, i);
    setText(used, `${gib.toFixed(1)} GiB / ${CARD_GIB.toFixed(1)} GiB`);
    blocked.hidden = !g.blocked;
    usedFill.style.setProperty("--w", `${(gib / CARD_GIB) * 100}%`);
    reserved.style.setProperty("--w", `${Math.max(0, promised - gib / CARD_GIB) * 100}%`);
    reserved.style.setProperty("--x", `${(gib / CARD_GIB) * 100}%`);
    bar.setAttribute("aria-label", `GPU ${i}: ${gib.toFixed(1)} of 96 GiB in use, budget ${util(promised)} of the ${util(CEILING)} ceiling`);
    setText(meta, `Ceiling 95% · budget ${util(promised)} of ${util(CEILING)}${promised > gib / CARD_GIB + 0.005 ? " · hatched: promised to a start" : ""}`);
  };
  patch(ctx.store.get());
  ctx.store.subscribe(patch);
  region(lower, ctx.store, (s) => `${s.gpus[i].blocked}|${s.deps.filter((d) => d.gpu === i && isResident(d)).map((d) => d.alias).join(",")}`, (_, s) => {
    const g = s.gpus[i];
    const residents = s.deps.filter((d) => d.gpu === i && isResident(d));
    return [
      g.blocked
        ? h("div", { class: "vd-alert vd-alert--bad" }, h("p", {}, `New loads blocked: ${g.blocked}`), btn("Allow loads again", () => ctx.act((x) => A.unblock(x, i)), { k: `unblock:${i}` }))
        : null,
      h("div", { class: "vd-chips" }, residents.length ? residents.map((d) => h("code", { class: "vd-chip" }, d.alias)) : h("span", { class: "vd-faint" }, "No residents")),
      g.blocked ? null : h("div", { class: "vd-tile__actions" }, btn("Block new loads…", () => blockDialog(ctx, i), { k: `block:${i}` })),
    ];
  });
  return tile;
}

function blockDialog(ctx: Ctx, i: number): void {
  const reason = h("input", { class: "vd-input", value: "maintenance", maxlength: "60" });
  const d = openDialog(ctx.host, {
    title: `Block new loads on GPU ${i}`,
    body: [h("p", {}, "Starts on this card are refused until loads are allowed again. What runs there keeps running."), field("Reason", reason)],
    actions: [
      btn("Cancel", () => d.close()),
      btn("Block", () => {
        ctx.act((s) => A.block(s, i, reason.value));
        d.close();
      }, { kind: "danger" }),
    ],
  });
}

// ---------- a deployment's card ----------

function minUtil(d: Deployment): HTMLElement {
  if (isStale(d)) return h("span", { class: "vd-stale", title: `Stale: max length changed ${d.profileLen} → ${d.maxLen}` }, h("s", {}, util(d.minUtil)), h("span", { class: "vd-bad" }, " !"));
  return h("span", {}, util(d.minUtil), d.source === "estimate" ? h("span", { class: "vd-warn", title: "estimate" }, " *") : null);
}

function stat(label: string, value: Node | string, title?: string): HTMLElement {
  return h("div", { class: "vd-stat", title }, h("span", { class: "vd-stat__label" }, label), h("span", { class: "vd-stat__value" }, value));
}

function message(ctx: Ctx, d: Deployment): HTMLElement {
  if (d.error)
    return h("div", { class: "vd-msg vd-alert vd-alert--bad" }, h("p", {}, d.error), dismiss(ctx, d, "error"));
  if (d.refused) return h("div", { class: "vd-msg vd-alert vd-alert--warn" }, h("p", {}, d.refused), dismiss(ctx, d, "refusal"));
  const last = d.log.at(-1);
  if (d.phase && last) return h("div", { class: "vd-msg vd-msg--log" }, h("span", { class: "vd-spin", "aria-hidden": "true" }), h("code", {}, last.text));
  if (d.pending) return h("div", { class: "vd-msg vd-msg--note" }, `Restart to apply: max length ${d.maxLen} → ${d.pending.maxLen}, max seqs ${d.maxSeqs} → ${d.pending.maxSeqs}.`);
  if (isStale(d)) return h("div", { class: "vd-msg vd-msg--note" }, `Profile stale: max length changed ${d.profileLen} → ${d.maxLen}. Admitted on ${util(budget(d))} until a start measures it.`);
  if (d.source === "estimate") return h("div", { class: "vd-msg vd-msg--note" }, `Never measured: admitted on an estimate of ${util(d.minUtil)} until the engine reports its profile.`);
  if (last) return h("div", { class: "vd-msg vd-msg--log" }, h("code", {}, `${clock(last.t)} ${last.text}`));
  return h("div", { class: "vd-msg" });
}

function dismiss(ctx: Ctx, d: Deployment, what: string): HTMLElement {
  const b = h("button", { type: "button", class: "vd-icon-btn", "aria-label": `Dismiss the ${what} on ${d.alias}`, "data-k": `dismiss:${d.alias}` }, icon("x"));
  b.addEventListener("click", () => ctx.act((s) => A.dismissError(s, d.alias)));
  return b;
}

function card(ctx: Ctx, d: Deployment): HTMLElement {
  const a = d.alias;
  const run = (f: (s: State) => A.Result): void => {
    const r = ctx.act(f);
    if (r.conflict) showConflict(ctx, r.conflict);
  };
  const pin = h(
    "button",
    { type: "button", class: `vd-icon-btn vd-pin${d.pinned ? " is-on" : ""}`, "aria-pressed": String(d.pinned), "aria-label": `Pin ${a}`, title: d.pinned ? "Pinned: never evicted" : "Pin", "data-k": `pin:${a}` },
    icon(d.pinned ? "pin" : "unpin"),
  );
  pin.addEventListener("click", () => run((x) => A.togglePin(x, a)));
  const kv = concurrency(d);
  const busy = !!d.phase;
  const primary =
    d.status === "Running"
      ? [btn("Restart", () => run((x) => A.restart(x, a)), { icon: "restart", k: `restart:${a}` }), btn("Stop", () => run((x) => A.stop(x, a)), { kind: "danger", icon: "stop", k: `stop:${a}` })]
      : d.status === "Starting"
        ? [btn("Stop", () => run((x) => A.stop(x, a)), { kind: "danger", icon: "stop", k: `stop:${a}`, cls: "vd-btn--wide" })]
        : d.status === "Stopping"
          ? [btn("Stopping…", () => undefined, { disabled: true, icon: "stop", k: `stopping:${a}`, cls: "vd-btn--wide" })]
          : [btn("Start", () => run((x) => A.start(x, a)), { kind: "primary", icon: "play", k: `start:${a}`, cls: "vd-btn--wide" })];
  const del = btn("", () => confirmDelete(ctx, a), { icon: "trash", k: `delete:${a}`, label: `Delete ${a}`, disabled: busy, cls: "vd-btn--icon" });
  return h(
    "article",
    { class: `vd-card vd-card--${d.status.toLowerCase()}`, "data-k": `card:${a}`, "data-alias": a, tabindex: "-1", "aria-label": `${a}, ${d.status}` },
    h("div", { class: "vd-card__head" }, h("div", { class: "vd-card__title" }, h("h4", { class: "vd-alias vd-alias--big" }, a), h("p", { class: "vd-faint vd-card__model" }, d.model)), pin),
    h(
      "div",
      { class: "vd-chips" },
      statusBadge(d.status),
      badge(`GPU ${d.gpu}`, "outline"),
      d.pinned ? badge("Pinned") : null,
      d.lazy ? badge("lazy") : null,
      d.kind === "embed" ? badge("embeddings", "accent") : null,
      d.pending ? badge("Restart to apply", "warn") : null,
      d.extraAliases.map((x) => h("code", { class: "vd-chip" }, x)),
    ),
    message(ctx, d),
    h(
      "div",
      { class: "vd-stats" },
      stat("Min util", minUtil(d)),
      stat("Max len", String(d.maxLen)),
      stat("Max seqs", String(d.maxSeqs)),
      stat("KV cache", d.kvTokens === null ? (d.kind === "embed" ? "none" : "–") : isStale(d) ? h("s", {}, `${int(d.kvTokens)} tok`) : `${int(d.kvTokens)} tok`),
      stat("Concurrency", kv === null ? "–" : `${kv.toFixed(2)}x`),
    ),
    h("div", { class: "vd-card__actions" }, h("div", { class: "vd-card__row" }, primary), h("div", { class: "vd-card__row" },
      btn("Logs", () => logsDialog(ctx, a), { icon: "logs", k: `logs:${a}` }),
      btn("Edit", () => editDialog(ctx, a), { icon: "edit", k: `edit:${a}`, disabled: d.status === "Stopping" }),
      del,
    )),
  );
}

// ---------- dialogs ----------

const LEVELS: [string, string][] = [["all", "All levels"], ["INFO", "INFO"], ["WARNING", "WARNING"], ["ERROR", "ERROR"]];

function logsDialog(ctx: Ctx, alias: string): void {
  const level = select(LEVELS, "all", { "aria-label": "Level" });
  const box = h("div", { class: "vd-log", "data-scroll": "log", "data-follow": "", tabindex: "0", role: "log", "aria-label": `Engine log of ${alias}` });
  const body = h("div", {}, h("div", { class: "vd-log__bar" }, field("Level", level), h("p", { class: "vd-faint" }, `docker logs vllm-${slug(alias)}, as the manager reads it`)), box);
  openDialog(ctx.host, { title: `Logs · ${alias}`, wide: true, body: [body], onClose: () => view.stop() });
  const view = region(box, ctx.store, (s) => s.deps.find((d) => d.alias === alias)?.log ?? [], (log) => {
    const lines = log.filter((l) => level.value === "all" || l.level === (level.value as Level));
    if (!lines.length) return h("p", { class: "vd-empty" }, log.length ? "No lines at this level." : "No log yet: this deployment has never started.");
    return lines.map((l) => h("div", { class: `vd-log__line vd-log__line--${l.level.toLowerCase()}` }, h("span", { class: "vd-faint" }, stamp(l.t)), h("span", { class: "vd-log__lvl" }, l.level), h("span", {}, l.text)));
  });
  level.addEventListener("change", view.redraw);
}

const LENS = [4096, 8192, 16384, 32768, 65536, 131072];

function editDialog(ctx: Ctx, alias: string): void {
  const s = ctx.store.get();
  const d = s.deps.find((x) => x.alias === alias);
  if (!d) return;
  const max = s.catalog.find((m) => m.repo === d.model)?.maxCtx ?? 131072;
  const len = select(LENS.filter((n) => n <= max).map((n) => [String(n), String(n)]), String(d.pending?.maxLen ?? d.maxLen));
  const seqs = h("input", { class: "vd-input", type: "number", min: "1", max: "1024", step: "1", value: String(d.pending?.maxSeqs ?? d.maxSeqs), inputmode: "numeric" });
  const lazy = h("input", { type: "checkbox", checked: d.lazy });
  const hint = h("p", { class: "vd-hint" });
  const err = h("p", { class: "vd-form-error", role: "alert" });
  const upd = (): void => {
    const floor = utilAt(d.minUtil, d.profileLen, Number(len.value));
    const live = d.status === "Running" || d.status === "Starting";
    setText(hint, `Memory floor at this length: about ${util(floor)} of GPU ${d.gpu} (now ${util(planBudget(d))}). ${live ? "A running engine picks changes up on restart." : "Applied at the next start, which measures it."}`);
  };
  len.addEventListener("change", upd);
  upd();
  const dlg = openDialog(ctx.host, {
    title: `Edit ${alias}`,
    body: [
      h("div", { class: "vd-form" }, field("Max length (tokens)", len), field("Max seqs", seqs), h("label", { class: "vd-check" }, lazy, " Lazy: started on demand, evictable while idle")),
      hint,
      err,
    ],
    actions: [
      btn("Cancel", () => dlg.close()),
      btn("Save", () => {
        const r = ctx.act((x) => A.edit(x, alias, { maxLen: Number(len.value), maxSeqs: Number(seqs.value), lazy: lazy.checked }));
        if (r.error) return setText(err, r.error);
        dlg.close();
        if (r.conflict) showConflict(ctx, r.conflict);
      }, { kind: "primary" }),
    ],
  });
}

function confirmDelete(ctx: Ctx, alias: string): void {
  const dlg = openDialog(ctx.host, {
    title: `Delete ${alias}?`,
    alert: true,
    body: [h("p", {}, "Its container is removed if it runs, and the deployment is gone. The model stays in the cache.")],
    actions: [
      btn("Cancel", () => dlg.close(), { kind: "primary" }),
      btn("Delete", () => {
        const r = ctx.act((x) => A.remove(x, alias));
        dlg.close();
        if (r.conflict) showConflict(ctx, r.conflict);
      }, { kind: "danger" }),
    ],
  });
}

function newDeployment(ctx: Ctx): void {
  const s0 = ctx.store.get();
  const cached = s0.catalog.filter((m) => m.cached);
  const model = select(cached.map((m) => [m.repo, m.repo]), "Qwen/Qwen3-14B");
  const alias = h("input", { class: "vd-input", autocomplete: "off", spellcheck: "false", maxlength: "40" });
  const gpu = select(s0.gpus.map((g) => [String(g.index), `GPU ${g.index}${g.blocked ? " · blocked" : ""}`]), "3");
  const len = select([], "32768");
  const seqs = h("input", { class: "vd-input", type: "number", min: "1", max: "1024", value: "32", inputmode: "numeric" });
  const lazy = h("input", { type: "checkbox", checked: true });
  const info = h("dl", { class: "vd-info" });
  const fit = h("div", { class: "vd-fit", "aria-live": "polite" });
  const err = h("p", { class: "vd-form-error", role: "alert" });
  let typed = false;
  alias.addEventListener("input", () => (typed = true));
  const upd = (): void => {
    const s = ctx.store.get();
    const m = cached.find((x) => x.repo === model.value) ?? cached[0];
    const keep = Number(len.value) || 32768;
    replace(len, LENS.filter((n) => n <= m.maxCtx).map((n) => h("option", { value: String(n) }, String(n))));
    len.value = String(LENS.filter((n) => n <= m.maxCtx).reduce((a, n) => (n <= keep ? n : a), 4096));
    if (!typed) alias.value = slug(m.repo.split("/").pop() ?? m.repo).slice(0, 40);
    const est = A.estimate(m, Number(len.value));
    replace(info,
      h("dt", {}, "Architecture"), h("dd", {}, m.arch),
      h("dt", {}, "Parameters"), h("dd", {}, m.params),
      h("dt", {}, "Weights (est.)"), h("dd", {}, `${m.weightsGiB.toFixed(1)} GiB`),
      h("dt", {}, "Max context"), h("dd", {}, int(m.maxCtx)),
      h("dt", {}, "Floor (est.)"), h("dd", {}, `${util(est)} of a card · ${(est * CARD_GIB).toFixed(1)} GiB`),
    );
    const g = Number(gpu.value);
    const a = admitOnCard(s, g, est);
    const now = budgetOn(s, g);
    if (a.ok && !a.evict.length) replace(fit, h("p", { class: "vd-good" }, `Fits GPU ${g} now: ${util(now)} + ${util(est)} = ${util(now + est)} of ${util(CEILING)}.`));
    else if (a.ok) replace(fit, h("p", { class: "vd-warn" }, `Fits GPU ${g} after evicting ${a.evict.join(", ")} (idle, lazy).`));
    else replace(fit, h("p", { class: "vd-bad" }, `Does not fit GPU ${g} now: ${a.reason}. ${a.detail.replace(" Nothing was stopped.", "")} It is created stopped either way.`));
  };
  for (const c of [model, gpu, len]) c.addEventListener("change", upd);
  upd();
  const dlg = openDialog(ctx.host, {
    title: "New deployment",
    wide: true,
    body: [
      h("p", { class: "vd-faint" }, "Pick a model from the local cache. Nothing starts until you press Start or a request names it."),
      h("div", { class: "vd-form vd-form--2" }, field("Model (cached)", model), field("Alias", alias), field("GPU", gpu), field("Max length (tokens)", len), field("Max seqs", seqs), h("label", { class: "vd-check" }, lazy, " Lazy: started on demand, evictable while idle")),
      info,
      fit,
      err,
    ],
    actions: [
      btn("Cancel", () => dlg.close()),
      btn("Create", () => {
        const r = ctx.act((x) => A.create(x, { alias: alias.value, repo: model.value, gpu: Number(gpu.value), maxLen: Number(len.value), maxSeqs: Number(seqs.value), lazy: lazy.checked }));
        if (r.error) return setText(err, r.error);
        dlg.close();
      }, { kind: "primary" }),
    ],
  });
}
