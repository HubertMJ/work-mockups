import { describe, expect, test } from "vitest";
import { block, book, edit, remove, send, start, togglePin, unblock } from "../../src/vllm/demo/actions";
import { admit, evictable } from "../../src/vllm/demo/admission";
import { aggregate, percentile } from "../../src/vllm/demo/analytics";
import { dep, HOUR, rng, SEED_NOW, START_MS, STOP_MS, WEEK0, DAY } from "../../src/vllm/demo/model";
import { plan } from "../../src/vllm/demo/planner";
import { seed } from "../../src/vllm/demo/seed";
import { tick } from "../../src/vllm/demo/sim";
import type { Deployment, Req, State } from "../../src/vllm/demo/types";

const run = (s: State, ms: number): State => {
  const r = rng(1);
  let out = s;
  for (let t = s.now + 100; t <= s.now + ms; t += 100) out = tick(out, t, r);
  return out;
};
const status = (s: State, alias: string) => dep(s, alias)?.status;
const put = (s: State, alias: string, patch: Partial<Deployment>): State => ({ ...s, deps: s.deps.map((d) => (d.alias === alias ? { ...d, ...patch } : d)) });

describe("admission", () => {
  test("a start that fits is admitted without evicting anything, then runs on its measured profile", () => {
    const s = seed();
    const a = admit(s, "model-b");
    expect(a).toMatchObject({ ok: true, evict: [] });
    const r = start(s, "model-b");
    expect(status(r.state, "model-b")).toBe("Starting");
    const later = run(r.state, START_MS + 200);
    expect(status(later, "model-b")).toBe("Running");
    expect(dep(later, "model-b")?.source).toBe("engine-log");
  });

  test("an estimate becomes a measurement when the engine reports it", () => {
    const s = put(seed(), "model-b", { status: "Stopped" });
    const r = start(s, "model-a-moe");
    expect(dep(r.state, "model-a-moe")?.source).toBe("estimate");
    const later = run(r.state, START_MS + 200);
    expect(dep(later, "model-a-moe")).toMatchObject({ status: "Running", source: "engine-log", minUtil: 0.7 });
  });

  test("a start that does not fit evicts idle lazy instances, least recently used first", () => {
    // GPU 3: model-b (0.38) and a small lazy x (0.2) run; model-a-moe needs 0.66 against the 0.95 ceiling.
    let s = put(seed(), "model-b", { status: "Running", lastUsed: SEED_NOW - 60_000 });
    s = { ...s, deps: [...s.deps, { ...dep(s, "model-b")!, alias: "x", minUtil: 0.2, lastUsed: SEED_NOW - 600_000 }] };
    expect(evictable(s, 3).map((d) => d.alias)).toEqual(["x", "model-b"]);
    const a = admit(s, "model-a-moe");
    expect(a).toMatchObject({ ok: true, evict: ["x", "model-b"] });
    const r = start(s, "model-a-moe");
    expect(status(r.state, "x")).toBe("Stopping");
    expect(status(r.state, "model-b")).toBe("Stopping");
    expect(r.state.notice?.text).toMatch(/^Evicted x, model-b/);
  });

  test("only as many as needed are evicted, oldest first", () => {
    let s = put(seed(), "model-b", { status: "Running", lastUsed: SEED_NOW - 60_000 });
    s = { ...s, deps: [...s.deps, { ...dep(s, "model-b")!, alias: "x", minUtil: 0.2, lastUsed: SEED_NOW - 600_000 }] };
    // qwen3-8b-sized: 0.4 fits once x (0.2) goes: 0.38 + 0.4 = 0.78.
    s = { ...s, deps: [...s.deps, { ...dep(s, "model-a-moe")!, alias: "y", minUtil: 0.4, source: "engine-log" }] };
    expect(admit(s, "y")).toMatchObject({ ok: true, evict: ["x"] });
  });

  test("pinned, reserved and non-lazy instances are never evicted", () => {
    let s = put(seed(), "model-b", { status: "Running", pinned: true });
    expect(evictable(s, 3)).toEqual([]);
    s = put(seed(), "model-b", { status: "Running", lazy: false });
    expect(evictable(s, 3)).toEqual([]);
    // qwen3-32b's nightly-eval is Active now.
    s = put(seed(), "qwen3-32b", { pinned: false, lazy: true });
    expect(evictable(s, 0)).toEqual([]);
  });

  test("a start that would not fit even after evicting is refused before anything stops", () => {
    // GPU 3: lazy model-b (0.38) runs and is evictable; a 0.99 start cannot fit even on an empty card.
    let s = put(seed(), "model-b", { status: "Running" });
    s = put(s, "model-a-moe", { minUtil: 0.99 });
    const r = start(s, "model-a-moe");
    expect(r.refused).toMatchObject({ ok: false, code: 503, reason: "would not fit even after evicting 1", evictable: 1 });
    expect(status(r.state, "model-b")).toBe("Running");
    expect(status(r.state, "model-a-moe")).toBe("Stopped");
    expect(r.state.notice?.level).toBe("error");
  });

  test("the seeded too-full card: GPU 0 holds pinned qwen3-32b, so qwen2.5-7b is refused", () => {
    const r = start(seed(), "qwen2.5-7b");
    expect(r.refused?.reason).toBe("would not fit even after evicting 0");
    expect(r.refused?.detail).toMatch(/qwen3-32b 0\.74 \(pinned\)/);
    expect(status(r.state, "qwen3-32b")).toBe("Running");
  });

  test("a blocked card refuses starts until loads are allowed again", () => {
    const s = seed();
    const r = start(s, "model-c");
    expect(r.refused).toMatchObject({ code: 503, reason: "GPU 2 is blocked for new loads" });
    expect(status(r.state, "model-c")).toBe("Error");
    const open = unblock(s, 2).state;
    expect(start(open, "model-c").refused).toBeUndefined();
    expect(start(block(open, 2, "firmware").state, "model-c").refused?.detail).toMatch(/firmware/);
  });

  test("one start at a time per card", () => {
    const s = start(seed(), "model-b").state;
    const s2 = put(s, "qwen2.5-7b", { gpu: 3 });
    expect(start(s2, "qwen2.5-7b").refused?.reason).toBe("GPU 3 has a start in progress");
  });
});

describe("reservation planner", () => {
  test("the seeded week: past, active, scheduled, the merged pair and one unfulfillable", () => {
    const s = seed();
    const by = (name: string) => s.reservations.filter((r) => r.name === name).map((r) => r.status);
    expect(by("nightly-eval")).toEqual(["Completed", "Completed", "Active", "Scheduled", "Scheduled"]);
    expect(by("load-test-1")).toEqual(["Scheduled"]);
    expect(by("load-test-2")).toEqual(["Scheduled"]);
    expect(by("batch-team-x")).toEqual(["Scheduled"]);
    const ev = s.reservations.find((r) => r.name === "eval-run");
    expect(ev?.status).toBe("Unfulfillable");
    expect(ev?.reason).toBe("At Wed 14:00 GPU 3 would need 1.04 of its 0.95 ceiling: model-b 0.38 (reservation ab-test) + model-a-moe 0.66 (this booking, estimate).");
  });

  test("a booking that fits is Scheduled; one that does not is Unfulfillable with the reason", () => {
    const s = seed();
    const thu = WEEK0 + 3 * DAY;
    const ok = book(s, { name: "fits", alias: "model-b", start: thu + 14 * HOUR, end: thu + 16 * HOUR });
    expect(ok.state.reservations.find((r) => r.id === ok.id)?.status).toBe("Scheduled");
    const no = book(ok.state, { name: "late", alias: "model-a-moe", start: thu + 15 * HOUR, end: thu + 17 * HOUR });
    const r = no.state.reservations.find((x) => x.id === no.id);
    expect(r?.status).toBe("Unfulfillable");
    expect(r?.reason).toMatch(/^At Thu 15:00 GPU 3 would need 1\.04/);
    // The earlier booking keeps its promise.
    expect(no.state.reservations.find((x) => x.id === ok.id)?.status).toBe("Scheduled");
  });

  test("bookings on the same deployment share its memory (merged), counted once", () => {
    const s = seed();
    const thu = WEEK0 + 3 * DAY;
    const a = book(s, { name: "m1", alias: "llama-3.3-70b-fp8", start: thu + 13 * HOUR, end: thu + 15 * HOUR });
    const b = book(a.state, { name: "m2", alias: "llama-3.3-70b-fp8", start: thu + 14 * HOUR, end: thu + 16 * HOUR });
    expect(b.state.reservations.find((x) => x.id === b.id)?.status).toBe("Scheduled");
  });

  test("a booking in the past or with an empty window is refused", () => {
    const s = seed();
    expect(book(s, { name: "x", alias: "model-b", start: SEED_NOW - HOUR, end: SEED_NOW + HOUR }).error).toMatch(/past/);
    expect(book(s, { name: "x", alias: "model-b", start: SEED_NOW + HOUR, end: SEED_NOW + HOUR }).error).toMatch(/end after/);
  });

  test("deleting the earlier booking lets the later one through", () => {
    const s = seed();
    const ab = s.reservations.find((r) => r.name === "ab-test")!;
    const next = plan({ ...s, reservations: s.reservations.filter((r) => r.id !== ab.id) });
    expect(next.find((r) => r.name === "eval-run")?.status).toBe("Scheduled");
  });

  test("pinning a deployment with a future reservation is a conflict (409) naming it", () => {
    const r = togglePin(seed(), "model-c");
    expect(r.conflict?.item.name).toBe("batch-team-x");
    expect(r.conflict?.remedy).toMatch(/pin model-c after it ends/);
    expect(dep(r.state, "model-c")?.pinned).toBe(false);
  });

  test("pinning that would crowd out another deployment's booking is a conflict too", () => {
    // model-a-moe pinned on GPU 3 would leave no room for ab-test's model-b (0.66 + 0.38 > 0.95).
    let s = seed();
    s = { ...s, reservations: s.reservations.filter((r) => r.alias !== "model-a-moe") };
    const r = togglePin(s, "model-a-moe");
    expect(r.conflict?.item.name).toBe("ab-test");
  });

  test("pinning without any booking in the way succeeds, and unpinning always does", () => {
    // On GPU 0, a pinned qwen2.5-7b would crowd out qwen3-32b's nightly-eval (0.30 + 0.74 > 0.95).
    expect(togglePin(seed(), "qwen2.5-7b").conflict?.item.name).toBe("nightly-eval");
    // On GPU 3 it fits next to ab-test's model-b (0.30 + 0.38); eval-run is already unfulfillable.
    const s = put(seed(), "qwen2.5-7b", { gpu: 3 });
    expect(togglePin(s, "qwen2.5-7b").conflict).toBeUndefined();
    expect(dep(togglePin(s, "qwen2.5-7b").state, "qwen2.5-7b")?.pinned).toBe(true);
    expect(dep(togglePin(s, "qwen3-32b").state, "qwen3-32b")?.pinned).toBe(false);
  });

  test("deleting a deployment with a booking is a conflict; without one it goes", () => {
    const s = seed();
    const r = remove(s, "llama-3.3-70b-fp8");
    expect(r.conflict?.item.name).toBe("load-test-1");
    expect(dep(r.state, "llama-3.3-70b-fp8")).toBeDefined();
    expect(dep(remove(s, "qwen2.5-7b").state, "qwen2.5-7b")).toBeUndefined();
  });

  test("an edit that raises the floor past a booking is a conflict; a running one marks Restart to apply", () => {
    const s = seed();
    // llama at 65536 tokens needs 0.91 + 48 × 0.002 = 1.01: its own load tests could no longer run.
    const r = edit(s, "llama-3.3-70b-fp8", { maxLen: 65536, maxSeqs: 32, lazy: false });
    expect(r.conflict?.item.name).toBe("load-test-1");
    const ok = edit(s, "qwen3-32b", { maxLen: 32768, maxSeqs: 48, lazy: false });
    expect(dep(ok.state, "qwen3-32b")?.pending).toEqual({ maxLen: 32768, maxSeqs: 48 });
  });
});

describe("playground through the gateway", () => {
  test("a prompt to a stopped lazy deployment cold-starts it, then streams and is logged", () => {
    const r = send(seed(), "model-b", "Write a haiku about GPUs");
    expect(r.state.stream?.phase).toBe("cold");
    expect(status(r.state, "model-b")).toBe("Starting");
    const later = run(r.state, START_MS + 3000);
    expect(later.stream?.phase).toBe("done");
    expect(later.requests[0]).toMatchObject({ alias: "model-b", status: 200, cold: true, path: "/v1/chat/completions" });
  });

  test("a prompt to a blocked card's deployment fails 503 and is logged", () => {
    const r = send(seed(), "model-c", "hello");
    expect(r.state.stream?.phase).toBe("failed");
    expect(r.state.requests[0]).toMatchObject({ alias: "model-c", status: 503, cold: true });
  });

  test("an extra alias reaches its deployment", () => {
    const r = send(seed(), "chat-default", "hello", true);
    expect(r.state.stream?.alias).toBe("qwen3-32b");
  });
});

describe("analytics", () => {
  const req = (alias: string, status: number, ms: number, ip = "192.0.2.1", cold = false): Req => ({
    id: `${alias}${ms}`, t: 0, alias, path: "/v1/chat/completions", status, ms, cold, ip, prompt: "", output: "",
  });

  test("counts, success, latency percentiles, cold starts and the top lists", () => {
    const s = aggregate([req("a", 200, 100), req("a", 503, 300, "192.0.2.2"), req("b", 200, 200), req("a", 200, 1000, "192.0.2.2", true), req("b", 200, 200, "192.0.2.2")]);
    expect(s).toMatchObject({ requests: 5, ok: 4, errors: 1, successPct: 80, avgMs: 360, p95Ms: 1000, cold: 1 });
    expect(s.models[0]).toEqual({ alias: "a", count: 3, avgMs: 1400 / 3, errors: 1 });
    expect(s.clients.map((c) => c.ip)).toEqual(["192.0.2.2", "192.0.2.1"]);
  });

  test("an empty ring gives zeros, not NaN", () => {
    expect(aggregate([])).toMatchObject({ requests: 0, successPct: 0, avgMs: 0, p95Ms: 0 });
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  test("the seeded background looks like the example's day, and a session request moves it", () => {
    const s = seed();
    const base = aggregate(s.background);
    expect(base.requests).toBe(2000);
    expect(base.errors).toBe(13);
    expect(base.cold).toBe(4);
    expect(base.models.map((m) => m.alias)).toEqual(["qwen3-32b", "embed-8b", "llama-3.3-70b-fp8", "model-b"]);
    const after = run(send(s, "qwen3-32b", "hello", true).state, 1000);
    expect(aggregate([...after.requests, ...after.background]).requests).toBe(2001);
  });
});

test("restarts and stops release and refill the card", () => {
  const s = seed();
  const r = run(start(s, "model-b").state, START_MS + STOP_MS + 500);
  expect(status(r, "model-b")).toBe("Running");
});
