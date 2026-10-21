// Pieces more than one tab uses: the Conflict (409) dialog and status badges.

import { h } from "../../../lib/dom";
import { iso } from "../model";
import type { Conflict, ResStatus, Status } from "../types";
import { badge, btn, openDialog, type Ctx } from "../ui";

export function showConflict(ctx: Ctx, c: Conflict): void {
  const d = openDialog(ctx.host, {
    title: "Action rejected",
    tone: "danger",
    alert: true,
    body: [
      h("p", { class: "vd-conflict__code" }, `409 Conflict · ${c.action}`),
      h("p", {}, c.message),
      h("p", {}, h("strong", {}, "Remedy: "), c.remedy),
      h("p", { class: "vd-eyebrow" }, "Colliding with"),
      h(
        "div",
        { class: "vd-conflict__item" },
        h("div", {}, badge("reservation"), " ", h("span", { class: "vd-conflict__name" }, c.item.name), " ", h("code", {}, c.item.alias)),
        h("code", { class: "vd-faint" }, `${iso(c.item.start)} → ${iso(c.item.end)}`),
      ),
    ],
    actions: [btn("Acknowledge", () => d.close(), { kind: "primary" })],
  });
}

const STATUS_TONE: Record<Status, string> = { Running: "good", Starting: "warn", Stopping: "warn", Stopped: "neutral", Error: "bad" };
export const statusBadge = (s: Status): HTMLElement => badge([h("span", { class: "vd-dot", "aria-hidden": "true" }), s], STATUS_TONE[s], { "data-status": s });

const RES_TONE: Record<ResStatus, string> = { Scheduled: "accent", Active: "good", Completed: "neutral", Unfulfillable: "bad" };
export const resBadge = (s: ResStatus): HTMLElement => badge(s, RES_TONE[s]);
