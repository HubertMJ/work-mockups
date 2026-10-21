import { expect, test, type Page } from "@playwright/test";

// The mock-up's deployment settings: the New deployment and Edit forms, under the production CSP. Every test fails on
// a console error or a page error.

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

test.describe("deployment settings", () => {
  const open = async (page: Page) => {
    await page.locator('[data-k="new-deployment"]').click();
    return page.getByRole("dialog", { name: "New deployment" });
  };

  test("every group is there, and the command follows the fields", async ({ page }) => {
    const dlg = await open(page);
    expect(await dlg.locator("[data-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")))).toEqual(["model", "memory", "engine", "serving", "spec", "lora", "env", "life", "flags"]);
    const cmd = dlg.locator(".vd-cmd");
    await expect(cmd).toContainText("vllm serve Qwen/Qwen3-14B");
    await expect(cmd).toContainText("--max-model-len 32768");
    await expect(cmd).toContainText("--reasoning-parser qwen3");
    await dlg.getByLabel("Tensor parallel").selectOption("2");
    await expect(cmd).toContainText("--tensor-parallel-size 2");
    await expect(dlg.locator(".vd-fit")).toContainText("runs past the last card");
    await dlg.getByLabel("GPU (first card)").selectOption("0");
    await expect(cmd).toContainText("CUDA_VISIBLE_DEVICES=0,1");
    await expect(dlg.locator(".vd-fit")).toContainText("GPU 0–1");
    await dlg.locator('[data-group="engine"] summary').click();
    await dlg.getByLabel("Prefix caching").uncheck();
    await expect(cmd).toContainText("--no-enable-prefix-caching");
    await expect(dlg.locator('[data-group="engine"] .vd-group__count')).toHaveText(" · 1 set");
    await dlg.getByText("fp8", { exact: true }).click();
    await expect(cmd).toContainText("--kv-cache-dtype fp8");
  });

  test("a bad value is refused at Create, marked on its field, in its opened group", async ({ page }) => {
    const dlg = await open(page);
    await dlg.locator('[data-group="serving"] summary').click();
    await dlg.getByLabel("Chat template kwargs").fill("{not json");
    await dlg.locator('[data-group="serving"] summary').click();
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(dlg.locator(".vd-form-error")).toHaveText("Not valid JSON.");
    await expect(dlg.locator('[data-group="serving"]')).toHaveAttribute("open", "");
    await expect(dlg.getByLabel("Chat template kwargs")).toHaveAttribute("aria-invalid", "true");
    await expect(dlg.getByLabel("Chat template kwargs")).toBeFocused();
    await dlg.getByLabel("Chat template kwargs").fill('{"enable_thinking": false}');
    await expect(dlg.getByLabel("Chat template kwargs")).toHaveAttribute("aria-invalid", "false");
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(card(page, "qwen3-14b")).toBeVisible();
  });

  test("a pasted command fills the form, and the deployment carries its settings", async ({ page }) => {
    const dlg = await open(page);
    await dlg.locator(".vd-paste summary").click();
    await dlg.getByLabel("vllm serve command").fill("vllm serve Qwen/Qwen3-8B --served-model-name q8 --max-model-len 16384 --kv-cache-dtype fp8 --enforce-eager --seed 7");
    await dlg.getByRole("button", { name: "Read the command" }).click();
    await expect(dlg.locator(".vd-paste .vd-hint")).toContainText("Read: Qwen/Qwen3-8B, 16384 tokens; 2 words kept as custom flags");
    await expect(dlg.getByLabel("Alias (served model name)")).toHaveValue("q8");
    await expect(dlg.getByLabel("Max model length (tokens)")).toHaveValue("16384");
    await expect(dlg.locator(".vd-cmd")).toContainText("--enforce-eager");
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(card(page, "q8")).toContainText("fp8 KV");
    await dlg.page().locator('[data-k="edit:q8"]').click();
    const ed = page.getByRole("dialog", { name: "Edit q8" });
    await expect(ed.locator(".vd-cmd")).toContainText("--seed 7");
    await expect(ed.locator(".vd-cmd")).toContainText("--kv-cache-dtype fp8");
  });

  test("editing a running deployment's engine settings waits for a restart", async ({ page }) => {
    await card(page, "qwen3-32b").locator('[data-k="edit:qwen3-32b"]').click();
    const ed = page.getByRole("dialog", { name: "Edit qwen3-32b" });
    await expect(ed.getByLabel("GPU (first card)")).toBeDisabled();
    await ed.locator('[data-group="engine"] summary').click();
    await ed.getByLabel("Enforce eager").check();
    await ed.getByRole("button", { name: "Save" }).click();
    await expect(card(page, "qwen3-32b")).toContainText("Restart to apply: --enforce-eager");
  });

  test("at phone width the whole form fits, every group open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dlg = await open(page);
    await dlg.evaluate((d) => d.querySelectorAll("details").forEach((x) => ((x as HTMLDetailsElement).open = true)));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await dlg.evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  });
});
