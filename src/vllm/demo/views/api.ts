// API: a static reference for the three surfaces, with examples in the demo's values. Written for
// this page; it describes how the real system is called, and is no real code.

import { h } from "../../../lib/dom";

interface Endpoint {
  method: "GET" | "POST" | "DELETE";
  path: string;
  what: string;
  req?: string;
  res: string;
}

const OPENAI: Endpoint[] = [
  {
    method: "POST",
    path: "/v1/chat/completions",
    what: "Chat, routed by the alias in model. A stopped lazy deployment is started on demand; while it loads, the stream carries SSE comment keepalives, then the engine's bytes pass through untouched. Only model is rewritten, and only for an extra alias.",
    req: `{
  "model": "chat-default",
  "stream": true,
  "messages": [{ "role": "user", "content": "Write a haiku about GPUs" }]
}`,
    res: `: keepalive
: keepalive
data: {"id":"chatcmpl-7f3a","object":"chat.completion.chunk","model":"qwen3-32b",
       "choices":[{"index":0,"delta":{"content":"Ninety-six "}}]}
…
data: [DONE]`,
  },
  {
    method: "POST",
    path: "/v1/completions",
    what: "Plain completions, same routing and cold-start behaviour as chat.",
    req: `{ "model": "model-b", "prompt": "The build is", "max_tokens": 8 }`,
    res: `{ "object": "text_completion", "model": "model-b",
  "choices": [{ "index": 0, "text": " green.", "finish_reason": "stop" }] }`,
  },
  {
    method: "POST",
    path: "/v1/embeddings",
    what: "Embedding deployments only (embed-8b here); a generate deployment answers 400.",
    req: `{ "model": "embed-8b", "input": ["sshd: session closed for user deploy"] }`,
    res: `{ "object": "list", "model": "embed-8b",
  "data": [{ "object": "embedding", "index": 0, "embedding": [0.0132, -0.0871, …] }] }`,
  },
  {
    method: "GET",
    path: "/v1/models",
    what: "Every defined deployment and extra alias, running or not.",
    res: `{ "object": "list", "data": [
  { "id": "qwen3-32b", "object": "model", "owned_by": "gpu-host-1" },
  { "id": "chat-default", "object": "model", "owned_by": "gpu-host-1" },
  { "id": "model-b", "object": "model", "owned_by": "gpu-host-1" }, … ] }`,
  },
];

const OPERATOR: Endpoint[] = [
  {
    method: "POST",
    path: "/api/deployments/{alias}/start",
    what: "Admission first: the card's measured floors against the 0.95 ceiling, one start per card. Idle lazy instances are evicted LRU-first if needed; if it would not fit even then, 503 before anything stops.",
    res: `HTTP/1.1 503 Service Unavailable
Retry-After: 30
{ "detail": "would not fit even after evicting 0",
  "gpu": 0, "need": 0.30, "held": [{ "alias": "qwen3-32b", "min_util": 0.74, "why": "pinned" }] }`,
  },
  {
    method: "POST",
    path: "/api/deployments/{alias}/stop",
    what: "Stops the container and releases the card's budget. Also /restart, which applies edited parameters.",
    res: `{ "alias": "model-b", "status": "Stopping" }`,
  },
  {
    method: "POST",
    path: "/api/deployments/{alias}/pin",
    what: "Pinned deployments are never evicted and count on their card at all times, so a pin goes through the planner and may be refused.",
    res: `HTTP/1.1 409 Conflict
{ "detail": "pin would break reservation batch-team-x",
  "remedy": "Delete or move the reservation, or pin model-c after it ends.",
  "conflict": { "kind": "reservation", "name": "batch-team-x", "deployment": "model-c",
                "start": "2026-10-22T22:00:00Z", "end": "2026-10-23T06:00:00Z" } }`,
  },
  {
    method: "POST",
    path: "/api/gpus/{index}/block",
    what: "Refuses new loads on a card (a driver update, say); what runs keeps running. DELETE on the same path allows loads again.",
    req: `{ "reason": "driver update" }`,
    res: `{ "index": 2, "blocked": true, "reason": "driver update" }`,
  },
];

const RESERVATIONS: Endpoint[] = [
  {
    method: "POST",
    path: "/api/reservations",
    what: "Books a deployment for a window. The planner checks the card over every interval of it; the answer is the booking with its status.",
    req: `{ "name": "nightly-eval", "deployment": "qwen3-32b",
  "start": "2026-10-22T08:30:00Z", "end": "2026-10-22T12:00:00Z" }`,
    res: `{ "id": "r-0193", "name": "nightly-eval", "status": "Scheduled" }`,
  },
  {
    method: "GET",
    path: "/api/reservations/{id}",
    what: "External callers poll this; there are no webhooks. An estimate disproved by a measurement turns a booking Unfulfillable, with the reason.",
    res: `{ "id": "r-0188", "name": "eval-run", "status": "Unfulfillable",
  "reason": "At Wed 14:00 GPU 3 would need 1.04 of its 0.95 ceiling: …" }`,
  },
  {
    method: "DELETE",
    path: "/api/reservations/{id}",
    what: "Cancels a booking; the planner re-checks the ones after it.",
    res: `HTTP/1.1 204 No Content`,
  },
];

const section = (title: string, lead: string, list: Endpoint[], open = false): HTMLElement =>
  h(
    "section",
    { class: "vd-panel vd-api" },
    h("h3", { class: "vd-h" }, title),
    h("p", { class: "vd-faint" }, lead),
    list.map((e, i) =>
      h(
        "details",
        { class: "vd-api__ep", open: open && i === 0 },
        h("summary", {}, h("span", { class: `vd-method vd-method--${e.method.toLowerCase()}` }, e.method), h("code", {}, e.path)),
        h("p", {}, e.what),
        e.req ? [h("p", { class: "vd-eyebrow" }, "Request"), h("pre", { class: "vd-code" }, e.req)] : null,
        h("p", { class: "vd-eyebrow" }, "Response"),
        h("pre", { class: "vd-code" }, e.res),
      ),
    ),
  );

export function mountApi(panel: HTMLElement): void {
  panel.append(
    section("OpenAI-compatible endpoint", "The gateway, the only client of the engines. Clients pick a deployment by its alias in model.", OPENAI, true),
    section("Operator actions", "The manager, which drives the containers. Gated: the UI and operators only.", OPERATOR),
    section("Reservations", "For external schedulers that need a model at a known time.", RESERVATIONS),
  );
}
