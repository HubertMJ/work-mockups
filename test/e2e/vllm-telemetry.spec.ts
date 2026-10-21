import { expect, test, type Page } from "@playwright/test";

// The mock-up's telemetry tab, under the production CSP. Every test fails on
// a console error or a page error.

const tab = (page: Page, id: string) => page.locator(`#vd-tab-${id}`).click();
const card = (page: Page, alias: string) => page.locator(`.vd-card[data-alias="${alias}"]`);
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/work/vllm/");
  await expect(page.locator(".vd-tab")).toHaveCount(7);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test.describe("telemetry", () => {
  test("host, every card and the engines, each with its metrics", async ({ page }) => {
    await tab(page, "telemetry");
    const host = page.locator('section[aria-labelledby="vd-tele-host"]');
    for (const t of ["CPU", "CPU temperature", "RAM", "Disk I/O", "Network in"]) await expect(host.locator(".vd-chart__title", { hasText: new RegExp(`^${t}$`) })).toHaveCount(1);
    await expect(host).toContainText(/load \d+\.\d\d \/ \d+\.\d\d \/ \d+\.\d\d/);
    await expect(host).toContainText(/Model cache volume: [\d.]+ of 560 GiB/);
    for (const i of [0, 1, 2, 3]) {
      const g = page.locator(`section[data-gpu="${i}"]`);
      for (const t of ["Utilization", "Temperature", "Power draw / 600 W", "VRAM"]) await expect(g.locator(".vd-chart__title", { hasText: t })).toHaveCount(1);
      await expect(g).toContainText(/peak 1 h: /);
      await expect(g).toContainText(/SM [\d,]+ MHz · MEM [\d,]+ MHz · fan \d+%/);
    }
    await expect(page.locator('section[data-gpu="0"]')).toContainText("Resident: qwen3-32b");
    await expect(page.locator('section[data-gpu="3"]')).toContainText("Card free");
    const rows = page.locator(".vd-etable tbody tr");
    await expect(rows).toHaveCount(7);
    await expect(page.locator('tr[data-engine="qwen3-32b"]')).toContainText(/\d\.\d\d\/s/);
    await expect(page.locator('tr[data-engine="model-b"] td.vd-num').first()).toHaveText("–");
    const eng = page.locator(".vd-tele__charts--engine");
    for (const t of ["Requests", "Tokens", "Time to first token", "Inter-token latency", "End-to-end latency", "Requests in engine", "KV cache usage", "Prefix cache hit rate", "Preemptions"])
      await expect(eng.locator(".vd-chart__title", { hasText: new RegExp(`^${t}$`) })).toHaveCount(1);
    await expect(eng.locator(".vd-chart__key", { hasText: "p95" }).first()).toBeVisible();
  });

  test("the charts move with the simulator, and the page and the focus stay where they are", async ({ page }) => {
    await tab(page, "telemetry");
    const btn = page.locator('[data-k="range:15m"]');
    await btn.focus();
    const panels = page.locator(".vd-panels");
    await panels.evaluate((p) => (p.scrollTop = 600));
    const line = page.locator('section[data-gpu="0"] .vd-chart__line').first();
    const sampled = page.locator(".vd-tele__sampled");
    const d0 = await line.getAttribute("d");
    const t0 = await sampled.textContent();
    await expect.poll(() => sampled.textContent(), { timeout: 5000 }).not.toBe(t0);
    await expect.poll(() => line.getAttribute("d"), { timeout: 5000 }).not.toBe(d0);
    expect(await panels.evaluate((p) => p.scrollTop)).toBe(600);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(btn).toBeFocused();
  });

  test("time range and card filter", async ({ page }) => {
    await tab(page, "telemetry");
    const x = page.locator('section[data-gpu="0"] .vd-chart__x').first();
    await expect(x).toContainText("−3 min");
    await page.locator('[data-k="range:1h"]').click();
    await expect(x).toContainText("−1 h");
    await expect(page.locator('[data-k="range:1h"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-k="range:15m"]').click();
    await expect(x).toContainText("−15 min");
    await page.locator("#vd-tele-cards").selectOption("1");
    await expect(page.locator('section[data-gpu="1"]')).toBeVisible();
    for (const i of [0, 2, 3]) await expect(page.locator(`section[data-gpu="${i}"]`)).toBeHidden();
    await page.locator("#vd-tele-cards").selectOption("all");
    await expect(page.locator("section[data-gpu]:visible")).toHaveCount(4);
  });

  test("picking an engine shows its metrics; an embedding engine has its own set", async ({ page }) => {
    await tab(page, "telemetry");
    await page.locator('[data-k="engine:embed-8b"]').click();
    await expect(page.locator("#vd-tele-engine")).toHaveValue("embed-8b");
    const eng = page.locator(".vd-tele__charts--engine");
    await expect(eng.locator(".vd-chart")).toHaveCount(4);
    await expect(eng).toContainText("Prompt tokens");
    await expect(eng).not.toContainText("Inter-token latency");
    await page.locator("#vd-tele-engine").selectOption("model-b");
    await expect(page.locator(".vd-tele__estate")).toContainText("model-b is stopped");
  });

  test("a start shows up: the card fills, the engine reports", async ({ page }) => {
    await card(page, "model-b").getByRole("button", { name: "Start" }).click();
    await expect(card(page, "model-b").locator("[data-status]")).toHaveText(/running/i, { timeout: 10_000 });
    await tab(page, "telemetry");
    await expect(page.locator('section[data-gpu="3"]')).toContainText("Resident: model-b");
    await expect(page.locator('section[data-gpu="3"] .vd-chart').nth(3).locator(".vd-chart__value")).toHaveText(/^3\dG$/);
    await expect(page.locator('tr[data-engine="model-b"]')).toContainText(/\d\.\d\d\/s/, { timeout: 5000 });
  });

  test("at phone width nothing scrolls the page sideways, and ASCII mode keeps the charts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, "telemetry");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.goto("/work/vllm/?ascii=1");
    await tab(page, "telemetry");
    await expect(page.locator("html")).toHaveClass(/ascii/);
    await expect(page.locator(".vd-chart svg").first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
