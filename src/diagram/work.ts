// The /work/ pages' architecture drawings, in the same visual language as the landing page's "The way in":
// boxes are g[data-node] with a rect, a label, a small line and a data-tip sentence; edges are
// orthogonal M/L paths (class em-edge) with their labels; zones are dashed frames. scripts/build.mjs
// writes them into the pages at build time, a wide and a narrow drawing each where the page has room
// for both, so ASCII mode (src/ascii) can redraw them in characters and show each box's popup.
//
// Traffic, as on the landing page and the lab: a dot runs each drawing's routes in turn, the edges it
// passes brighten and each box it reaches shows a halo. Routes and timing are generated into a
// stylesheet (trafficCss) the build bundles, since the CSP allows no style attribute and offset-path
// needs the route; styles.css runs it only where motion is welcome. Nothing of it is a node or an edge,
// so ASCII mode, which draws its own packets on the edges, reads the drawings exactly as before.

import { panelMarkup } from "../node-panel/markup";
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
/** An arrowhead's length: a label over a line is centred on the shaft before it, never over the head. */
const HEAD = 11;
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
  // Centred on the shaft: clear of the head at the far end, and of the near one too on a two-way edge.
  const dir = rightward ? 1 : -1;
  const s0 = x0 + (o.both ? dir * HEAD : 0);
  const s1 = x1 - dir * HEAD;
  return { pts: [[x0, y], [x1, y]], label, at: o.at ?? [(s0 + s1) / 2, y - 8], anchor: o.anchor ?? "middle", dashed: o.dashed, both: o.both };
}
const path = (pts: Pt[], label: string, at: Pt, anchor: WEdge["anchor"], o: Opt = {}): WEdge => ({ pts, label, at, anchor, dashed: o.dashed, both: o.both });

// ---------- the vLLM deployment manager (in the mock-up's About drawer: the narrow drawing only) ----------

function vllmNarrow(): WLayout {
  const L = 20;
  const R = 240;
  const w = 150;
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
      down(B.clients, B.gateway, "/v1/*", 132, { at: [140, 126] }),
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
  const x = 140;
  const w = 200;
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
  // A stub's label: centred on its shaft (the trunk to the arrowhead), 8 above the line.
  const stub = (trunk: number, y: number) => [(trunk + x - GAP - HEAD) / 2, y - 8] as Pt;
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
    // Gaps sized for their labels on the shaft: "by name" between two arrowheads needs the widest.
    sections: bx(532, 140, 180),
    merger: bx(772, 140, 168),
    main: bx(1020, 140, 150),
    guard: bx(300, 290, 250),
    state: bx(610, 290, 280),
  };
  return {
    view: "wide",
    width: 1180,
    height: 400,
    boxes: B,
    zones: [{ box: bx(250, 20, 700, 188), title: "TMUX", sub: "a session per window, addressed by name" }],
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
  const x = 140;
  const w = 200;
  const B: Record<string, Box> = {
    owner: bx(x, 8, w),
    hook: bx(12, 136, 106),
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
      // The stubs' labels: centred on the shaft between the trunk and the box (whose end carries an
      // arrowhead on the two-way one), 8 above the line.
      path([[x - GAP, cy(B.state)], [44, cy(B.state)], [44, zoneBottom]], "read/write", [(44 + x - GAP - HEAD) / 2, cy(B.state) - 8], "middle", { dashed: true, both: true }),
      path([[x, cy(B.guard)], [20, cy(B.guard)], [20, zoneBottom]], "PAUSE·HARD·OK", [(20 + x) / 2, cy(B.guard) - 8], "middle"),
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

// ---------- traffic ----------

/** Each drawing's routes, as the boxes a dot passes; they run one after another, then the round repeats. */
export const ROUTES: Record<WDiagram["id"], string[][]> = {
  vllm: [
    ["clients", "gateway", "manager", "docker", "engines"],
    ["clients", "gateway", "engines"],
    ["ui", "manager", "planner"],
  ],
  bridge: [
    ["mention", "webhook", "who", "mode", "queue", "run", "passes", "pr"],
    ["gate", "run"],
    ["run", "checkpoints"],
    ["queue", "portal"],
  ],
  flota: [
    ["owner", "pm", "sections", "merger", "main"],
    ["guard", "pm"],
    ["guard", "sections"],
    ["sections", "state"],
  ],
};
/** Units a dot covers per second, the shortest run and the rest before the next route starts. */
export const PACE = { speed: 260, minTravel: 1.1, rest: 0.5 } as const;

/** The box an edge's end touches (an arrow stops GAP short of it); none for an edge into a zone. */
function touching(lay: WLayout, p: Pt): string | undefined {
  const t = GAP + 1.5;
  return Object.entries(lay.boxes).find(([, b]) => p[0] >= b.x - t && p[0] <= b.x + b.w + t && p[1] >= b.y - t && p[1] <= b.y + b.h + t)?.[0];
}

export interface Lane {
  route: string[];
  /** The edges in the dot's order, each as drawn or reversed (a two-way edge run against its arrow). */
  legs: { edge: number; pts: Pt[] }[];
  /** Start and end of the dot's run, seconds into the round. */
  start: number;
  travel: number;
  /** The dot's path: the first box's centre, along the legs, into the last box's centre. */
  path: Pt[];
  /** Where each leg starts and ends, and where each box is reached, as fractions of the path. */
  spans: [number, number][];
  reach: number[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const length = (pts: Pt[]) => pts.slice(1).reduce((n, q, i) => n + dist(pts[i], q), 0);

/** A drawing's lanes and the length of one round. A route whose edges the drawing lacks is left out. */
export function lanes(lay: WLayout, routes: string[][]): { lanes: Lane[]; period: number } {
  const ends = lay.edges.map((e) => [touching(lay, e.pts[0]), touching(lay, e.pts[e.pts.length - 1])] as const);
  const out: Lane[] = [];
  let t = 0;
  for (const route of routes) {
    const legs: Lane["legs"] = [];
    for (let i = 1; i < route.length; i++) {
      const [a, b] = [route[i - 1], route[i]];
      let k = ends.findIndex(([f, to]) => f === a && to === b);
      let pts = k >= 0 ? lay.edges[k].pts : [];
      if (k < 0) {
        k = ends.findIndex(([f, to], j) => f === b && to === a && lay.edges[j].both);
        if (k >= 0) pts = [...lay.edges[k].pts].reverse();
      }
      if (k < 0) break;
      legs.push({ edge: k, pts });
    }
    if (legs.length !== route.length - 1) continue;
    const box = (id: string) => lay.boxes[id];
    const centre = (id: string): Pt => [box(id).x + box(id).w / 2, box(id).y + box(id).h / 2];
    const path: Pt[] = [centre(route[0]), ...legs.flatMap((l) => l.pts), centre(route[route.length - 1])];
    const total = length(path);
    const spans: [number, number][] = [];
    const reach: number[] = [0];
    let at = dist(path[0], legs[0].pts[0]);
    legs.forEach((l, i) => {
      const len = length(l.pts);
      spans.push([at / total, (at + len) / total]);
      at += len;
      const next = legs[i + 1];
      // Through the box between two legs (hidden under it): its centre is half way.
      const through = next ? dist(l.pts[l.pts.length - 1], next.pts[0]) : dist(l.pts[l.pts.length - 1], path[path.length - 1]);
      reach.push((at + through / 2) / total);
      at += through;
    });
    reach[reach.length - 1] = 1;
    const travel = Math.max(PACE.minTravel, total / PACE.speed);
    out.push({ route, legs, start: t, travel, path, spans, reach });
    t += travel + PACE.rest;
  }
  return { lanes: out, period: Math.round(t * 100) / 100 };
}

const prefix = (d: WDiagram, view: WLayout["view"]) => `wd-${d.id}-${view}`;

/** The moving parts' markup: under the boxes (a dot sinks into a box and comes out the other side). */
function trafficMarkup(d: WDiagram, lay: WLayout): string[] {
  const p = prefix(d, lay.view);
  const { lanes: ls } = lanes(lay, ROUTES[d.id]);
  const glows = ls.flatMap((l, i) => l.legs.map((g, k) => el("path", { class: "wd-glow", id: `${p}-glow-${i}-${k}`, d: pathD(g.pts) })));
  const halos = ls.flatMap((l, i) =>
    l.route.slice(1).map((id, k) => {
      const b = lay.boxes[id];
      return el("rect", { class: "wd-halo", id: `${p}-halo-${i}-${k + 1}`, x: b.x - 3, y: b.y - 3, width: b.w + 6, height: b.h + 6, rx: 9 });
    }),
  );
  const dots = ls.map((_, i) => el("circle", { class: "wd-dot", id: `${p}-dot-${i}`, r: 4 }));
  return [el("g", { class: "wd-traffic", "aria-hidden": "true" }, ...glows, ...halos, ...dots)];
}

/** One drawing's routes and timing as CSS: per dot its offset-path and keyframes, per glow and halo its
 * moment in the round. Percentages of one round, so every part of a drawing shares one clock. */
function laneCss(d: WDiagram, lay: WLayout): string[] {
  const p = prefix(d, lay.view);
  const { lanes: ls, period } = lanes(lay, ROUTES[d.id]);
  const pct = (s: number) => `${Math.round(Math.min(100, Math.max(0, (s / period) * 100)) * 100) / 100}%`;
  const css: string[] = [];
  ls.forEach((l, i) => {
    const at = (f: number) => l.start + l.travel * f;
    const name = `${p}-tr-${i}`;
    css.push(`#${p}-dot-${i} { offset-path: path("${pathD(l.path)}"); --tr-name: ${name}; --tr-period: ${period}s; }`);
    css.push(`@keyframes ${name} { 0%, ${pct(l.start)} { offset-distance: 0%; opacity: 0; } ${pct(at(0.04))} { opacity: 1; } ${pct(at(0.96))} { opacity: 1; } ${pct(at(1))}, 100% { offset-distance: 100%; opacity: 0; } }`);
    l.spans.forEach(([s0, s1], k) => {
      const g = `${p}-gl-${i}-${k}`;
      css.push(`#${p}-glow-${i}-${k} { --tr-name: ${g}; --tr-period: ${period}s; }`);
      css.push(`@keyframes ${g} { 0%, ${pct(at(s0))} { opacity: 0; } ${pct(at(s0) + 0.08)}, ${pct(at(s1))} { opacity: 1; } ${pct(at(s1) + 0.45)}, 100% { opacity: 0; } }`);
    });
    l.reach.slice(1).forEach((f, k) => {
      const h = `${p}-ha-${i}-${k + 1}`;
      css.push(`#${p}-halo-${i}-${k + 1} { --tr-name: ${h}; --tr-period: ${period}s; }`);
      css.push(`@keyframes ${h} { 0%, ${pct(at(f) - 0.05)} { opacity: 0; } ${pct(at(f) + 0.08)} { opacity: 1; } ${pct(at(f) + 0.6)}, 100% { opacity: 0; } }`);
    });
  });
  return css;
}

/** The traffic's stylesheet for every drawing (styles.css imports it as work-traffic.css; the build supplies it). */
export function trafficCss(): string {
  const rules = WORK_DIAGRAMS.flatMap((d) => d.layouts.flatMap((l) => laneCss(d, l)));
  return ["/* Generated by src/diagram/work.ts (trafficCss) at build time: the drawings' traffic. */", ...rules, ""].join("\n");
}

/** One drawing as an inline <svg>. `only`: the page shows this drawing at every width (the vLLM drawer). */
export function workSvg(d: WDiagram, view: WLayout["view"], only = false): string {
  const lay = d.layouts.find((l) => l.view === view);
  if (!lay) throw new Error(`${d.id} has no ${view} drawing`);
  const p = prefix(d, view);
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
    ...trafficMarkup(d, lay),
    ...d.nodes.map((n) => nodeMarkup(n, lay.boxes[n.id])),
  );
}

/** The build's {{diagram.<id>.<view>}} substitutions. */
export function workSvgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of WORK_DIAGRAMS) {
    for (const l of d.layouts) out[`diagram.${d.id}.${l.view}`] = workSvg(d, l.view, d.id === "vllm");
    // The node panel under the drawings: each box's sentence, as ASCII mode's popup says it.
    out[`diagram.${d.id}.panel`] = panelMarkup(d.id, d.nodes.map((n) => ({ id: n.id, title: n.label, sub: n.sub, text: n.tip, role: n.role })));
  }
  return out;
}
