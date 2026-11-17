const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".command-card")).toHaveCount(100);
  await page.evaluate(() => document.fonts.ready);
});

test("rapid disclosure reversals keep the visible height and settle on the latest row", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [first, second] = document.querySelectorAll(".command-card");
    const frame = () => new Promise(requestAnimationFrame);
    const height = (element) => element.getBoundingClientRect().height;
    const initialHeight = height(first);
    first.querySelector(".details-toggle").click();
    const firstFrameDeadline = performance.now() + 750;
    while (height(first) <= initialHeight && performance.now() < firstFrameDeadline) await frame();
    const intermediateHeight = height(first);
    first.querySelector(".details-toggle").click();
    const reversalHeight = height(first);
    await frame();
    await frame();
    first.querySelector(".details-toggle").click();
    await frame();
    second.querySelector(".details-toggle").click();
    const deadline = performance.now() + 1500;
    while (document.getAnimations().length && performance.now() < deadline) await frame();
    return {
      initialHeight, intermediateHeight, reversalHeight,
      finalHeight: height(first),
      expandedIds: [...document.querySelectorAll(".command-card.is-expanded")].map((card) => card.dataset.commandId),
      expectedId: second.dataset.commandId,
      activeAnimations: document.getAnimations().length
    };
  });
  expect(result.intermediateHeight).toBeGreaterThan(result.initialHeight);
  expect(Math.abs(result.reversalHeight - result.intermediateHeight)).toBeLessThan(1);
  expect(Math.abs(result.finalHeight - result.initialHeight)).toBeLessThan(1);
  expect(result.expandedIds).toEqual([result.expectedId]);
  expect(result.activeAnimations).toBe(0);
});

test("density changes preserve the command editor and animate the existing rows", async ({ page }) => {
  const first = page.locator(".command-card").first();
  await first.locator(".details-toggle").click();
  await first.locator(".placeholder-input").fill("my search value");
  const result = await page.evaluate(async () => {
    const first = document.querySelector(".command-card");
    const input = first.querySelector(".placeholder-input");
    const row = first.nextElementSibling;
    const normalHeight = row.getBoundingClientRect().height;
    document.querySelector("#view-toggle-btn").click();
    await Promise.all(row.getAnimations().map((animation) => animation.finished));
    return {
      sameCard: first === document.querySelector(".command-card"),
      sameInput: input === document.querySelector(".placeholder-input"),
      value: input.value,
      normalHeight,
      compactHeight: row.getBoundingClientRect().height
    };
  });
  expect(result.sameCard).toBe(true);
  expect(result.sameInput).toBe(true);
  expect(result.value).toBe("my search value");
  expect(result.compactHeight).toBeLessThan(result.normalHeight);
});

test("a touch disclosure does not move the page while its focused button animates", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".command-card")).toHaveCount(100);
  await page.evaluate(() => document.fonts.ready);
  const button = await page.locator(".details-toggle").first().boundingBox();
  // Raw touch input avoids the locator's automatic scroll-into-view step.
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await context.close();
});

test("reduced motion applies details and density immediately, including keyboard notes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const first = page.locator(".command-card").first();
  await first.locator(".details-toggle").click();
  const notes = first.locator(".command-notes");
  await notes.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(notes).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(notes).not.toHaveAttribute("open", "");
  await page.locator("#view-toggle-btn").click();
  await expect(page.locator("body")).toHaveClass(/is-list-view/);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(first).toHaveClass(/is-expanded/);
});

test("new local icons and fonts are available after an offline reload", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".command-card")).toHaveCount(100);
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const sprite = await fetch("assets/icons/ui.svg");
    const iconMarkup = await sprite.text();
    return {
      iconsAvailable: sprite.ok && iconMarkup.includes('id="terminal"'),
      fontStatuses: [...document.fonts].map((font) => ({ family: font.family, weight: font.weight, status: font.status }))
    };
  });
  expect(result.iconsAvailable).toBe(true);
  expect(result.fontStatuses).toEqual(expect.arrayContaining([
    { family: "Instrument Sans", weight: "400", status: "loaded" },
    { family: "IBM Plex Mono", weight: "500", status: "loaded" }
  ]));
});
