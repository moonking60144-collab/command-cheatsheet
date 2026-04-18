// UI chrome: sticky search bar / scroll-top button observer, clipboard
// copy feedback, focus management for the active search input.

import { ui, announce } from "./state.js";

// Single IntersectionObserver drives both the scroll-to-top button and
// the sticky search bar: the moment the hero is no longer intersecting
// the top of the viewport (offset by 72px to trigger slightly before the
// hero's bottom edge crosses), both chrome elements come in together,
// and they leave together when the user scrolls back.
export function setupUtilityChromeObserver() {
  if (!ui.hero || typeof IntersectionObserver === "undefined") {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      const showChrome = !entry.isIntersecting;
      if (ui.scrollTopButton) {
        ui.scrollTopButton.classList.toggle("is-visible", showChrome);
        ui.scrollTopButton.setAttribute("aria-hidden", String(!showChrome));
      }
      if (ui.stickySearchBar) {
        ui.stickySearchBar.classList.toggle("is-visible", showChrome);
        ui.stickySearchBar.setAttribute("aria-hidden", String(!showChrome));
      }
    },
    { rootMargin: "-72px 0px 0px 0px", threshold: 0 }
  );

  observer.observe(ui.hero);
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
