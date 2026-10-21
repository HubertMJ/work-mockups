// Downloads: fetch org/model into the model cache. Progress shows bytes, %, speed and ETA; a size
// the hub did not report is "unknown", and so are the % and ETA that would need it.

import { h, setText } from "../../../lib/dom";
import * as A from "../actions";
import { gib, MIB } from "../model";
import type { Download } from "../types";
import { badge, btn, fill, region, type Ctx } from "../ui";

const eta = (d: Download): string => {
  if (d.total === null || d.speed <= 0) return "unknown";
  const s = Math.max(0, Math.round((d.total - d.bytes) / d.speed));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const TONE: Record<Download["state"], string> = { running: "accent", completed: "good", failed: "bad", cancelled: "neutral" };

export function mountDownloads(panel: HTMLElement, ctx: Ctx): void {
  const repo = h("input", { class: "vd-input vd-input--mono", placeholder: "org/model, for example Qwen/Qwen3-8B", "aria-label": "Model to download (org/model)", autocomplete: "off", spellcheck: "false" });
  const err = h("p", { class: "vd-form-error", role: "alert" });
  const go = (): void => {
    const r = ctx.act((s) => A.download(s, repo.value));
    setText(err, r.error ?? "");
    if (!r.error) repo.value = "";
  };
  repo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  const list = h("div", { class: "vd-dl" });
  panel.append(
    h(
      "section",
      { class: "vd-panel", "aria-labelledby": "vd-dl-h" },
      h("h3", { id: "vd-dl-h", class: "vd-h" }, "Model downloads"),
      h("p", { class: "vd-faint" }, "Fetches a model into the cache the engines mount read-only. Progress is the size of the model's directory on disk, sampled once a second. A cancelled or failed download leaves its bytes for a resume."),
      h("div", { class: "vd-dl__form" }, repo, btn("Download", go, { kind: "primary", k: "dl-go" })),
      err,
      list,
    ),
  );
  region(list, ctx.store, (s) => s.downloads, (dls) =>
    dls.map((d) => {
      const known = d.total !== null;
      const pct = known && d.total ? (d.bytes / d.total) * 100 : 0;
      return h(
        "article",
        { class: `vd-dl__item vd-dl__item--${d.state}`, "data-k": `dl:${d.id}`, "aria-label": `${d.repo}, ${d.state}` },
        h(
          "div",
          { class: "vd-dl__head" },
          h("code", { class: "vd-dl__repo" }, d.repo),
          h("div", { class: "vd-dl__tools" }, badge(d.state, TONE[d.state]), d.state === "running" ? btn("Cancel", () => ctx.act((s) => A.cancelDownload(s, d.id)), { k: `dl-cancel:${d.id}` }) : null),
        ),
        known
          ? h("span", { class: "vd-meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": pct.toFixed(1), "aria-label": `${d.repo} progress` }, fill(`vd-meter__fill${d.state === "failed" ? " is-bad" : ""}`, pct / 100))
          : h("p", { class: "vd-faint vd-dl__note" }, "Total size unknown: the hub did not report it. No percentage and no ETA are shown rather than invented ones."),
        h(
          "p",
          { class: "vd-dl__stats" },
          h("span", {}, h("strong", {}, gib(d.bytes)), known ? ` / ${gib(d.total ?? 0)} (${pct.toFixed(1)}%)` : ""),
          d.state === "running" ? [h("span", {}, "Speed ", h("strong", {}, `${(d.speed / MIB).toFixed(1)} MiB/s`)), h("span", {}, "ETA ", h("strong", {}, eta(d)))] : null,
        ),
        d.error ? h("div", { class: "vd-alert vd-alert--bad" }, h("p", {}, d.error)) : null,
      );
    }),
  );
}
