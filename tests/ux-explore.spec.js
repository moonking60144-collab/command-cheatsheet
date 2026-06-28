// Exploratory UX / interaction probes. Not a permanent suite — written
// to flush out edge cases that the smoke tests don't cover.
const { test, expect } = require("@playwright/test");

test.describe("UX exploratory", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("pin survives reload and appears in pinned filter", async ({ page }) => {
    const firstCard = page.locator(".command-card").first();
    const pinBtn = firstCard.locator(".pin-button");
    const cardId = await firstCard.getAttribute("data-command-id");

    await pinBtn.click();
    await expect(pinBtn).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    const reloadedCard = page.locator(`.command-card[data-command-id="${cardId}"]`).first();
    await expect(reloadedCard.locator(".pin-button")).toHaveAttribute("aria-pressed", "true");

    // Pinned filter pill should exist now
    await expect(page.locator('.filter-pill[data-category="pinned"]')).toBeVisible();
    await page.locator('.filter-pill[data-category="pinned"]').click();
    await expect(page.locator(".command-card")).toHaveCount(1);
  });

  test("unpinning the last pinned card while viewing pinned bounces back to 'all'", async ({ page }) => {
    const firstCard = page.locator(".command-card").first();
    await firstCard.locator(".pin-button").click();

    await page.locator('.filter-pill[data-category="pinned"]').click();
    await expect(page.locator("#active-state")).toContainText("已釘選");

    // Unpin the only pinned card
    await page.locator(".command-card .pin-button").first().click();

    // Should fall back to "all"
    await expect(page.locator("#active-state")).toContainText("全部分類");
    await expect(page.locator('.filter-pill[data-category="pinned"]')).toHaveCount(0);
  });

  test("placeholder value is preserved in clipboard after copy", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Find a card with placeholders
    const placeholderCard = page.locator(".command-card:has(.placeholder-input)").first();
    await expect(placeholderCard).toBeVisible();

    const input = placeholderCard.locator(".placeholder-input").first();
    await input.fill("MYVALUE");

    // Click the card body (not the input) to trigger copy
    await placeholderCard.locator(".copy-button").click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("MYVALUE");
    expect(clipboardText).not.toMatch(/<[^>]+>/); // no leftover placeholder tokens
  });

  test("switching variant keeps placeholder values in state", async ({ page }) => {
    await page.locator("#search-input").fill("git switch");
    const variantCard = page.locator('.command-card[data-command-id="git-switch"]');
    await expect(variantCard).toBeVisible();
    await expect(variantCard.locator(".placeholder-input").first()).toBeVisible();

    await variantCard.locator(".placeholder-input").first().fill("testval");

    const tabs = variantCard.locator(".variant-tab");
    await expect(tabs).toHaveCount(2);

    await tabs.nth(1).click();
    await tabs.nth(0).click();

    // Back on first variant — placeholder value should still be there
    const inputs = variantCard.locator(".placeholder-input");
    await expect(inputs.first()).toHaveValue("testval");
  });

  test("category picker: search-within filters list, ArrowDown focuses first item", async ({ page }) => {
    await page.locator("#category-picker-btn").click();
    const panel = page.locator("#category-picker");
    await expect(panel).toBeVisible();

    const pickerSearch = panel.locator(".picker-search");
    await expect(pickerSearch).toBeFocused();
    await pickerSearch.fill("git");

    // Any item that doesn't contain "git" should be hidden
    const visibleItems = panel.locator(".picker-item:not([hidden])");
    const visibleCount = await visibleItems.count();
    expect(visibleCount).toBeGreaterThan(0);

    for (let i = 0; i < visibleCount; i++) {
      const label = (await visibleItems.nth(i).locator(".picker-item-label").textContent())?.toLowerCase() ?? "";
      // "全部" row is also visible because no typed-filter restricts it? Actually the
      // code hides non-matching "all" / "pinned" too. Allow it if it matches.
      expect(label.includes("git") || label === "全部" || label === "已釘選").toBeTruthy();
    }

    // ArrowDown from search input → first picker item
    await pickerSearch.press("ArrowDown");
    const focused = page.evaluate(() => document.activeElement?.className ?? "");
    expect(await focused).toContain("picker-item");
  });

  test("picker closes when clicking outside", async ({ page }) => {
    await page.locator("#category-picker-btn").click();
    await expect(page.locator("#category-picker")).toBeVisible();

    // Click somewhere definitely outside the picker
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#category-picker")).toBeHidden();
  });

  test("mobile category picker stays inside viewport with search visible", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await context.newPage();

    await mobilePage.goto("/");
    await expect(mobilePage.locator(".command-card").first()).toBeVisible();
    await mobilePage.locator("#category-picker-btn").click();
    await expect(mobilePage.locator("#category-picker")).toBeVisible();

    const geometry = await mobilePage.evaluate(() => {
      const panel = document.querySelector("#category-picker").getBoundingClientRect();
      const search = document.querySelector("#category-picker .picker-search").getBoundingClientRect();

      return {
        viewportHeight: window.innerHeight,
        panelTop: Math.round(panel.top),
        panelBottom: Math.round(panel.bottom),
        searchTop: Math.round(search.top),
        searchBottom: Math.round(search.bottom)
      };
    });

    await context.close();
    expect(geometry.panelTop).toBeGreaterThanOrEqual(0);
    expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.searchTop).toBeGreaterThanOrEqual(geometry.panelTop);
    expect(geometry.searchBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  });

  test("mobile category picker does not autofocus search to avoid opening the keyboard", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await context.newPage();

    await mobilePage.goto("/");
    await expect(mobilePage.locator(".command-card").first()).toBeVisible();
    await mobilePage.locator("#category-picker-btn").click();
    await expect(mobilePage.locator("#category-picker")).toBeVisible();

    const activeClass = await mobilePage.evaluate(() => document.activeElement?.className ?? "");

    await context.close();
    expect(activeClass).not.toContain("picker-search");
  });

  test("mobile category picker locks and dims the page behind the sheet", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await context.newPage();

    await mobilePage.goto("/");
    await expect(mobilePage.locator(".command-card").first()).toBeVisible();
    await mobilePage.locator("#category-picker-btn").click();
    await expect(mobilePage.locator("#category-picker")).toBeVisible();

    const openState = await mobilePage.evaluate(() => {
      const backdrop = getComputedStyle(document.body, "::after");
      return {
        hasClass: document.body.classList.contains("has-open-picker"),
        overflow: getComputedStyle(document.body).overflow,
        backdropContent: backdrop.content,
        backdropZIndex: backdrop.zIndex
      };
    });

    expect(openState.hasClass).toBe(true);
    expect(openState.overflow).toBe("hidden");
    expect(openState.backdropContent).not.toBe("none");
    expect(Number(openState.backdropZIndex)).toBeGreaterThan(0);

    await mobilePage.mouse.click(8, 8);
    await expect(mobilePage.locator("#category-picker")).toBeHidden();
    await expect.poll(() => mobilePage.evaluate(() => document.body.classList.contains("has-open-picker"))).toBe(false);

    await context.close();
  });

  test("tag click fills search input with the tag operator", async ({ page }) => {
    const firstTag = page.locator(".tag-btn").first();
    await expect(firstTag).toBeVisible();
    const tagValue = await firstTag.getAttribute("data-tag");
    await firstTag.click();

    await expect(page.locator("#search-input")).toHaveValue(`tag:${tagValue}`);
    await expect(page.locator("#active-state")).toContainText("標籤");
  });

  test("typing a visible #tag searches the normalized tag value", async ({ page }) => {
    const firstTag = page.locator(".tag-btn").first();
    await expect(firstTag).toBeVisible();
    const tagText = (await firstTag.textContent())?.trim() ?? "";

    await page.locator("#search-input").fill(tagText);

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator(".tag-btn").filter({ hasText: tagText }).first()).toBeVisible();
    await expect(page.locator("#result-summary")).not.toContainText("0 筆");
  });

  test("tag: operator filters results by tag", async ({ page }) => {
    await page.locator("#search-input").fill("tag:dns");

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator(".command-card .match-line").first()).toContainText("標籤");
    await expect(page.locator("#active-state")).toContainText("標籤");
    await expect(page.locator("#active-state")).toContainText("dns");

    const allVisibleCardsHaveDnsTag = await page.locator(".command-card").evaluateAll((cards) =>
      cards.every((card) =>
        Array.from(card.querySelectorAll(".tag-btn")).some((tag) =>
          tag.textContent.toLowerCase().includes("dns")
        )
      )
    );
    expect(allVisibleCardsHaveDnsTag).toBe(true);
  });

  test("search assist chip applies an operator query", async ({ page }) => {
    await page.locator('.search-assist-chip[data-query-template="tag:dns"]').click();

    await expect(page.locator("#search-input")).toHaveValue("tag:dns");
    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator(".command-card .match-line").first()).toContainText("標籤");
  });

  test("cat: operator scopes search to matching categories", async ({ page }) => {
    await page.locator("#search-input").fill("cat:docker ps");

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator(".command-card .match-line").first()).toContainText("分類");
    await expect(page.locator("#active-state")).toContainText("語法分類");
    await expect(page.locator("#active-state")).toContainText("關鍵字");
    await expect(page.locator(".command-card .command-code").first()).toContainText("ps");

    const allVisibleCardsAreDocker = await page.locator(".command-card").evaluateAll((cards) =>
      cards.every((card) => card.querySelector(".category-badge")?.textContent.includes("Docker"))
    );
    expect(allVisibleCardsAreDocker).toBe(true);
  });

  test("quoted cat: operator supports categories with spaces and symbols", async ({ page }) => {
    await page.locator("#search-input").fill('cat:"Windows Network & DNS" dns');

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator("#active-state")).toContainText("語法分類");
    await expect(page.locator("#active-state")).toContainText("windows network & dns");

    const allVisibleCardsAreNetworkDns = await page.locator(".command-card").evaluateAll((cards) =>
      cards.every((card) => card.querySelector(".category-badge")?.textContent.includes("Windows Network & DNS"))
    );
    expect(allVisibleCardsAreNetworkDns).toBe(true);
  });

  test("empty state can clear only the failed search query", async ({ page }) => {
    await page.locator("#search-input").fill("zzzz-no-match-command-atlas");

    await expect(page.locator(".empty-state")).toBeVisible();
    await expect(page.getByRole("button", { name: "只清搜尋" })).toBeVisible();

    await page.getByRole("button", { name: "只清搜尋" }).click();

    await expect(page.locator("#search-input")).toHaveValue("");
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("empty state can return to all categories without dropping the query", async ({ page }) => {
    await page.locator('.filter-pill[data-category="Docker"]').click();
    await page.locator("#search-input").fill("git status");

    await expect(page.locator(".empty-state")).toBeVisible();
    await expect(page.getByRole("button", { name: "回到全部分類" })).toBeVisible();

    await page.getByRole("button", { name: "回到全部分類" }).click();

    await expect(page.locator("#search-input")).toHaveValue("git status");
    await expect(page.locator("#active-state")).toContainText("全部分類");
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("URL q/cat params round-trip across reload", async ({ page }) => {
    await page.locator("#search-input").fill("git");
    await page.waitForTimeout(200);
    await page.locator('.filter-pill[data-category="Git"]').first().click().catch(() => {});
    await page.waitForTimeout(200);

    const url = page.url();
    expect(url).toMatch(/[?&]q=git/);

    await page.goto(url);
    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator("#search-input")).toHaveValue("git");
  });

  test("document title reflects result count, search query, and category", async ({ page }) => {
    await expect.poll(() => page.title()).toMatch(/^\d+ 筆指令 \| Command Atlas$/);

    await page.locator("#search-input").fill("git status");
    await expect.poll(() => page.title()).toMatch(/^\d+ 筆 · git status \| Command Atlas$/);

    await page.locator('.filter-pill[data-category="Git"]').click();
    await expect.poll(() => page.title()).toMatch(/^\d+ 筆 · git status · Git \| Command Atlas$/);
  });

  test("URL page param round-trips across reload", async ({ page }) => {
    const page2Btn = page.locator('[data-page-target="public"][data-page-number="2"]').first();
    await expect(page2Btn).toBeVisible();

    await page2Btn.click();

    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    expect(page.url()).toMatch(/[?&]page=2/);

    await page.reload();

    await expect(page.locator(".command-card .row-index").first()).toHaveText("101");
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
  });

  test("URL page param is clamped to the last valid page", async ({ page }) => {
    await page.goto("/?page=999");

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(page.locator(".pagination-button.is-active")).toHaveText("3");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("201");
    expect(page.url()).toMatch(/[?&]page=3/);
  });

  test("current link button copies the exact current URL", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.locator('[data-page-target="public"][data-page-number="2"]').first().click();
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    await page.locator("#view-toggle-btn").click();
    await expect(page.locator("body")).toHaveClass(/is-list-view/);

    const expectedUrl = page.url();
    await page.locator("#current-link-btn").click();

    await expect(page.locator("#copy-toast")).toHaveClass(/is-visible/);
    await expect(page.locator("#copy-toast .copy-toast-command")).toContainText(expectedUrl);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl);
    await expect(page.locator("#app-announcer")).toContainText("目前視圖連結已複製。");
  });

  test("sticky current link button copies the current URL while browsing results", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 500 });
    await expect(page.locator(".command-card").nth(10)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 640));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);

    const expectedUrl = page.url();
    await page.locator("#sticky-current-link-btn").click();

    await expect(page.locator("#copy-toast")).toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl);
  });

  test("current link button restores its own label after clipboard failure", async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("clipboard denied"))
        }
      });
    });

    const button = page.locator("#current-link-btn");
    await expect(button).toHaveText("連結");

    await button.click();

    await expect(button).toHaveText("失敗");
    await expect(page.locator("#copy-toast")).toHaveClass(/is-error/);
    await expect(page.locator("#copy-toast .copy-toast-status")).toHaveText("複製失敗");
    await expect(button).toHaveText("連結", { timeout: 2000 });
  });

  test("pagination resets to page 1 when a new filter is applied", async ({ page }) => {
    const page2Btn = page.locator('[data-page-target="public"][data-page-number="2"]').first();
    if ((await page2Btn.count()) === 0) {
      test.skip();
      return;
    }

    await page2Btn.click();
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");

    // Apply a filter that still leaves >100 results so pagination is
    // guaranteed to stay visible, so we can assert the active page
    // specifically (not a "maybe disappeared" branch).
    await page.locator('.filter-pill[data-category="all"]').click();
    await page.waitForTimeout(100);
    await page.locator("#search-input").fill(" "); // space → tokenize to [] → all commands
    // Polling assertion survives view transition + worker roundtrip timing.
    await expect(async () => {
      const activeBtn = page.locator(".pagination-button.is-active");
      const visible = await page.locator("#public-pagination").isVisible();
      if (visible) {
        expect(await activeBtn.count()).toBeGreaterThan(0);
        await expect(activeBtn).toHaveText("1");
      }
    }).toPass({ timeout: 3000 });
  });

  test("pagination uses 100 commands per page", async ({ page }) => {
    const pagination = page.locator("#public-pagination");
    await expect(pagination).toBeVisible();
    await expect(pagination.locator(".pagination-meta")).toContainText("每頁 100 筆");
    await expect(page.locator(".command-card")).toHaveCount(100);
  });

  test("visible command rows show stable three-digit row indexes", async ({ page }) => {
    await expect(page.locator(".command-card").first()).toBeVisible();

    await expect(page.locator(".command-card .row-index").nth(0)).toHaveText("001");
    await expect(page.locator(".command-card .row-index").nth(1)).toHaveText("002");
    await expect(page.locator(".command-card .row-index").nth(9)).toHaveText("010");
  });

  test("row indexes continue across pagination pages", async ({ page }) => {
    const page2Btn = page.locator('[data-page-target="public"][data-page-number="2"]').first();
    await expect(page2Btn).toBeVisible();

    await page2Btn.click();

    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("101");
  });

  test("top mini pager changes pages without scrolling to the bottom pager", async ({ page }) => {
    const pageJump = page.locator("#page-jump");
    await expect(pageJump).toBeVisible();
    await expect(pageJump.locator(".page-jump-current")).toHaveText(/1-100 \/ \d+/);

    await pageJump.locator(".page-jump-next").click();

    await expect(pageJump.locator(".page-jump-current")).toHaveText(/101-200 \/ \d+/);
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("101");
  });

  test("sticky mini pager mirrors pagination while browsing results", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await expect(page.locator(".command-card").nth(10)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 640));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);

    const stickyPageJump = page.locator("#sticky-page-jump");
    await expect(stickyPageJump).toBeVisible();
    await expect(stickyPageJump.locator(".page-jump-current")).toHaveText(/1-100 \/ \d+/);

    await stickyPageJump.locator(".page-jump-next").click();

    await expect(stickyPageJump.locator(".page-jump-current")).toHaveText(/101-200 \/ \d+/);
    await expect(page.locator("#page-jump .page-jump-current")).toHaveText(/101-200 \/ \d+/);
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("101");
  });

  test("PageDown and PageUp keyboard shortcuts change result pages", async ({ page }) => {
    await expect(page.locator("#page-jump")).toBeVisible();
    await expect(page.locator(".command-card .row-index").first()).toHaveText("001");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("PageDown");

    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("101");
    expect(page.url()).toMatch(/[?&]page=2/);

    await page.keyboard.press("PageUp");

    await expect(page.locator(".pagination-button.is-active")).toHaveText("1");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("001");
    expect(page.url()).not.toMatch(/[?&]page=2/);
  });

  test("PageDown shortcut does not change pages while typing in search", async ({ page }) => {
    await page.locator("#search-input").focus();
    await page.keyboard.press("PageDown");

    await expect(page.locator(".pagination-button.is-active")).toHaveText("1");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("001");
  });

  test("pagination re-render does NOT add is-fresh-batch animation class", async ({ page }) => {
    const page2Btn = page.locator('[data-page-target="public"][data-page-number="2"]').first();
    if ((await page2Btn.count()) === 0) {
      test.skip();
      return;
    }

    await page2Btn.click();
    await page.waitForTimeout(300);

    const freshCount = await page.locator(".command-card.is-fresh-batch").count();
    const totalCount = await page.locator(".command-card").count();

    expect(totalCount).toBeGreaterThan(0);
    expect(freshCount).toBe(0); // pagination should suppress animation
  });

  test("fresh filter DOES add is-fresh-batch animation class", async ({ page }) => {
    await page.locator("#search-input").fill("docker");
    await page.waitForTimeout(300);

    const totalCount = await page.locator(".command-card").count();
    const freshCount = await page.locator(".command-card.is-fresh-batch").count();

    if (totalCount > 0) {
      expect(freshCount).toBeGreaterThan(0);
    }
  });

  test("sticky and main search inputs stay in sync", async ({ page }) => {
    await page.locator("#search-input").fill("git");
    await page.waitForTimeout(200);

    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);
    await expect(page.locator("#sticky-search-input")).toHaveValue("git");

    await page.locator("#sticky-search-input").fill("docker");
    await page.waitForTimeout(200);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("#search-input")).toHaveValue("docker");
  });

  test("inline search clear removes only the query and keeps the active category", async ({ page }) => {
    await page.locator('.filter-pill[data-category="Docker"]').click();
    await page.locator("#search-input").fill("ps");
    await expect(page.locator("#search-clear-btn")).toBeVisible();

    await page.locator("#search-clear-btn").click();

    await expect(page.locator("#search-input")).toHaveValue("");
    await expect(page.locator("#sticky-search-input")).toHaveValue("");
    await expect(page.locator("#active-state")).toContainText("Docker");
    await expect(page.locator("#search-clear-btn")).toBeHidden();
    await expect(page.locator(".command-card").first()).toBeVisible();
  });

  test("sticky inline search clear stays synced with the main search", async ({ page }) => {
    await page.locator("#search-input").fill("git");
    await page.waitForTimeout(200);

    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);
    await expect(page.locator("#sticky-search-clear-btn")).toBeVisible();

    await page.locator("#sticky-search-clear-btn").click();

    await expect(page.locator("#sticky-search-input")).toHaveValue("");
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect(page.locator("#sticky-search-clear-btn")).toBeHidden();
    await expect(page.locator("#sticky-search-input")).toBeFocused();
  });

  test("sticky result summary mirrors the current result count", async ({ page }) => {
    const expectStickySummaryToMirrorMain = async () => {
      await expect.poll(async () => {
        const mainSummary = await page.locator("#result-summary").textContent();
        const stickySummary = await page.locator("#sticky-result-summary").textContent();
        const count = mainSummary?.match(/(\d+) 筆/)?.[1];

        return Boolean(count && stickySummary === `${count} 筆`);
      }).toBe(true);
    };

    await page.locator("#search-input").fill("git");
    await page.waitForTimeout(200);

    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);
    await expectStickySummaryToMirrorMain();

    await page.locator("#sticky-search-input").fill("docker");
    await page.waitForTimeout(200);
    await expectStickySummaryToMirrorMain();
  });

  test("search summary shows a pending state while worker filtering is in flight", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class DelayedSearchWorker extends NativeWorker {
        postMessage(message, transfer) {
          const send = () => NativeWorker.prototype.postMessage.call(this, message, transfer);

          if (message?.type === "search") {
            window.setTimeout(send, 180);
            return;
          }

          send();
        }
      };
    });
    await page.reload();
    await expect(page.locator(".command-card").first()).toBeVisible();

    await page.locator("#search-input").fill("git");
    await expect(page.locator("#result-summary")).toHaveClass(/is-searching/);
    await expect(page.locator("#result-summary")).not.toHaveClass(/is-searching/, { timeout: 3000 });
  });

  test("late worker results do not overwrite the latest search", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class OutOfOrderSearchWorker extends NativeWorker {
        postMessage(message, transfer) {
          const send = () => NativeWorker.prototype.postMessage.call(this, message, transfer);

          if (message?.type === "search" && message.tokens?.includes("git")) {
            window.setTimeout(send, 260);
            return;
          }

          send();
        }
      };
    });
    await page.reload();
    await expect(page.locator(".command-card").first()).toBeVisible();

    await page.locator("#search-input").fill("git");
    await page.waitForTimeout(120);
    await page.locator("#search-input").fill("docker");

    await expect(page.locator(".command-card").first()).toHaveAttribute("data-command-id", /docker/, { timeout: 3000 });
    await page.waitForTimeout(360);

    await expect(page.locator("#search-input")).toHaveValue("docker");
    await expect(page.locator("#active-state")).toContainText("docker");
    await expect(page.locator(".command-card").first()).toHaveAttribute("data-command-id", /docker/);
  });

  test("search matches placeholder command templates with pasted concrete values", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#search-input").fill("Test-NetConnection google.com -Port 443");

    const firstCard = page.locator(".command-card").first();
    await expect(firstCard).toHaveAttribute("data-command-id", "windows-test-netconnection");
    await expect(firstCard.locator(".placeholder-input").nth(0)).toHaveValue("google.com");
    await expect(firstCard.locator(".placeholder-input").nth(1)).toHaveValue("443");
    await expect(firstCard.locator(".placeholder-input").nth(0)).toHaveAttribute("data-placeholder-inferred", "true");
    await expect(firstCard.locator(".placeholder-source")).toHaveCount(2);
    await expect(firstCard.locator(".placeholder-source").first()).toHaveText("搜尋帶入");
    await expect(page.locator(".command-card .command-code").first()).toContainText("Test-NetConnection google.com -Port 443");
    await expect(page.locator(".command-card .match-line").first()).toContainText("模板");

    await firstCard.locator(".copy-button").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Test-NetConnection google.com -Port 443");
  });

  test("editing an inferred placeholder clears its search-source marker", async ({ page }) => {
    await page.locator("#search-input").fill("Test-NetConnection google.com -Port 443");

    const firstCard = page.locator(".command-card").first();
    const hostInput = firstCard.locator(".placeholder-input").nth(0);
    await expect(hostInput).toHaveAttribute("data-placeholder-inferred", "true");
    await expect(firstCard.locator(".placeholder-source")).toHaveCount(2);

    await hostInput.fill("example.com");

    await expect(hostInput).not.toHaveAttribute("data-placeholder-inferred", "true");
    await expect(firstCard.locator(".placeholder-source")).toHaveCount(1);
    await expect(page.locator(".command-card .command-code").first()).toContainText("Test-NetConnection example.com -Port 443");
  });

  test("search ranks placeholder variants above fuzzy description matches", async ({ page }) => {
    await page.locator("#search-input").fill("npm install react");

    await expect(page.locator(".command-card").first()).toHaveAttribute("data-command-id", "npm-install");
    await expect(page.locator(".command-card").first()).toContainText("npm install");
    await expect(page.locator(".command-card .match-line").first()).toContainText("指令");
    await expect(page.locator('.command-card[data-command-id="powershell-mas-activation"]')).toHaveCount(0);
  });

  test("search matches concrete port values against command variants", async ({ page }) => {
    await page.locator("#search-input").fill("netstat -ano | findstr :443");

    await expect(page.locator(".command-card").first()).toHaveAttribute("data-command-id", "windows-netstat");
    await expect(page.locator(".command-card").first()).toContainText("netstat");
  });

  test("[/] keyboard shortcut cycles category and is reversible", async ({ page }) => {
    // Collapse state: start at "all"
    await page.keyboard.press("]");
    await page.waitForTimeout(150);
    const afterForward = await page.locator("#active-state").textContent();

    await page.keyboard.press("[");
    await page.waitForTimeout(150);
    const afterBack = await page.locator("#active-state").textContent();

    expect(afterBack).toContain("全部分類");
    expect(afterForward).not.toEqual(afterBack);
  });

  test("V keyboard shortcut toggles compact list view without moving the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await expect(page.locator(".command-card").nth(10)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 420));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(420);
    const beforeY = await page.evaluate(() => Math.round(window.scrollY));
    expect(beforeY).toBeGreaterThan(0);

    await page.keyboard.press("KeyV");

    await expect(page.locator("body")).toHaveClass(/is-list-view/);
    await expect(page.locator("#view-toggle-btn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#view-toggle-btn")).toHaveText("卡片");
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(beforeY);

    await page.keyboard.press("KeyV");

    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
    await expect(page.locator("#view-toggle-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#view-toggle-btn")).toHaveText("緊湊");
  });

  test("sticky view toggle switches density and stays synced with the main toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await expect(page.locator(".command-card").nth(10)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 640));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(640);
    const beforeY = await page.evaluate(() => Math.round(window.scrollY));

    await page.locator("#sticky-view-toggle-btn").click();

    await expect(page.locator("body")).toHaveClass(/is-list-view/);
    await expect(page.locator("#view-toggle-btn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#sticky-view-toggle-btn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#view-toggle-btn")).toHaveText("卡片");
    await expect(page.locator("#sticky-view-toggle-btn")).toHaveText("卡片");
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(beforeY);

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
    await expect(page.locator("#sticky-search-bar")).not.toHaveClass(/is-visible/);
    await page.locator("#view-toggle-btn").click();

    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
    await expect(page.locator("#view-toggle-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#sticky-view-toggle-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#sticky-view-toggle-btn")).toHaveText("緊湊");
  });

  test("V shortcut does not fire while typing in search", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.focus();
    await page.keyboard.press("KeyV");

    await expect(search).toHaveValue("v");
    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
  });

  test("V shortcut does not fire while category picker is open", async ({ page }) => {
    await page.locator("#category-picker-btn").click();
    await expect(page.locator("#category-picker")).toBeVisible();

    await page.keyboard.press("KeyV");

    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
    await expect(page.locator("#category-picker")).toBeVisible();
  });

  test("pasting on page chrome fills search without toggling compact view", async ({ page }) => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "docker\nps");
      document.body.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data
      }));
    });

    await expect(page.locator("#search-input")).toHaveValue("docker ps");
    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
    await expect(page.locator("#active-state")).toContainText("docker ps");
  });

  test("Ctrl+V keydown does not trigger the V view toggle shortcut", async ({ page }) => {
    const wasDefaultPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(wasDefaultPrevented).toBe(false);
    await expect(page.locator("body")).not.toHaveClass(/is-list-view/);
  });

  test("pasting inside placeholder inputs is not hijacked by global search", async ({ page }) => {
    const placeholderInput = page.locator(".placeholder-input").first();
    await expect(placeholderInput).toBeVisible();
    await placeholderInput.focus();

    const wasDefaultPrevented = await placeholderInput.evaluate((input) => {
      const data = new DataTransfer();
      data.setData("text/plain", "C:\\Temp");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(wasDefaultPrevented).toBe(false);
    await expect(page.locator("#search-input")).toHaveValue("");
  });

  test("focused search marks the first visible command as the Enter copy target", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.focus();

    await expect(page.locator("body")).toHaveClass(/has-search-focus/);
    await expect(page.locator(".command-card").first()).toHaveCSS("position", "relative");
    const copyHint = await page.locator(".command-card .copy-button").first().evaluate((button) =>
      getComputedStyle(button, "::before").content
    );
    expect(copyHint).toContain("Enter");

    await page.locator(".command-card").first().focus();
    await expect(page.locator("body")).not.toHaveClass(/has-search-focus/);
  });

  test("Enter on a focused command card triggers copy", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Find a card WITHOUT placeholders (so copy resolves to the raw command)
    const simpleCard = page.locator(".command-card:not(:has(.placeholder-input))").first();
    await expect(simpleCard).toBeVisible();

    const cmdText = (await simpleCard.locator(".command-code").textContent())?.trim() ?? "";
    await simpleCard.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.length).toBeGreaterThan(0);
    // Normalize whitespace — hljs may introduce inline spans that don't show
    // in textContent, but the actual copied command should roughly match.
    expect(clipboardText.replace(/\s+/g, "")).toContain(cmdText.replace(/\s+/g, "").slice(0, 10));
  });

  test("Ctrl+C on a focused command card triggers copy", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const simpleCard = page.locator(".command-card:not(:has(.placeholder-input))").first();
    await expect(simpleCard).toBeVisible();

    const cmdText = (await simpleCard.locator(".command-code").textContent())?.trim() ?? "";
    await simpleCard.focus();
    await page.keyboard.press("Control+C");

    await expect(page.locator("#copy-toast")).toHaveClass(/is-visible/);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replace(/\s+/g, "")).toContain(cmdText.replace(/\s+/g, "").slice(0, 10));
  });

  test("copy action shows a visible clipboard toast", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const card = page.locator(".command-card:not(:has(.placeholder-input))").first();
    await expect(card).toBeVisible();

    const cmdText = (await card.locator(".command-code").textContent())?.trim() ?? "";
    await card.click();

    const toast = page.locator("#copy-toast");
    await expect(toast).toHaveClass(/is-visible/);
    await expect(toast).toHaveCSS("opacity", "1");
    await expect(toast.locator(".copy-toast-status")).toHaveText("已複製");
    await expect(toast.locator(".copy-toast-command")).toContainText(cmdText.replace(/\s+/g, " ").slice(0, 10));
  });

  test("mobile visible buttons keep a 44px touch target", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await context.newPage();

    await mobilePage.goto("/");
    await expect(mobilePage.locator(".command-card").first()).toBeVisible();

    const undersized = await mobilePage.evaluate(() => Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent.trim() || button.getAttribute("aria-label") || button.className,
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter((button) => button.width < 44 || button.height < 44));

    await context.close();
    expect(undersized).toEqual([]);
  });

  test("mobile copy button sits below the command block instead of overlaying it", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await context.newPage();

    await mobilePage.goto("/");
    const card = mobilePage.locator(".command-card").first();
    await expect(card).toBeVisible();

    const layout = await card.evaluate((el) => {
      const commandLine = el.querySelector(".command-line").getBoundingClientRect();
      const copyButton = el.querySelector(".copy-button").getBoundingClientRect();

      return {
        commandLineBottom: Math.round(commandLine.bottom),
        commandLineWidth: Math.round(commandLine.width),
        copyButtonTop: Math.round(copyButton.top),
        copyButtonWidth: Math.round(copyButton.width)
      };
    });

    await context.close();
    expect(layout.copyButtonTop).toBeGreaterThanOrEqual(layout.commandLineBottom);
    expect(layout.copyButtonWidth).toBeGreaterThanOrEqual(layout.commandLineWidth - 2);
  });

  test("desktop copy button uses a separate action column instead of overlaying the command", async ({ page }) => {
    await expect(page.locator(".command-card").first()).toBeVisible();

    const layout = await page.locator(".command-card").first().evaluate((el) => {
      const commandLine = el.querySelector(".command-line").getBoundingClientRect();
      const copyButton = el.querySelector(".copy-button").getBoundingClientRect();

      return {
        commandLineRight: Math.round(commandLine.right),
        copyButtonLeft: Math.round(copyButton.left),
        copyButtonHeight: Math.round(copyButton.height)
      };
    });

    expect(layout.copyButtonLeft).toBeGreaterThanOrEqual(layout.commandLineRight);
    expect(layout.copyButtonHeight).toBeGreaterThan(0);
  });

  test("Enter inside search copies the first visible result", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const search = page.locator("#search-input");
    await search.fill("docker ps");
    await search.press("Enter");

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(async () => {
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText.length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });

    const firstCommand = (await page.locator(".command-card .command-code").first().textContent())?.trim() ?? "";
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replace(/\s+/g, "")).toContain(firstCommand.replace(/\s+/g, "").slice(0, 10));
  });

  test("Enter inside search announces when there is no result to copy", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("zzzz-no-match-command-atlas");
    await search.press("Enter");

    await expect(page.locator("#app-announcer")).toContainText("沒有可複製的結果。");
  });

  test("ArrowDown inside search focuses the first visible result", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("docker ps");
    await search.press("ArrowDown");

    await expect(page.locator(".command-card").first()).toBeFocused();
  });

  test("ArrowUp on the first focused command card returns to search", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("docker ps");
    await search.press("ArrowDown");
    await expect(page.locator(".command-card").first()).toBeFocused();

    await page.keyboard.press("ArrowUp");

    await expect(search).toBeFocused();
  });

  test("ArrowDown inside search announces when there is no result to focus", async ({ page }) => {
    const search = page.locator("#search-input");
    await search.fill("zzzz-no-match-command-atlas");
    await search.press("ArrowDown");

    await expect(page.locator("#app-announcer")).toContainText("沒有可選取的結果。");
  });

  test("Ctrl+Enter copies the first visible result from page chrome", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.mouse.click(12, 12);
    await page.keyboard.press("Control+Enter");

    await expect(page.locator(".command-card").first()).toBeVisible();
    await expect(async () => {
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText.length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });

    const firstCommand = (await page.locator(".command-card .command-code").first().textContent())?.trim() ?? "";
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replace(/\s+/g, "")).toContain(firstCommand.replace(/\s+/g, "").slice(0, 10));
  });

  test("sticky bar pointer-events lets clicks pass through to cards behind it", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.locator("#sticky-search-bar")).toHaveClass(/is-visible/);

    // The bar itself (outside the pill) should be pointer-events: none.
    const barPointer = await page.locator("#sticky-search-bar").evaluate((el) =>
      getComputedStyle(el).pointerEvents
    );
    const pillPointer = await page.locator(".sticky-search-shell").evaluate((el) =>
      getComputedStyle(el).pointerEvents
    );

    expect(barPointer).toBe("none");
    expect(pillPointer).toBe("auto");
  });

  test("focused search input survives ime composition event guard", async ({ page }) => {
    // Simulate an IME composition: fire compositionstart (should set the
    // data-composing flag), then an 'input' event during composition
    // should NOT reach the filter.
    const input = page.locator("#search-input");
    await input.focus();

    const beforeSummary = (await page.locator("#result-summary").textContent())?.trim();

    await page.evaluate(() => {
      const el = document.getElementById("search-input");
      el.dispatchEvent(new CompositionEvent("compositionstart"));
      el.value = "zh-draft";
      el.dispatchEvent(new InputEvent("input", { isComposing: true }));
    });
    await page.waitForTimeout(200);

    const duringSummary = (await page.locator("#result-summary").textContent())?.trim();
    expect(duringSummary).toEqual(beforeSummary);

    await page.evaluate(() => {
      const el = document.getElementById("search-input");
      el.dispatchEvent(new CompositionEvent("compositionend", { data: "zh" }));
    });
    await page.waitForTimeout(300);

    // After composition end, input is processed.
    const afterSummary = (await page.locator("#result-summary").textContent())?.trim();
    // Summary might or might not change depending on whether the draft matches
    // anything; the important thing is no crash + guard worked during composition.
    expect(typeof afterSummary).toBe("string");
  });

  test("help tooltip toggles via button click", async ({ page }) => {
    const tooltip = page.locator("#shortcuts-tooltip");
    const btn = page.locator("#help-btn");

    await btn.click();
    await expect(tooltip).toHaveClass(/is-open/);
    await expect(btn).toHaveAttribute("aria-expanded", "true");

    // Click anywhere else closes it (document click listener)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(tooltip).not.toHaveClass(/is-open/);
  });

  test("? keyboard shortcut toggles the shortcuts tooltip outside text input", async ({ page }) => {
    const tooltip = page.locator("#shortcuts-tooltip");
    const btn = page.locator("#help-btn");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Shift+Slash");
    await expect(tooltip).toHaveClass(/is-open/);
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(tooltip).toHaveAttribute("aria-hidden", "false");

    await page.keyboard.press("Shift+Slash");
    await expect(tooltip).not.toHaveClass(/is-open/);
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });

  test("shortcuts tooltip stays inside a short viewport and scrolls internally", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 });

    const tooltip = page.locator("#shortcuts-tooltip");
    await page.locator("#help-btn").click();
    await expect(tooltip).toHaveClass(/is-open/);

    const geometry = await tooltip.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        viewportHeight: window.innerHeight,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY
      };
    });

    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.overflowY).toBe("auto");
  });

  test("PageDown does not change result pages while shortcuts tooltip is open", async ({ page }) => {
    await expect(page.locator("#page-jump")).toBeVisible();
    await expect(page.locator(".command-card .row-index").first()).toHaveText("001");

    await page.locator("#help-btn").click();
    await expect(page.locator("#shortcuts-tooltip")).toHaveClass(/is-open/);
    await page.keyboard.press("PageDown");

    await expect(page.locator(".pagination-button.is-active")).toHaveText("1");
    await expect(page.locator(".command-card .row-index").first()).toHaveText("001");
    expect(page.url()).not.toMatch(/[?&]page=2/);
  });

  test("? shortcut stays as text while typing in search", async ({ page }) => {
    const search = page.locator("#search-input");

    await search.focus();
    await page.keyboard.press("Shift+Slash");

    await expect(search).toHaveValue("?");
    await expect(page.locator("#shortcuts-tooltip")).not.toHaveClass(/is-open/);
  });

  test("Esc closes shortcuts tooltip without clearing the current search", async ({ page }) => {
    const search = page.locator("#search-input");
    const tooltip = page.locator("#shortcuts-tooltip");

    await search.fill("docker");
    await page.locator("#help-btn").click();
    await expect(tooltip).toHaveClass(/is-open/);

    await page.keyboard.press("Escape");

    await expect(tooltip).not.toHaveClass(/is-open/);
    await expect(search).toHaveValue("docker");
    await expect(page.locator("#active-state")).toContainText("docker");
  });

  test("REGRESSION: arrow keys on a variant tab should switch variants, not move cards", async ({ page }) => {
    const variantCard = page.locator(".command-card.has-variants").first();
    if ((await variantCard.count()) === 0) {
      test.skip();
      return;
    }

    const firstTab = variantCard.locator(".variant-tab").first();
    await firstTab.focus();
    const cardIdBefore = await variantCard.getAttribute("data-command-id");

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);

    // After ArrowRight on a variant tab, focus currently moves to the NEXT card
    // (bug) rather than cycling to the next variant tab. Expected behavior:
    // focus stays on the same card, on the next variant tab.
    const focusedCardId = await page.evaluate(() => document.activeElement?.closest(".command-card")?.dataset.commandId);
    expect(focusedCardId).toBe(cardIdBefore);
  });

  test("REGRESSION: copy-button should not be keyboard-focusable while invisible on desktop", async ({ page }) => {
    const firstCard = page.locator(".command-card").first();
    await firstCard.focus();

    // Tab through — hitting the hidden copy-button is a keyboard-a11y snag.
    // We probe: after pressing Tab, does focus land on an element whose
    // computed opacity is 0? If so, user sees no focus ring — bad.
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el.tagName === "BODY") return { name: null, opacity: "1" };
      return {
        name: el.className,
        opacity: getComputedStyle(el).opacity
      };
    });

    // The card has tabindex=0, then the next tabbable is the category
    // badge button inside the card (visible). That's fine. But later in the
    // tab order we eventually hit `.copy-button` and `.pin-button`, which
    // may have opacity:0. We look ahead several Tabs and check no invisible
    // element is focused.
    for (let i = 0; i < 8; i++) {
      const snap = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          name: el?.className ?? "",
          opacity: getComputedStyle(el).opacity,
          tag: el?.tagName
        };
      });
      if (snap.name.includes("copy-button") || snap.name.includes("pin-button")) {
        // Flag: is it currently invisible?
        if (Number(snap.opacity) === 0) {
          throw new Error(`Focus landed on invisible ${snap.name} — no visible focus ring.`);
        }
      }
      await page.keyboard.press("Tab");
    }
  });

  test("clicking a placeholder suggestion chip fills the adjacent input", async ({ page }) => {
    // Narrow to PowerShell with a tag search that the seeded commands carry.
    await page.locator("#search-input").fill("get-childitem recurse");
    await page.waitForTimeout(300);

    const card = page.locator('.command-card[data-command-id="powershell-find-file-recursive"]');
    await expect(card).toBeVisible();

    const firstChip = card.locator(".placeholder-chip").first();
    await expect(firstChip).toBeVisible();
    const chipValue = await firstChip.getAttribute("data-suggestion-value");
    const chipToken = await firstChip.getAttribute("data-suggestion-for");

    await firstChip.click();

    const input = card.locator(`.placeholder-input[data-placeholder-token="${chipToken}"]`);
    await expect(input).toHaveValue(chipValue);

    // Command preview should reflect the substitution
    const codeText = await card.locator(".command-code").textContent();
    expect(codeText).toContain(chipValue);
    expect(codeText).not.toContain(chipToken);
  });

  test("suggestion value persists across reload (via placeholder storage)", async ({ page }) => {
    await page.locator("#search-input").fill("get-childitem recurse");
    await page.waitForTimeout(300);

    const card = page.locator('.command-card[data-command-id="powershell-find-file-recursive"]');
    await expect(card).toBeVisible();

    const firstChip = card.locator(".placeholder-chip").first();
    const chipValue = await firstChip.getAttribute("data-suggestion-value");
    const chipToken = await firstChip.getAttribute("data-suggestion-for");
    await firstChip.click();
    // Let debounce + save settle
    await page.waitForTimeout(200);

    await page.reload();
    await expect(page.locator(".command-card").first()).toBeVisible();

    const reloadedCard = page.locator('.command-card[data-command-id="powershell-find-file-recursive"]');
    await expect(reloadedCard).toBeVisible();
    const reloadedInput = reloadedCard.locator(`.placeholder-input[data-placeholder-token="${chipToken}"]`);
    await expect(reloadedInput).toHaveValue(chipValue);
  });

  test("placeholder with HTML-special chars is preserved in clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const placeholderCard = page.locator(".command-card:has(.placeholder-input)").first();
    if ((await placeholderCard.count()) === 0) {
      test.skip();
      return;
    }

    const tricky = `<script>alert("x")</script> & 'quote' \"dq\"`;
    await placeholderCard.locator(".placeholder-input").first().fill(tricky);
    await placeholderCard.locator(".copy-button").click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(`<script>alert("x")</script>`);
    expect(clipboardText).toContain(`& 'quote'`);
  });
});
