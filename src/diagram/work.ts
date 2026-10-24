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
  /** This drawing's own routes for its traffic, where it draws other links than the diagram's ROUTES. */
  routes?: string[][];
  /** Nodes this drawing leaves out: parts a phone folds into one box, or that box on a wide drawing. */
  folded?: string[];
}

export interface WDiagram {
  id: "vllm" | "bridge" | "flota" | "fleets";
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
  // The columns sit left enough for the planner's trunk to leave room for a whole arrow back into it.
  const L = 16;
  const R = 232;
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
  // The sessions down a column, the hook beside the manager, the zone's title above the hook. Nothing
  // crosses the title, so what comes from above meets the column right of it. Every other box is too
  // wide to stand beside a session, so each gets a row of its own outside the zone, beside the link it
  // makes: the owner and the guard above, the owner's line turning to the manager, the guard's straight
  // down to it and, on its own down the right, into the sections; the state files below, beside the
  // merger; main lower still, under the merger. No two lines cross or run side by side, and no two heads share a side.
  const x = 136;
  const w = 170;
  const B: Record<string, Box> = {
    owner: bx(12, 8, 140),
    guard: bx(186, 8, 160),
    hook: bx(20, 152, 89, 44),
    pm: bx(x, 148, w),
    sections: bx(x, 256, w),
    merger: bx(x, 342, w),
    state: bx(12, 430, 185),
    main: bx(x, 516, w),
  };
  const right = 332;
  const into = 212;
  const turn = 88;
  const leg = 100;
  return {
    view: "narrow",
    width: 360,
    height: 576,
    boxes: B,
    zones: [{ box: bx(8, 104, 344, 306), title: "TMUX", sub: "a session per window" }],
    routes: [
      ["owner", "pm", "sections", "merger", "main"],
      ["guard", "pm"],
      ["guard", "sections"],
      ["merger", "state"],
    ],
    edges: [
      path([[cx(B.owner), B.owner.y + B.owner.h + GAP], [cx(B.owner), turn], [into, turn], [into, B.pm.y - GAP]], "talks", [(cx(B.owner) + into) / 2, turn - 8], "middle", { both: true }),
      down(B.pm, B.sections, "by name", undefined, { both: true, at: [cx(B.pm) - 8, (B.pm.y + B.pm.h + B.sections.y) / 2 + 4], anchor: "end" }),
      down(B.sections, B.merger, "branch"),
      down(B.merger, B.main, "merges"),
      across(B.hook, B.pm, ""),
      down(B.guard, B.pm, "", 260),
      path([[right, B.guard.y + B.guard.h], [right, cy(B.sections)], [x + w + GAP, cy(B.sections)]], "PAUSE·HARD·OK", [right - 8, (B.pm.y + B.pm.h + B.sections.y) / 2 + 4], "end"),
      path([[leg, B.state.y - GAP], [leg, cy(B.merger)], [x - GAP, cy(B.merger)]], "read/write", [leg - 8, cy(B.merger) + 18], "end", { dashed: true, both: true }),
    ],
  };
}

// ---------- many fleets: the channel between managers, and MultiAsk ----------

// Each fleet is the drawing above in small: the hook and the fleet's courier over its manager; the
// sections, the merger and main to the manager's left; the limit guard and the state files under them.
// Its manager alone reaches the spool, on a line of its own to the right, so no section ever does.
function fleetWide(p: string, zy: number) {
  const y1 = zy + 24;
  const y2 = y1 + 96;
  const y3 = y2 + 104;
  const B: Record<string, Box> = {
    [p]: bx(640, y2, 180),
    [`${p}Hook`]: bx(640, y1, 96, 44),
    [`${p}Courier`]: bx(760, y1, 140),
    [`${p}Sections`]: bx(386, y2, 170),
    [`${p}Merger`]: bx(184, y2, 130),
    [`${p}Main`]: bx(32, y2, 80),
    [`${p}Guard`]: bx(470, y3, 220),
    [`${p}State`]: bx(150, y3, 260),
  };
  const pm = B[p];
  const state = B[`${p}State`];
  const under = y3 + 52 + 28;
  const mid = (y2 + 52 + y3) / 2 + 4;
  const edges: WEdge[] = [
    down(B[`${p}Hook`], pm, "delegate only"),
    down(B[`${p}Courier`], pm, "notice", 790),
    across(pm, B[`${p}Sections`], "by name", undefined, { both: true }),
    across(B[`${p}Sections`], B[`${p}Merger`], "branch"),
    across(B[`${p}Merger`], B[`${p}Main`], "merges"),
    up(B[`${p}Guard`], pm, "", 680),
    up(B[`${p}Guard`], B[`${p}Sections`], "PAUSE · HARD · OK", 520, { at: [600, mid], anchor: "middle" }),
    up(state, B[`${p}Sections`], "", 400, { dashed: true, both: true }),
    up(state, B[`${p}Merger`], "read · write", 250, { dashed: true, both: true, at: [325, mid], anchor: "middle" }),
    path([[280, state.y + state.h + GAP], [280, under], [800, under], [800, pm.y + pm.h + GAP]], "", [0, 0], "middle", { dashed: true, both: true }),
  ];
  return { B, edges, zone: bx(16, zy, 984, under + 14 - zy) };
}

function fleetsWide(): WLayout {
  const a = fleetWide("alpha", 16);
  const b = fleetWide("beta", 342);
  const zy = 668;
  const askCourier = bx(760, zy + 24, 140);
  const multiask = bx(640, zy + 120, 180);
  const owner = bx(360, zy + 120, 150);
  const spool = bx(1024, 40, 140, multiask.y + multiask.h - 40);
  const B: Record<string, Box> = { ...a.B, ...b.B, askCourier, multiask, owner, spool };
  // Every participant the same way to the spool: its own two-way line, and the spool's line to its courier.
  const wire = (pm: Box, courier: Box): WEdge[] => [
    across(pm, spool, "send · receive", undefined, { dashed: true, both: true }),
    across(spool, courier, "new mail", cy(courier), { dashed: true }),
  ];
  return {
    view: "wide",
    width: 1180,
    height: 872,
    boxes: B,
    folded: ["betaFleet"],
    zones: [
      { box: a.zone, title: "FLEET ALPHA", sub: "Linux user alpha" },
      { box: b.zone, title: "FLEET BETA", sub: "Linux user beta" },
      { box: bx(16, zy, 984, 188), title: "SUPERVISOR", sub: "the owner's user" },
    ],
    edges: [
      ...a.edges,
      ...wire(B.alpha, B.alphaCourier),
      ...b.edges,
      ...wire(B.beta, B.betaCourier),
      down(askCourier, multiask, "notice", 790),
      across(multiask, owner, "asks · answers", undefined, { both: true }),
      ...wire(multiask, askCourier),
    ],
  };
}

function fleetsNarrow(): WLayout {
  // MultiAsk (under the owner) and fleet beta (folded into one box over its manager) side by side,
  // each manager with its courier under it; the spool under both; fleet alpha in full under the spool,
  // as in the drawing above: hook and guard to the left of the column, the courier over the manager.
  const S: Record<string, Box> = {
    owner: bx(14, 40, 154), multiask: bx(14, 136, 154), askCourier: bx(46, 232, 122),
    betaFleet: bx(192, 40, 154), beta: bx(192, 136, 154), betaCourier: bx(224, 232, 122),
    spool: bx(6, 328, 348),
  };
  const z = 420;
  const A: Record<string, Box> = {
    alphaCourier: bx(196, z + 10, 152),
    alpha: bx(154, z + 106, 170),
    alphaHook: bx(12, z + 100, 96, 44),
    alphaSections: bx(154, z + 214, 170),
    alphaGuard: bx(12, z + 214, 114),
    alphaMerger: bx(154, z + 318, 170),
    alphaState: bx(12, z + 404, 170),
    alphaMain: bx(200, z + 426, 120),
  };
  const B = { ...S, ...A };
  const { spool, alpha: pm } = B;
  const top = (pm: Box, courier: Box, line: number): WEdge[] => [
    down(pm, spool, "", line, { dashed: true, both: true }),
    up(courier, pm, "notice", cx(courier)),
    up(spool, courier, "new mail", cx(courier), { dashed: true }),
  ];
  const guard = B.alphaGuard;
  return {
    view: "narrow",
    width: 360,
    height: 920,
    boxes: B,
    folded: ["betaHook", "betaSections", "betaMerger", "betaMain", "betaGuard", "betaState"],
    routes: [
      ["alpha", "spool", "betaCourier", "beta"],
      ["beta", "betaFleet"],
      ["beta", "spool", "askCourier", "multiask", "owner"],
      ["owner", "multiask", "spool", "betaCourier", "beta"],
      ["alpha", "alphaSections", "alphaMerger", "alphaMain"],
    ],
    zones: [
      { box: bx(6, 8, 170, 288), title: "SUPERVISOR", sub: "" },
      { box: bx(184, 8, 170, 288), title: "FLEET BETA", sub: "" },
      { box: bx(6, z, 348, 490), title: "FLEET ALPHA", sub: "" },
    ],
    edges: [
      down(B.owner, B.multiask, "asks · answers", 150, { both: true, at: [142, 118], anchor: "end" }),
      ...top(B.multiask, B.askCourier, 30),
      up(B.beta, B.betaFleet, "by name", undefined, { both: true }),
      ...top(B.beta, B.betaCourier, 208),
      up(pm, spool, "send · receive", 164, { dashed: true, both: true, at: [156, 404], anchor: "end" }),
      down(spool, B.alphaCourier, "new mail", 300, { dashed: true, at: [292, 404], anchor: "end" }),
      down(B.alphaCourier, pm, "notice", 250),
      across(B.alphaHook, pm, ""),
      path([[120, guard.y], [120, pm.y + 44], [pm.x - GAP, pm.y + 44]], "", [0, 0], "middle"),
      across(guard, B.alphaSections, ""),
      down(pm, B.alphaSections, "by name", undefined, { both: true }),
      down(B.alphaSections, B.alphaMerger, "branch"),
      down(B.alphaMerger, B.alphaMain, "merges", 262),
      path([[100, B.alphaState.y - GAP], [100, cy(B.alphaMerger)], [B.alphaMerger.x - GAP, cy(B.alphaMerger)]], "read/write", [92, cy(B.alphaMerger) + 18], "end", { dashed: true, both: true }),
    ],
  };
}

// One fleet's boxes, named after it: the same parts and words as the drawing above.
const fleet = (p: "alpha" | "beta", user: string): WNode[] => [
  { id: p, label: `PM ${p}`, sub: `manages fleet ${p}`, role: "site", tip: p === "alpha" ? "Fleet alpha's manager: it plans and hands out work at home, and is the only one in the fleet on the channel." : "Runs as another Linux user and cannot see alpha's sessions at all: the spool is the one place they meet." },
  { id: `${p}Hook`, label: "PM hook", sub: "no edits", role: "project", tip: "A tool hook on the manager refuses edits and writes, and says: give it to a section." },
  { id: `${p}Courier`, label: "Courier", sub: `${p} · no model`, role: "project", tip: p === "alpha" ? "Checks alpha's mailbox every 30 seconds and, when the manager sits idle, types who wants to reach it, never the message." : "Waits while a dialog is open or the owner is typing, and tries again on its next round; it costs no tokens." },
  { id: `${p}Sections`, label: "Sections", sub: "one tmux window each", role: "site", tip: `Fleet ${p}'s sections, each in its own window with its own scope; they never touch the channel.` },
  { id: `${p}Merger`, label: "Merger", sub: "only one merges", role: "site", tip: "One session merges, so branches land on main one at a time and in order." },
  { id: `${p}Main`, label: "main", sub: "branch", role: "path", tip: `Where fleet ${p}'s work ends up, in the project ${user} works on.` },
  { id: `${p}Guard`, label: "Limit guard", sub: "reads usage", role: "project", tip: `Watches ${user}'s usage limits and types PAUSE, HARD or OK into the fleet's windows, spending no tokens.` },
  { id: `${p}State`, label: "State files", sub: "orders · decisions", role: "lab", tip: "The fleet's own plain files: open orders, decisions taken, each section's state." },
];

const FLEETS: WDiagram = {
  id: "fleets",
  title: "Many fleets, one owner",
  desc:
    "Two fleets, each the whole of the drawing above: a manager with its hook, sections, a merger to main, a limit guard and " +
    "state files, under Linux users of their own. Only the managers reach the channel: a shared spool with a mailbox per " +
    "manager and a registry of who is who. A manager sends with flota channel send; the receiving fleet's courier, which " +
    "runs no model, sees the new mail and, only while its manager is idle, types a one-line notice into the manager's window; " +
    "the manager then reads the message itself. MultiAsk is one more participant with its own courier: every fleet's " +
    "questions to the owner land there, the owner answers in one place, and each answer goes back to the manager that asked.",
  nodes: [
    ...fleet("alpha", "user alpha"),
    ...fleet("beta", "user beta"),
    { id: "betaFleet", label: "Beta's fleet", sub: "same shape as alpha's", role: "site", tip: "Folded on a phone: fleet beta has the same hook, sections, merger, limit guard and state files as alpha." },
    { id: "spool", label: "Channel spool", sub: "a mailbox per PM", role: "lab", tip: "A shared directory: a mailbox per manager, a slot in it only the sender's account can write to, and a registry of who is who." },
    { id: "askCourier", label: "Courier", sub: "no model", role: "project", tip: "MultiAsk is one more participant, with a courier of its own that tells it a question has come in." },
    { id: "multiask", label: "MultiAsk", sub: "every PM's questions", role: "site", tip: "One session where every fleet's questions to the owner land; it asks them in one place and sends each answer back." },
    { id: "owner", label: "Owner", sub: "you, in one window", role: "path", tip: "You answer every fleet's questions from one window, and each answer goes back to the manager that asked." },
  ],
  layouts: [fleetsWide(), fleetsNarrow()],
};

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
    { id: "pm", label: "Project manager", sub: "plans, hands out work", role: "site", tip: "Splits the work and sends it to sections by name; it cannot do the work itself." },
    { id: "sections", label: "Sections", sub: "own tmux session each", role: "site", tip: "Each section is a session in its own window with its own scope, reporting back when done." },
    { id: "merger", label: "Merger", sub: "the only one to merge", role: "site", tip: "One session merges, so branches land on main one at a time and in order." },
    { id: "main", label: "main", sub: "the project's branch", role: "path", tip: "Where the fleet's work ends up." },
    { id: "guard", label: "Limit guard", sub: "no model · reads usage", role: "project", tip: "Watches the account's usage and types PAUSE, HARD or OK into every window, spending no tokens." },
    { id: "state", label: "State files", sub: "orders · decisions · state", role: "lab", tip: "Plain files every session reads and writes: open orders, decisions taken, each section's state." },
  ],
  layouts: [flotaWide(), flotaNarrow()],
};

export const WORK_DIAGRAMS: WDiagram[] = [VLLM, BRIDGE, FLOTA, FLEETS];

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
  // A message from alpha to beta, beta's sections at work, beta's question to the owner through MultiAsk,
  // the answer back, and alpha's guard on its sections.
  fleets: [
    ["alpha", "spool", "betaCourier", "beta"],
    ["beta", "betaSections", "betaMerger", "betaMain"],
    ["beta", "spool", "askCourier", "multiask", "owner"],
    ["owner", "multiask", "spool", "betaCourier", "beta"],
    ["alphaGuard", "alphaSections"],
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
    // Through the box between two legs, hidden under it. Where both legs meet one side of the box (the
    // spool's top), the straight way would run along its edge in sight, so the dot dips to the centre.
    const via = (id: string, p: Pt, q: Pt): Pt[] => {
      const b = box(id);
      const [mx, my] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return mx > b.x && mx < b.x + b.w && my > b.y && my < b.y + b.h ? [] : [centre(id)];
    };
    const path: Pt[] = [centre(route[0]), ...legs.flatMap((l, i) => (legs[i + 1] ? [...l.pts, ...via(route[i + 1], l.pts[l.pts.length - 1], legs[i + 1].pts[0])] : l.pts)), centre(route[route.length - 1])];
    const total = length(path);
    const spans: [number, number][] = [];
    const reach: number[] = [0];
    let at = dist(path[0], legs[0].pts[0]);
    legs.forEach((l, i) => {
      const len = length(l.pts);
      spans.push([at / total, (at + len) / total]);
      at += len;
      const next = legs[i + 1];
      const end = l.pts[l.pts.length - 1];
      const hop = next ? [end, ...via(route[i + 1], end, next.pts[0]), next.pts[0]] : [end, path[path.length - 1]];
      // Its centre is half way through.
      const through = length(hop);
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
  const { lanes: ls } = lanes(lay, lay.routes ?? ROUTES[d.id]);
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
  const { lanes: ls, period } = lanes(lay, lay.routes ?? ROUTES[d.id]);
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
    ...d.nodes.filter((n) => lay.boxes[n.id]).map((n) => nodeMarkup(n, lay.boxes[n.id])),
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
