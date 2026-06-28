// Document-level keyboard routing: /, ?, Ctrl+K, Ctrl+Enter, Esc, [, ], V, Enter, PageUp/PageDown.

import { clearFilters, cycleCategory } from "./filters.js";
import { hasOpenCategoryPicker, closeAllCategoryPickers } from "./picker.js";
import { handleScopedInputEscape } from "./placeholders.js";
import { focusActiveSearch, isTextEntryElement } from "./chrome.js";

function shouldFocusMainSearchOnEnter(target) {
  if (hasOpenCategoryPicker()) {
    return false;
  }

  if (!(target instanceof Element)) {
    return true;
  }

  if (isTextEntryElement(target)) {
    return false;
  }

  if (target.closest(".command-card, .placeholder-fields, .category-picker, .help-wrap")) {
    return false;
  }

  if (target.closest("button, a, summary, [role='button'], [role='dialog']")) {
    return false;
  }

  return true;
}

export function setupGlobalKeyboard({ closeShortcutsTooltip, toggleShortcutsTooltip, isShortcutsTooltipOpen }) {
  document.addEventListener("keydown", (event) => {
    // Skip all custom shortcut handling while an IME composition is active
    // (Bopomofo, Pinyin, Kana, etc.) so we don't disturb the IME state.
    if (event.isComposing) {
      return;
    }

    const activeElement = document.activeElement;
    const isTyping = isTextEntryElement(activeElement);
    const shortcutsOpen = isShortcutsTooltipOpen?.() ?? false;

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !isTyping) {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("commandatlas:copy-first-result"));
      return;
    }

    if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !isTyping) {
      event.preventDefault();
      focusActiveSearch();
    }

    if (event.key === "?" && !isTyping && !hasOpenCategoryPicker()) {
      event.preventDefault();
      toggleShortcutsTooltip?.();
      return;
    }

    if (event.key === "Enter" && shouldFocusMainSearchOnEnter(event.target)) {
      event.preventDefault();
      focusActiveSearch();
      return;
    }

    if (!isTyping && !shortcutsOpen && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      cycleCategory(event.key === "[" ? -1 : 1);
      return;
    }

    if (!isTyping && !shortcutsOpen && !hasOpenCategoryPicker() && (event.key === "PageUp" || event.key === "PageDown")) {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("commandatlas:change-page", {
        detail: { direction: event.key === "PageDown" ? 1 : -1 }
      }));
      return;
    }

    if (!isTyping && !shortcutsOpen && !event.ctrlKey && !event.metaKey && !event.altKey && !hasOpenCategoryPicker() && event.key.toLowerCase() === "v") {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("commandatlas:toggle-view-mode"));
      return;
    }

    if (event.key === "Escape") {
      if (handleScopedInputEscape(activeElement)) {
        event.preventDefault();
        return;
      }

      if (hasOpenCategoryPicker()) {
        closeAllCategoryPickers();
        focusActiveSearch({ select: false });
        return;
      }

      if (closeShortcutsTooltip?.()) {
        event.preventDefault();
        return;
      }

      clearFilters({ preserveScroll: true });
      focusActiveSearch({ select: false });
    }
  });
}
