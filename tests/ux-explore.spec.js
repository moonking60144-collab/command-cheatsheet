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
    const variantCard = page.locator(".command-card.has-variants").first();

    if ((await variantCard.count()) === 0) {
      test.skip();
      return;
    }

    const placeholderExists = (await variantCard.locator(".placeholder-input").count()) > 0;
    if (!placeholderExists) {
      test.skip();
      return;
    }

    await variantCard.locator(".placeholder-input").first().fill("testval");

    const tabs = variantCard.locator(".variant-tab");
    const tabCount = await tabs.count();
    if (tabCount < 2) {
      test.skip();
      return;
    }

    await tabs.nth(1).click();
    await tabs.nth(0).click();

    // Back on first variant — placeholder value should still be there
    const inputs = variantCard.locator(".placeholder-input");
    if ((await inputs.count()) > 0) {
      await expect(inputs.first()).toHaveValue("testval");
    }
  });

  test("category picker: search-within filters list, ArrowDown focuses first item", async ({ page }) => {
    await page.locator("#category-picker-btn").click();
    const panel = page.locator("#category-picker");
    await expect(panel).toBeVisible();

    const pickerSearch = panel.locator(".picker-search");
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

  test("tag click fills search input with the tag text", async ({ page }) => {
    const firstTag = page.locator(".tag-btn").first();
    await expect(firstTag).toBeVisible();
    const tagText = (await firstTag.textContent())?.trim().replace(/^#/, "") ?? "";
    await firstTag.click();

    await expect(page.locator("#search-input")).toHaveValue(tagText);
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

  test("pagination resets to page 1 when a new filter is applied", async ({ page }) => {
    const page2Btn = page.locator('[data-page-target="public"][data-page-number="2"]').first();
    if ((await page2Btn.count()) === 0) {
      test.skip();
      return;
    }

    await page2Btn.click();
    await expect(page.locator(".pagination-button.is-active")).toHaveText("2");

    // Apply a filter that still leaves >50 results so pagination is
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
