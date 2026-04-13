const { test, expect } = require("@playwright/test");

test.describe("Command Atlas smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#command-count")).not.toHaveText(/^0 /);
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("loads commands.json and renders at least one card", async ({ page }) => {
    const count = await page.locator(".command-card").count();
    expect(count).toBeGreaterThan(0);
  });

  test("typing in search filters the result list", async ({ page }) => {
    const search = page.locator("#search-input");
    const beforeCount = await page.locator(".command-card").count();

    await search.fill("git");
    await expect(page.locator("#result-summary")).not.toHaveText(/正在載入/);

    const afterCount = await page.locator(".command-card").count();
    expect(afterCount).toBeGreaterThan(0);
    expect(afterCount).toBeLessThanOrEqual(beforeCount);
  });

  test("Esc clears the search and re-focuses the active search input", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("git");
    await expect(search).toHaveValue("git");

    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
  });

  test("/ shortcut focuses the search from anywhere", async ({ page }) => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(page.locator("#search-input")).toBeFocused();
  });

  test("Ctrl+K focuses the search from anywhere", async ({ page }) => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+K");
    await expect(page.locator("#search-input")).toBeFocused();
  });

  test("clicking a category badge applies a filter", async ({ page }) => {
    const firstBadge = page.locator(".category-badge-button").first();
    const categoryName = (await firstBadge.textContent())?.trim();
    expect(categoryName).toBeTruthy();

    await firstBadge.click();
    await expect(page.locator("#active-state")).toContainText(categoryName);
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("search matches are highlighted with <mark> in descriptions", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("git");
    await expect(page.locator(".command-card mark").first()).toBeVisible();
  });

  test("empty state renders terminal-style grep prompt when nothing matches", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("zzzzz_no_match_expected_zzzzz");
    const empty = page.locator(".empty-state").first();
    await expect(empty).toBeVisible();
    await expect(empty.locator(".empty-state-sigil")).toHaveText("$");
    await expect(empty.locator(".empty-state-token")).toContainText("zzzzz_no_match_expected_zzzzz");
    await expect(empty.locator(".empty-state-zero")).toContainText("0");
  });

  test("scroll-top button and sticky search bar toggle together past the hero", async ({ page }) => {
    const stickyBar = page.locator("#sticky-search-bar");
    const scrollTop = page.locator("#scroll-top-btn");

    await expect(stickyBar).not.toHaveClass(/is-visible/);
    await expect(scrollTop).not.toHaveClass(/is-visible/);

    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(stickyBar).toHaveClass(/is-visible/);
    await expect(scrollTop).toHaveClass(/is-visible/);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(stickyBar).not.toHaveClass(/is-visible/);
    await expect(scrollTop).not.toHaveClass(/is-visible/);
  });

  test("Esc while scrolled keeps the page in place and focuses the sticky search", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);

    const stickyInput = page.locator("#sticky-search-input");
    await stickyInput.fill("git");

    await page.keyboard.press("Escape");

    await expect(stickyInput).toHaveValue("");
    await expect(stickyInput).toBeFocused();
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(500);
  });
});
