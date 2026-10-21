// Analytics: stat cards and the top lists, computed from the request ring every time it changes:
// 2,000 synthetic requests seeded at load plus whatever the visitor sends from the Playground.

import { h } from "../../../lib/dom";
import { aggregate } from "../analytics";
import { int, ms, VISITOR_IP } from "../model";
import { fill, region, type Ctx } from "../ui";

export function mountAnalytics(panel: HTMLElement, ctx: Ctx): void {
  const body = h("div", { class: "vd-an" });
  panel.append(body);
  region(body, ctx.store, (s) => s.requests, (_, s) => {
    const st = aggregate([...s.requests, ...s.background]);
    const mine = s.requests.length;
    const tile = (label: string, value: string, sub?: string, tone = ""): HTMLElement =>
      h("div", { class: `vd-tilestat ${tone}` }, h("span", { class: "vd-tilestat__label" }, label), h("span", { class: "vd-tilestat__value" }, value), h("span", { class: "vd-faint vd-tilestat__sub" }, sub ?? " "));
    const max = (n: number[]): number => Math.max(1, ...n);
    const mMax = max(st.models.map((m) => m.count));
    const cMax = max(st.clients.map((c) => c.count));
    return [
      h(
        "p",
        { class: "vd-faint" },
        `From the gateway's in-memory ring: ${int(s.background.length)} synthetic requests seeded at load`,
        mine ? `, plus the ${mine} you sent` : ". Send prompts from the Playground and these numbers move",
        ".",
      ),
      h(
        "div",
        { class: "vd-tilestats" },
        tile("Requests", int(st.requests), mine ? `${mine} from you` : undefined),
        tile("Success", `${st.successPct.toFixed(1)}%`, `${int(st.ok)}/${int(st.requests)} ok`),
        tile("Errors", int(st.errors), undefined, st.errors ? "is-bad" : ""),
        tile("Avg latency", ms(st.avgMs)),
        tile("p95 latency", ms(st.p95Ms)),
        tile("Cold starts", int(st.cold)),
      ),
      h(
        "div",
        { class: "vd-row" },
        h(
          "section",
          { class: "vd-panel", "aria-labelledby": "vd-top-models" },
          h("h3", { id: "vd-top-models", class: "vd-h" }, "Top models"),
          h("ol", { class: "vd-toplist" }, st.models.map((m) =>
            h("li", {},
              h("div", { class: "vd-toplist__row" }, h("code", {}, m.alias), h("span", { class: "vd-faint" }, ms(m.avgMs)), m.errors ? h("span", { class: "vd-bad" }, `${m.errors} err`) : h("span", {}), h("strong", {}, int(m.count))),
              h("span", { class: "vd-meter" }, fill("vd-meter__fill", m.count / mMax)),
            ))),
        ),
        h(
          "section",
          { class: "vd-panel", "aria-labelledby": "vd-top-ips" },
          h("h3", { id: "vd-top-ips", class: "vd-h" }, "Top client addresses"),
          h("ol", { class: "vd-toplist" }, st.clients.map((c) =>
            h("li", {},
              h("div", { class: "vd-toplist__row" }, h("code", {}, c.ip), h("span", { class: "vd-faint" }, c.ip === VISITOR_IP ? "you" : ""), h("span", {}), h("strong", {}, int(c.count))),
              h("span", { class: "vd-meter vd-meter--alt" }, fill("vd-meter__fill", c.count / cMax)),
            ))),
        ),
      ),
      h("p", { class: "vd-endpoints" }, h("span", { class: "vd-faint" }, "Endpoints: "), st.endpoints.map((e) => h("span", { class: "vd-chip" }, h("code", {}, e.path.replace("/v1/", "")), ` ${int(e.count)}`))),
    ];
  });
}
