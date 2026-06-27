// UI chrome: sticky search bar / scroll-top button observer, clipboard
// copy feedback, focus management for the active search input.

import { ui, announce } from "./state.js";

export function setupUtilityChromeObserver() {
  if (!ui.hero) {
    return;
  }

  const updateChromeVisibility = () => {
    const showChrome = window.scrollY > ui.hero.offsetHeight + 24;

    if (ui.scrollTopButton) {
      ui.scrollTopButton.classList.toggle("is-visible", showChrome);
      ui.scrollTopButton.setAttribute("aria-hidden", String(!showChrome));
    }

    if (ui.stickySearchBar) {
      ui.stickySearchBar.classList.toggle("is-visible", showChrome);
      ui.stickySearchBar.setAttribute("aria-hidden", String(!showChrome));
    }
  };

  updateChromeVisibility();
  window.addEventListener("scroll", updateChromeVisibility, { passive: true });
  window.addEventListener("resize", updateChromeVisibility, { passive: true });
}

export async function copyToClipboard(text, button, card = null) {
  try {
    await navigator.clipboard.writeText(text);

    const originalLabel = button.textContent;
    button.textContent = "已複製";
    button.classList.add("is-copied");
    card?.classList.add("is-copied");

    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove("is-copied");
      card?.classList.remove("is-copied");
    }, 1400);

    announce("指令已複製到剪貼簿。");
  } catch (error) {
    console.error(error);
    button.textContent = "失敗";
    window.setTimeout(() => {
      button.textContent = "複製";
    }, 1400);
    announce("複製失敗。");
  }
}

export function getActiveSearchInput() {
  const stickyVisible = ui.stickySearchBar?.classList.contains("is-visible");
  return stickyVisible && ui.stickySearchInput ? ui.stickySearchInput : ui.searchInput;
}

export function focusActiveSearch({ select = true } = {}) {
  const target = getActiveSearchInput();

  if (!target) {
    return;
  }

  target.focus({ preventScroll: true });

  if (select) {
    target.select?.();
  }
}

export function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || element.isContentEditable;
}
