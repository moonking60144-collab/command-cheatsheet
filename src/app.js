// Boot & event wiring. Every feature module is imported here and
// connected via explicit callbacks — no module reaches back into app.js.

import { scheduleHighlightLoad } from "./highlight.js";
import {
  state,
  ui,
  DATA_URL,
  bindUiRefs,
  restoreState,
  saveState,
  fetchJson,
  normalizeCommands,
  getCategories,
  getCommandCounts,
  updateMetrics,
  updateViewModeUI,
  getUrlState
} from "./state.js";
import {
  registerWorkerHandlers,
  getSearchWorker,
  syncWorkerData
} from "./workers.js";
import {
  applyFilters,
  applyFiltersAnimated,
  applyCategoryFilter,
  clearFilters,
  filterByTag,
  renderFilters,
  updateFilterPillActive,
  syncFilterIndicator,
  updateFilterBarOverflow,
  updateQuery,
  syncSearchInputs,
  handleWorkerResult,
  handleWorkerFallback,
  restoreStateFromUrl
} from "./filters.js";
import {
  renderError,
  upgradeAllCodeBlocks
} from "./cards.js";
import {
  restorePinned,
  prunePinnedIds,
  togglePin
} from "./pins.js";
import {
  restorePlaceholders,
  syncCardPlaceholderValues,
  updateCommandPreview,
  buildResolvedCommand,
  switchCardVariant
} from "./placeholders.js";
import {
  getCategoryPickerPairs,
  getCategoryPickerButton,
  openCategoryPicker,
  closeCategoryPicker,
  closeAllCategoryPickers,
  handleOutsideCategoryPickerClick,
  positionPicker,
  invalidatePickerLayoutCache,
  clearPickerPanels
} from "./picker.js";
import {
  setupUtilityChromeObserver,
  copyToClipboard
} from "./chrome.js";
import { setupGlobalKeyboard } from "./keyboard.js";

init();

async function init() {
  bindUiRefs();
  bindEvents();
  restoreState();
  syncSearchInputs();
  restorePinned();
  restorePlaceholders();

  registerWorkerHandlers({
    onResult: handleWorkerResult,
    onWorkerUnavailableFallback: handleWorkerFallback
  });

  // Start fetching search.worker.js in parallel with commands.json so the
  // worker script is usually already loaded by the time we need it for
  // subsequent filters. The first filter still runs on the main thread
  // (see filters._runFilters) so first paint does not depend on this.
  getSearchWorker();

  try {
    const publicPayload = await fetchJson(DATA_URL, "公開指令資料");
    state.publicCommands = normalizeCommands(publicPayload);

    rebuildCommandState();
    registerServiceWorker();
    scheduleHighlightLoad(upgradeAllCodeBlocks);
  } catch (error) {
    console.error(error);
    renderError(error);
  }
}

function rebuildCommandState() {
  state.commands = [...state.publicCommands];
  prunePinnedIds();
  state.categories = getCategories(state.commands);
  state.commandCounts = getCommandCounts();

  if (state.activeCategory === "pinned" && state.pinned.size === 0) {
    state.activeCategory = "all";
  } else if (state.activeCategory !== "all" && state.activeCategory !== "pinned" && !state.categories.includes(state.activeCategory)) {
    state.activeCategory = "all";
  }

  saveState();
  invalidatePickerLayoutCache();
  clearPickerPanels();
  updateMetrics();
  renderFilters();
  updateViewModeUI();
  syncWorkerData();
  applyFilters();
}

function bindEvents() {
  [ui.searchInput, ui.stickySearchInput].forEach((input) => {
    if (!input) {
      return;
    }

    // IME composition guard: ignore input events while composing (Bopomofo,
    // Pinyin, Kana, etc.) so partial composition strings don't reach the
    // search filter and disturb the IME state mid-composition.
    input.addEventListener("compositionstart", () => {
      input.dataset.composing = "true";
    });

    input.addEventListener("compositionend", (event) => {
      delete input.dataset.composing;
      updateQuery(event.target.value, event.target);
    });

    input.addEventListener("input", (event) => {
      if (event.isComposing || input.dataset.composing === "true") {
        return;
      }
      updateQuery(event.target.value, event.target);
    });
  });

  [ui.clearButton, ui.stickyClearButton].forEach((button) => {
    button?.addEventListener("click", () => {
      clearFilters();
      (button === ui.stickyClearButton ? ui.stickySearchInput : ui.searchInput)
        ?.focus({ preventScroll: true });
    });
  });

  ui.viewToggleButton?.addEventListener("click", () => {
    state.viewMode = state.viewMode === "list" ? "cards" : "list";
    saveState();
    updateViewModeUI();
    applyFiltersAnimated();
  });

  ui.filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (!button) {
      return;
    }

    applyCategoryFilter(button.dataset.category);
  });

  getCategoryPickerPairs().forEach(({ button, panel }) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      if (panel.hidden) {
        openCategoryPicker(panel);
      } else {
        closeCategoryPicker(panel);
      }
    });

    panel.addEventListener("click", (event) => {
      const categoryButton = event.target.closest("[data-category]");

      if (!categoryButton) {
        return;
      }

      applyCategoryFilter(categoryButton.dataset.category);
      closeCategoryPicker(panel);
    });

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCategoryPicker(panel);
        getCategoryPickerButton(panel)?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(panel.querySelectorAll(".picker-item:not([hidden])"));
      const idx = items.indexOf(document.activeElement);

      if (idx === -1) {
        (event.key === "ArrowDown" ? items[0] : items[items.length - 1])?.focus();
      } else if (event.key === "ArrowUp" && idx === 0) {
        panel.querySelector(".picker-search")?.focus();
      } else {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[Math.max(0, Math.min(items.length - 1, idx + delta))]?.focus();
      }
    });
  });

  // pointerdown with capture covers both mouse and touch, fires before click
  window.addEventListener("pointerdown", (event) => {
    handleOutsideCategoryPickerClick(event.target);
  }, { capture: true });

  ui.scrollTopButton?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  [ui.results].forEach((container) => {
    container?.addEventListener("click", async (event) => {
      const categoryButton = event.target.closest("[data-category]");

      if (categoryButton) {
        applyCategoryFilter(categoryButton.dataset.category);
        closeAllCategoryPickers();
        return;
      }

      const pinButton = event.target.closest("[data-pin-id]");

      if (pinButton) {
        togglePin(pinButton.dataset.pinId, pinButton, {
          applyFilters,
          applyFiltersAnimated,
          updateFilterPillActive,
          syncFilterIndicator
        });
        return;
      }

      const tagButton = event.target.closest("[data-tag]");

      if (tagButton) {
        filterByTag(tagButton.dataset.tag);
        return;
      }

      const variantTab = event.target.closest("[data-variant-index]");

      if (variantTab) {
        event.stopPropagation();
        const variantCard = variantTab.closest(".command-card");
        const nextIndex = Number.parseInt(variantTab.dataset.variantIndex ?? "", 10);
        if (variantCard && Number.isFinite(nextIndex)) {
          switchCardVariant(variantCard, nextIndex);
        }
        return;
      }

      const suggestionChip = event.target.closest("[data-suggestion-for]");

      if (suggestionChip) {
        event.stopPropagation();
        const token = suggestionChip.dataset.suggestionFor;
        const value = suggestionChip.dataset.suggestionValue ?? "";
        const chipCard = suggestionChip.closest(".command-card");
        const input = Array.from(chipCard?.querySelectorAll("[data-placeholder-token]") ?? [])
          .find((el) => el.dataset.placeholderToken === token);
        if (input) {
          input.value = value;
          // Reuse the existing input listener: it calls
          // syncCardPlaceholderValues + updateCommandPreview.
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
        }
        return;
      }

      if (event.target.closest(".placeholder-fields") || event.target.closest("[data-placeholder-token]")) {
        return;
      }

      const card = event.target.closest(".command-card");

      if (!card) {
        return;
      }

      const copyButton = card.querySelector("[data-copy-command]");

      if (!copyButton) {
        return;
      }

      const command = buildResolvedCommand(card, copyButton.dataset.copyCommand);
      await copyToClipboard(command, copyButton, card);
    });

    container?.addEventListener("input", (event) => {
      const placeholderInput = event.target.closest("[data-placeholder-token]");

      if (!placeholderInput) {
        return;
      }

      const card = placeholderInput.closest(".command-card");
      syncCardPlaceholderValues(card);
      updateCommandPreview(card);
    });

    container?.addEventListener("keydown", (event) => {
      const card = event.target.closest(".command-card");

      if (!card) {
        return;
      }

      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        card.querySelector("[data-copy-command]")?.click();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        const activeTag = event.target.tagName;

        if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
          return;
        }

        // On a variant tab, horizontal arrows cycle through sibling tabs
        // within the same card instead of hopping to the next card. This
        // matches tablist convention (ARIA role="tablist").
        if (
          event.target.matches(".variant-tab") &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          event.stopPropagation();
          const tabs = Array.from(card.querySelectorAll(".variant-tab"));
          const tabIdx = tabs.indexOf(event.target);
          const tabDelta = event.key === "ArrowRight" ? 1 : -1;
          const next = tabs[(tabIdx + tabDelta + tabs.length) % tabs.length];
          next?.focus();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const cards = Array.from(container.querySelectorAll(".command-card"));
        const idx = cards.indexOf(card);
        const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        cards[idx + delta]?.focus();
      }
    });
  });

  [ui.publicPagination].forEach((container) => {
    container?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page-target][data-page-number]");

      if (!button) {
        return;
      }

      const target = button.dataset.pageTarget;
      const nextPage = Number.parseInt(button.dataset.pageNumber ?? "", 10);

      if (!Number.isFinite(nextPage)) {
        return;
      }

      if (target === "public") {
        state.pagination[target] = nextPage;
        // Pagination renders the same filter result, sliced differently —
        // skip card-in animation so the user doesn't see 50 cards fade
        // in every time they click a page number.
        applyFiltersAnimated({ fresh: false });
        ui.publicResultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const helpBtn = document.getElementById("help-btn");
  const shortcutsTooltip = document.getElementById("shortcuts-tooltip");

  helpBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = shortcutsTooltip.classList.toggle("is-open");
    helpBtn.setAttribute("aria-expanded", String(isOpen));
    shortcutsTooltip.setAttribute("aria-hidden", String(!isOpen));
  });

  document.addEventListener("click", () => closeShortcutsTooltip());

  function closeShortcutsTooltip() {
    shortcutsTooltip?.classList.remove("is-open");
    helpBtn?.setAttribute("aria-expanded", "false");
    shortcutsTooltip?.setAttribute("aria-hidden", "true");
  }

  setupGlobalKeyboard({ closeShortcutsTooltip });

  window.addEventListener("popstate", () => {
    restoreStateFromUrl(getUrlState());
  });

  window.addEventListener("resize", () => {
    updateFilterBarOverflow();
    getCategoryPickerPairs()
      .filter(({ panel }) => !panel.hidden)
      .forEach(({ panel }) => positionPicker(panel));
  }, { passive: true });

  ui.filterBar?.addEventListener("scroll", updateFilterBarOverflow, { passive: true });

  setupUtilityChromeObserver();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const register = () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.error("Service worker register failed", error);
    });
  };

  if (document.readyState === "complete") {
    register();
    return;
  }

  window.addEventListener("load", register, { once: true });
}
