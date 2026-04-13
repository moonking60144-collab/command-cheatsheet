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
});
