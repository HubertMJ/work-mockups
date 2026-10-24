import { expect, test } from "@playwright/test";

// The image serves the /work/ pages only: three pages, their hashed assets under /work/assets/, a
// favicon, a redirect for /work/ itself and a health check. Each page says the system is real but its
// code is not here, fits the screen, and shows no screenshot of anything.

test("each page loads, says what it is, fits the screen and carries no screenshot", async ({ page }) => {
  for (const [path, words, note] of [
    ["/work/vllm/", "vLLM Deployment Manager", "A mock-up of a system I built and run. The real one isn't public"],
    ["/work/bridge/", "From a mention to a pull request", "Built and in daily use. The code isn't public: this is a description written for this site."],
    ["/work/flota/", "One screen for the whole fleet", "Built and used on a real project, then rewritten from scratch as a general tool."],
  ]) {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator("main")).toContainText(words);
    await expect(page.locator("body")).toContainText(note);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("img, .shot")).toHaveCount(0);
    expect(errors, path).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }
});

// Flota's page also covers many fleets: the managers' channel and MultiAsk, in words and in a second drawing.
test("the Flota page describes the channel between fleets and MultiAsk", async ({ page }) => {
  await page.goto("/work/flota/");
  const fleets = page.locator("#fleets");
  await expect(fleets.getByRole("heading", { level: 2 })).toHaveText("Managers that talk, one place for questions");
  await expect(fleets.locator("pre.term")).toContainText("flota channel receive");
  await expect(fleets.locator('svg.wd-map[data-diagram="fleets"]')).toHaveCount(2);
  for (const words of ["Managers talk across fleets.", "A courier that never types the message.", "MultiAsk."]) await expect(page.locator("#how .work-list")).toContainText(words);
});

// The Gateway sends /work/ to this image and everything else elsewhere: a page that loaded anything
// outside /work/ would get another service's answer.
test("every page loads its scripts, styles and fonts from /work/ only", async ({ page }) => {
  for (const path of ["/work/vllm/", "/work/bridge/", "/work/flota/"]) {
    const local: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (r.resourceType() !== "document") local.push(u.origin === "http://127.0.0.1:4290" ? u.pathname : u.href);
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(local.filter((p) => !p.startsWith("/work/assets/") && p !== "/work/favicon.svg"), path).toEqual([]);
    page.removeAllListeners("request");
  }
});

test("/work/ sends the visitor to the landing page's projects, /work to /work/; /healthz answers; other paths are not this image's", async ({ request }) => {
  for (const [p, code, to] of [["/work/", 302, "/#projects"], ["/work", 301, "/work/"]] as const) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.status(), p).toBe(code);
    // A path, never a host or a port.
    expect(r.headers().location, p).toBe(to);
  }
  expect(await (await request.get("/healthz")).text()).toBe("ok\n");
  for (const p of ["/cluster/", "/lab/", "/work/nothing/"]) expect((await request.get(p)).status(), p).toBe(404);
  const page = await request.get("/work/vllm/");
  expect(page.headers()["content-security-policy"]).toContain("require-trusted-types-for 'script'");
});

// The console greeting (src/console-hello) stays quiet under automation, so it never shows in the
// suites' console checks. Here automation is masked to see a person's view: once, with the commit.
test("the console greets a person once per page load, with the build's commit, without an error", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { configurable: true, get: () => false }));
  for (const path of ["/work/vllm/", "/work/bridge/"]) {
    const logs: string[] = [];
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "log") logs.push(m.text());
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path);
    await expect.poll(() => logs.filter((l) => l.includes("You opened the console")).length, path).toBe(1);
    expect(logs.some((l) => l.includes("github.com/HubertMJ/work-mockups")), path).toBe(true);
    expect(logs.some((l) => /Built from commit [0-9a-f]{7}\./.test(l)), path).toBe(true);
    await page.waitForTimeout(300);
    expect(logs.filter((l) => l.includes("You opened the console")).length, path).toBe(1);
    expect(errors, path).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }
});
