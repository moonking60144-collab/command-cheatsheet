// Document-level keyboard routing: /, Ctrl+K, Esc, [, ], Enter.

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

  if (target.closest(".command-card, .placeholder-fields, .secure-form, .category-picker, .help-wrap")) {
    return false;
  }

  if (target.closest("button, a, summary, [role='button'], [role='dialog']")) {
    return false;
  }

  return true;
}

export function setupGlobalKeyboard({ closeShortcutsTooltip }) {
  document.addEventListener("keydown", (event) => {
    // Skip all custom shortcut handling while an IME composition is active
    // (Bopomofo, Pinyin, Kana, etc.) so we don't disturb the IME state.
    if (event.isComposing) {
      return;
    }

    const activeElement = document.activeElement;
    const isTyping = isTextEntryElement(activeElement);

    if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !isTyping) {
      event.preventDefault();
      focusActiveSearch();
    }

    if (event.key === "Enter" && shouldFocusMainSearchOnEnter(event.target)) {
      event.preventDefault();
      focusActiveSearch();
      return;
    }

    if (!isTyping && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      cycleCategory(event.key === "[" ? -1 : 1);
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

      closeShortcutsTooltip?.();
      clearFilters();
      focusActiveSearch({ select: false });
    }
  });
}
