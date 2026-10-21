// The /work/ pages' architecture drawings, in the same visual language as the landing page's "The way in":
// boxes are g[data-node] with a rect, a label, a small line and a data-tip sentence; edges are
// orthogonal M/L paths (class em-edge) with their labels; zones are dashed frames. scripts/build.mjs
// writes them into the pages at build time, a wide and a narrow drawing each where the page has room
// for both, so ASCII mode (src/ascii) can redraw them in characters and show each box's popup.

import { el, esc, GAP, pathD, text, type Box, type Pt } from "./markup";

type Role = "path" | "site" | "project" | "lab";

export interface WNode {
  id: string;
  label: string;
  sub: string;
  role: Role;
  /** One sentence for ASCII mode's popup beside the box. */
  tip: string;
}

export interface WEdge {
  pts: Pt[];
  label: string;
  at: Pt;
  anchor: "start" | "middle" | "end";
  dashed?: boolean;
  /** Arrows at both ends: a conversation, or files read and written. */
  both?: boolean;
}

export interface WLayout {
  view: "wide" | "narrow";
  width: number;
  height: number;
  boxes: Record<string, Box>;
  zones: { box: Box; title: string; sub: string }[];
  edges: WEdge[];
}

export interface WDiagram {
  id: "vllm" | "bridge" | "flota";
  title: string;
  desc: string;
  nodes: WNode[];
  layouts: WLayout[];
}

const bx = (x: number, y: number, w: number, h = 52): Box => ({ x, y, w, h });
const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;

type Opt = { at?: Pt; anchor?: WEdge["anchor"]; dashed?: boolean; both?: boolean };
/** Straight down from a's bottom to b's top at x; its label to the right of the line, halfway. */
function down(a: Box, b: Box, label: string, x = cx(a), o: Opt = {}): WEdge {
  const y0 = a.y + a.h + (o.both ? GAP : 0);
  const y1 = b.y - GAP;
  return { pts: [[x, y0], [x, y1]], label, at: o.at ?? [x + 8, (y0 + y1) / 2 + 4], anchor: o.anchor ?? "start", dashed: o.dashed, both: o.both };
}
/** Straight up from a's top to b's bottom at x. */
function up(a: Box, b: Box, label: string, x = cx(a), o: Opt = {}): WEdge {
  const y0 = a.y - (o.both ? GAP : 0);
  const y1 = b.y + b.h + GAP;
  return { pts: [[x, y0], [x, y1]], label, at: o.at ?? [x + 8, (y0 + y1) / 2 + 4], anchor: o.anchor ?? "start", dashed: o.dashed, both: o.both };
}
/** Across, left to right or right to left, at y; its label above the line, centred. */
function across(a: Box, b: Box, label: string, y = cy(a), o: Opt = {}): WEdge {
  const rightward = b.x > a.x;
  const x0 = (rightward ? a.x + a.w : a.x) + (o.both ? (rightward ? GAP : -GAP) : 0);
  const x1 = rightward ? b.x - GAP : b.x + b.w + GAP;
  return { pts: [[x0, y], [x1, y]], label, at: o.at ?? [(x0 + x1) / 2, y - 8], anchor: o.anchor ?? "middle", dashed: o.dashed, both: o.both };
}
const path = (pts: Pt[], label: string, at: Pt, anchor: WEdge["anchor"], o: Opt = {}): WEdge => ({ pts, label, at, anchor, dashed: o.dashed, both: o.both });

// ---------- the vLLM deployment manager (in the mock-up's About drawer: the narrow drawing only) ----------

function vllmNarrow(): WLayout {
  const L = 20;
  const R = 232;
  const w = 160;
  const B: Record<string, Box> = {
    clients: bx(L, 40, w), ui: bx(R, 40, w),
    gateway: bx(L, 176, w), manager: bx(R, 176, w),
    engines: bx(L, 290, w), docker: bx(R, 290, w),
    planner: bx(R, 404, w),
  };
  const trunk = 406;
  return {
    view: "narrow",
    width: 420,
    height: 480,
    boxes: B,
    zones: [
      { box: bx(8, 8, 406, 100), title: "CALLERS", sub: "" },
      { box: bx(8, 136, 406, 336), title: "GPU-HOST-1", sub: "" },
    ],
    edges: [
      down(B.clients, B.gateway, "/v1/*", 140, { at: [148, 126] }),
      down(B.ui, B.manager, "actions", undefined, { at: [cx(B.ui) + 8, 126] }),
      across(B.gateway, B.manager, "ensure"),
      down(B.gateway, B.engines, "stream"),
      down(B.manager, B.docker, "start · stop"),
      across(B.docker, B.engines, "runs"),
      path([[R + w, cy(B.manager) + 12], [trunk, cy(B.manager) + 12], [trunk, cy(B.planner)], [R + w + GAP, cy(B.planner)]], "checks", [trunk - 8, 377], "end"),
    ],
  };
}

const VLLM: WDiagram = {
  id: "vllm",
  title: "How the deployment manager is put together",
  desc:
    "Clients call the gateway's OpenAI-compatible endpoint; the gateway asks the manager to make sure the named model runs, " +
    "keeps the stream alive while it starts, then streams from the vLLM engines on GPUs 0 to 3. The operator's UI talks to the " +
    "manager, which admits starts against each card's memory budget, checks every promise with the reservation planner, and " +
    "starts and stops the engines' containers through Docker, whose container labels are the state it rebuilds from.",
  nodes: [
    { id: "clients", label: "Clients", sub: "OpenAI SDKs, curl", role: "path", tip: "Anything that speaks the OpenAI API: it names a model in model and nothing else changes." },
    { id: "ui", label: "Operator UI", sub: "browser", role: "path", tip: "Where an operator registers, starts, pins, edits and books deployments." },
    { id: "gateway", label: "Gateway", sub: "OpenAI-compatible", role: "path", tip: "Routes by the model's alias, holds a cold start with keepalives, then passes the engine's stream through." },
    { id: "manager", label: "Manager", sub: "VRAM admission", role: "site", tip: "Admits a start only if the card's measured budget allows it, evicting idle on-demand models first." },
    { id: "engines", label: "vLLM engines", sub: "GPU 0 · 1 · 2 · 3", role: "path", tip: "One vLLM container per deployment, each pinned to its card, ready when its log says so." },
    { id: "docker", label: "Docker", sub: "state from labels", role: "project", tip: "The source of truth: after a restart the manager rebuilds its state from the containers' labels." },
    { id: "planner", label: "Planner", sub: "bookings · pins", role: "lab", tip: "One interval check for bookings, pins, edits and deletes; a refusal names the booking in the way." },
  ],
  layouts: [vllmNarrow()],
};

// ---------- the git forge ⇄ AI agent bridge ----------

function bridgeWide(): WLayout {
  const xs = [62, 344, 626, 908];
  const w = 210;
  const r1 = 56;
  const r2 = 196;
  const r3 = 336;
  const B: Record<string, Box> = {
    mention: bx(xs[0], r1, w), webhook: bx(xs[1], r1, w), who: bx(xs[2], r1, w), mode: bx(xs[3], r1, w),
    pr: bx(xs[0], r2, w), passes: bx(xs[1], r2, w), run: bx(xs[2], r2, w), queue: bx(xs[3], r2, w),
    checkpoints: bx(470, r3, 200), gate: bx(716, r3, 200), portal: bx(960, r3, 200),
  };
  return {
    view: "wide",
    width: 1190,
    height: 414,
    boxes: B,
    zones: [
      { box: bx(46, 20, 242, 244), title: "FORGE", sub: "" },
      { box: bx(328, 20, 848, 384), title: "BRIDGE HOST", sub: "one host, unattended" },
    ],
    edges: [
      across(B.mention, B.webhook, "event"),
      across(B.webhook, B.who, "verified"),
      across(B.who, B.mode, "allowed"),
      down(B.mode, B.queue, "job"),
      across(B.queue, B.run, "worker"),
      across(B.run, B.passes, "diff"),
      across(B.passes, B.pr, "reply"),
      down(B.run, B.checkpoints, "snapshot", 650),
      up(B.gate, B.run, "limits · pools", 780),
      down(B.queue, B.portal, "status", 1000),
    ],
  };
}

function bridgeNarrow(): WLayout {
  const x = 120;
  const w = 220;
  const h = 48;
  const main = ["mention", "webhook", "who", "mode", "queue", "run", "passes", "pr"];
  const B: Record<string, Box> = {};
  main.forEach((id, i) => (B[id] = bx(x, 20 + i * 82, w, h)));
  B.gate = bx(x, 678, w, h);
  B.checkpoints = bx(x, 748, w, h);
  B.portal = bx(x, 818, w, h);
  const labels = ["event", "verified", "allowed", "job", "worker", "diff", "reply"];
  const flow = labels.map((l, i) => down(B[main[i]], B[main[i + 1]], l));
  // The side boxes hang off the queue and the run on trunks down the left, outermost for the lowest.
  const stub = (trunk: number, y: number) => [(trunk + x - GAP) / 2, y - 6] as Pt;
  return {
    view: "narrow",
    width: 360,
    height: 882,
    boxes: B,
    zones: [],
    edges: [
      ...flow,
      path([[x, cy(B.gate)], [64, cy(B.gate)], [64, cy(B.run) + 8], [x - GAP, cy(B.run) + 8]], "limits", stub(64, cy(B.gate)), "middle"),
      path([[x, cy(B.run) - 8], [44, cy(B.run) - 8], [44, cy(B.checkpoints)], [x - GAP, cy(B.checkpoints)]], "snapshot", stub(44, cy(B.checkpoints)), "middle"),
      path([[x, cy(B.queue)], [24, cy(B.queue)], [24, cy(B.portal)], [x - GAP, cy(B.portal)]], "status", stub(24, cy(B.portal)), "middle"),
    ],
  };
}

const BRIDGE: WDiagram = {
  id: "bridge",
  title: "From a mention to a pull request",
  desc:
    "A mention in an issue or a pull request reaches the bridge as a webhook, checked for its signature and deduplicated; it " +
    "goes on only if the person may ask, gets a mode, and waits in a queue served by workers behind a STOP switch. A worker " +
    "runs the agent in an isolated checkout, quality passes check the result, and it goes back to the forge as a pull request " +
    "or a comment. Alongside: a usage gate and account pools decide when and on which account a run starts, checkpoints let " +
    "a run resume, and a status portal shows the queue.",
  nodes: [
    { id: "mention", label: "Mention", sub: "issue or PR comment", role: "path", tip: "Someone mentions the agent where they already work: an issue, a pull request or a review." },
    { id: "webhook", label: "Webhook", sub: "signature · dedupe", role: "path", tip: "Only signed deliveries count, and a redelivered event is recognised and dropped." },
    { id: "who", label: "Who may ask", sub: "allow-list per repo", role: "path", tip: "A mention from someone outside the repository's list is answered politely and goes no further." },
    { id: "mode", label: "Mode", sub: "review · triage · build", role: "path", tip: "What was asked decides the mode: a review, a triage or an implementation." },
    { id: "queue", label: "Queue", sub: "workers · STOP · deferred", role: "site", tip: "Workers take jobs in order; STOP halts them, and work held by limits waits with a not-before time." },
    { id: "run", label: "Isolated run", sub: "own checkout, own home", role: "site", tip: "Each run gets its own checkout and home directory, so runs cannot see or break each other." },
    { id: "passes", label: "Quality passes", sub: "tests · review · fix", role: "site", tip: "Before anything goes back, the result is tested and reviewed, and fixed while it fails." },
    { id: "pr", label: "PR or comment", sub: "back in the thread", role: "path", tip: "The answer arrives where the question was asked: a pull request or a comment." },
    { id: "checkpoints", label: "Checkpoints", sub: "WIP branch near a limit", role: "lab", tip: "Near a limit the work is snapshotted to a branch every few minutes, so a killed run resumes." },
    { id: "gate", label: "Usage gate", sub: "limits · account pools", role: "project", tip: "A run starts only when an account in its pool has room; one workload cannot eat everyone's window." },
    { id: "portal", label: "Status portal", sub: "queue and live runs", role: "lab", tip: "A page that shows what is queued, what runs and what came back, live." },
  ],
  layouts: [bridgeWide(), bridgeNarrow()],
};

// ---------- Flota ----------

function flotaWide(): WLayout {
  const B: Record<string, Box> = {
    owner: bx(20, 140, 180),
    hook: bx(272, 50, 180, 44),
    pm: bx(272, 140, 180),
    sections: bx(510, 140, 180),
    merger: bx(750, 140, 170),
    main: bx(1000, 140, 160),
    guard: bx(300, 290, 250),
    state: bx(610, 290, 280),
  };
  return {
    view: "wide",
    width: 1180,
    height: 400,
    boxes: B,
    zones: [{ box: bx(250, 20, 686, 188), title: "TMUX", sub: "a session per window, addressed by name" }],
    edges: [
      across(B.owner, B.pm, "talks", undefined, { both: true }),
      across(B.pm, B.sections, "by name", undefined, { both: true }),
      across(B.sections, B.merger, "branch"),
      across(B.merger, B.main, "merges"),
      down(B.hook, B.pm, "delegate only", 362),
      up(B.guard, B.pm, "", 400),
      up(B.guard, B.sections, "PAUSE · HARD · OK", 540, { at: [470, 253], anchor: "middle" }),
      up(B.state, B.sections, "", 650, { dashed: true, both: true }),
      up(B.state, B.merger, "", 800, { dashed: true, both: true }),
      path([[700, B.state.y + B.state.h + GAP], [700, 372], [290, 372], [290, B.pm.y + B.pm.h + GAP]], "read · write", [495, 366], "middle", { dashed: true, both: true }),
    ],
  };
}

function flotaNarrow(): WLayout {
  const x = 120;
  const w = 220;
  const B: Record<string, Box> = {
    owner: bx(x, 8, w),
    hook: bx(12, 136, 98),
    pm: bx(x, 136, w),
    sections: bx(x, 222, w),
    merger: bx(x, 308, w),
    main: bx(x, 412, w),
    state: bx(x, 500, w),
    guard: bx(x, 584, w),
  };
  const zone = bx(8, 96, 344, 280);
  const zoneBottom = zone.y + zone.h + GAP;
  return {
    view: "narrow",
    width: 360,
    height: 652,
    boxes: B,
    zones: [{ box: zone, title: "TMUX", sub: "a session per window" }],
    edges: [
      down(B.owner, B.pm, "talks", undefined, { both: true, at: [cx(B.owner) + 8, 86] }),
      down(B.pm, B.sections, "by name", undefined, { both: true }),
      down(B.sections, B.merger, "branch"),
      down(B.merger, B.main, "merges", undefined, { at: [cx(B.merger) + 8, 396] }),
      across(B.hook, B.pm, ""),
      path([[x, cy(B.state)], [44, cy(B.state)], [44, zoneBottom]], "read/write", [(44 + x) / 2, cy(B.state) - 6], "middle", { dashed: true, both: true }),
      path([[x, cy(B.guard)], [20, cy(B.guard)], [20, zoneBottom]], "PAUSE·HARD·OK", [(20 + x) / 2 + 2, cy(B.guard) - 6], "middle"),
    ],
  };
}

const FLOTA: WDiagram = {
  id: "flota",
  title: "How a fleet is wired",
  desc:
    "The owner talks to the project manager session, which hands orders to section sessions by name and reads their reports; " +
    "each session lives in its own tmux window. A guard hook on the manager refuses any edit, so it can only delegate. Sections " +
    "hand their branches to a single merger, which merges to main. A limit guard with no model types PAUSE, HARD or OK into " +
    "every window, and every session reads and writes the shared state files: orders, decisions and each section's state.",
  nodes: [
    { id: "owner", label: "Owner", sub: "you, in one window", role: "path", tip: "You talk to the project manager only; it tells you what the fleet did." },
    { id: "hook", label: "PM hook", sub: "no edits", role: "project", tip: "A tool hook on the manager refuses edits and writes, and says: give it to a section." },
    { id: "pm", label: "Project manager", sub: "plans, hands out work", role: "site", tip: "The manager session splits the work and sends it to sections by name; it cannot do the work itself." },
    { id: "sections", label: "Sections", sub: "own tmux session each", role: "site", tip: "Each section is a session in its own window with its own scope, reporting back when done." },
    { id: "merger", label: "Merger", sub: "the only one to merge", role: "site", tip: "One session merges, so branches land on main one at a time and in order." },
    { id: "main", label: "main", sub: "the project's branch", role: "path", tip: "Where the fleet's work ends up." },
    { id: "guard", label: "Limit guard", sub: "no model · reads usage", role: "project", tip: "Watches the account's usage and types PAUSE, HARD or OK into every window, spending no tokens." },
    { id: "state", label: "State files", sub: "orders · decisions · state", role: "lab", tip: "Plain files every session reads and writes: open orders, decisions taken, each section's state." },
  ],
  layouts: [flotaWide(), flotaNarrow()],
};

export const WORK_DIAGRAMS: WDiagram[] = [VLLM, BRIDGE, FLOTA];

// ---------- markup ----------

function nodeMarkup(n: WNode, b: Box): string {
  const label = text("em-label", cx(b), cy(b) - 6, n.label) + text("em-sub", cx(b), cy(b) + 14, n.sub);
  return el("g", { class: `em-node em-${n.role}`, "data-node": n.id, "data-tip": n.tip }, el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 7 }) + label);
}

function edgeMarkup(e: WEdge, marker: string): string {
  return (
    el("path", { class: e.dashed ? "em-edge em-edge--tunnel" : "em-edge", d: pathD(e.pts), "marker-end": `url(#${marker})`, "marker-start": e.both ? `url(#${marker})` : undefined }) +
    (e.label ? text("em-edge-label", e.at[0], e.at[1], e.label, { "text-anchor": e.anchor }) : "")
  );
}

/** One drawing as an inline <svg>. `only`: the page shows this drawing at every width (the vLLM drawer). */
export function workSvg(d: WDiagram, view: WLayout["view"], only = false): string {
  const lay = d.layouts.find((l) => l.view === view);
  if (!lay) throw new Error(`${d.id} has no ${view} drawing`);
  const p = `wd-${d.id}-${view}`;
  const marker = `${p}-arrow`;
  const zones = lay.zones.map((z) =>
    el("g", { class: "em-zone" }, el("rect", { x: z.box.x, y: z.box.y, width: z.box.w, height: z.box.h, rx: 9 }), el("text", { class: "em-zone-title", x: z.box.x + 12, y: z.box.y + 20 }, esc(z.title), el("tspan", { class: "em-zone-sub" }, esc(z.sub ? ` ${z.sub}` : "")))),
  );
  return el(
    "svg",
    { class: `wd-map wd-map--${view}${only ? " wd-map--only" : ""}`, viewBox: `0 0 ${lay.width} ${lay.height}`, role: "group", "aria-labelledby": `${p}-title ${p}-desc`, "data-diagram": d.id },
    el("title", { id: `${p}-title` }, esc(d.title)),
    el("desc", { id: `${p}-desc` }, esc(d.desc)),
    el("defs", {}, el("marker", { id: marker, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, el("path", { class: "em-arrowhead", d: "M0,0 L10,5 L0,10 z" }))),
    ...zones,
    ...lay.edges.map((e) => edgeMarkup(e, marker)),
    ...d.nodes.map((n) => nodeMarkup(n, lay.boxes[n.id])),
  );
}

/** The build's {{diagram.<id>.<view>}} substitutions. */
export function workSvgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of WORK_DIAGRAMS) for (const l of d.layouts) out[`diagram.${d.id}.${l.view}`] = workSvg(d, l.view, d.id === "vllm");
  return out;
}
