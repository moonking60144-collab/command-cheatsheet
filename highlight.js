// Syntax-highlighting subsystem. Owns everything related to rendering the
// command code block: hljs lazy-loading, language detection, the hljs output
// cache, mark-wrapping for search tokens. Does not touch app state — the
// caller passes in a callback to run after the highlight libraries finish
// loading (so app.js can re-highlight existing DOM with the current query).

import { escapeHtml } from "./utils.js";

let highlightLoadPromise = null;
let onLibrariesReady = null;

export function getCommandHighlightLanguage(item) {
  if (!item?.category) {
    return "bash";
  }

  if (item.category === "PowerShell") {
    return "powershell";
  }

  if (item.category.startsWith("Windows")) {
    return "dos";
  }

  return "bash";
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lazy-src="${src}"]`);

    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.lazySrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function ensureHighlightLibraries() {
  // Check the LAST-loaded language pack rather than bash (which ships with
  // the core). If the chain partially failed last time we reset
  // highlightLoadPromise, but window.hljs.getLanguage("bash") would still
  // return truthy — leading callers to believe the full chain succeeded.
  if (window.hljs?.getLanguage?.("powershell") && window.hljs?.getLanguage?.("dos")) {
    return Promise.resolve();
  }

  if (highlightLoadPromise) {
    return highlightLoadPromise;
  }

  // Keep the pre-catch chain so awaiters still see rejection; the separate
  // side-effect catch only resets module state and logs, it does not
  // swallow the rejection for the returned promise.
  const chain = loadScript("./assets/highlight.min.js")
    .then(() => Promise.all([
      loadScript("./assets/highlight-powershell.min.js"),
      loadScript("./assets/highlight-dos.min.js")
    ]))
    .then(() => {
      if (typeof onLibrariesReady === "function") {
        onLibrariesReady();
      }
    });

  chain.catch((error) => {
    console.warn("Failed to load highlight libraries", error);
    highlightLoadPromise = null;
  });

  highlightLoadPromise = chain;
  return chain;
}

export function scheduleHighlightLoad(onReady) {
  if (typeof onReady === "function") {
    onLibrariesReady = onReady;
  }

  const run = () => { ensureHighlightLibraries(); };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    window.setTimeout(run, 400);
  }
}

export function renderCommandCode(codeElement, commandText, language, highlightPattern = null) {
  if (!codeElement) {
    return;
  }

  codeElement.dataset.commandLanguage = language;
  codeElement.dataset.commandText = String(commandText ?? "");
  codeElement.className = "command-code";
  codeElement.innerHTML = getCommandCodeHtml(commandText, language);

  if (window.hljs) {
    codeElement.classList.add("hljs");
    if (language) {
      codeElement.classList.add(`language-${language}`);
    }
  }

  if (highlightPattern) {
    applySearchMarksToCode(codeElement, highlightPattern);
  }
}

// Cache hljs output by (language, text). hljs.highlight is the single most
// expensive step in the render loop — the same command text obviously
// produces the same HTML every call, so each unique (language, text) pair
// only needs to be computed once. Only cache when hljs is actually loaded;
// the fallback branch is cheap enough to skip caching and avoid stale
// entries before the real hljs lands.
const hljsHtmlCache = new Map();

function getCommandCodeHtml(commandText, language) {
  const text = String(commandText ?? "");
  const hljs = window.hljs;

  if (!hljs?.highlight) {
    return escapeHtml(text);
  }

  const cacheKey = `${language}|${text}`;
  const cached = hljsHtmlCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let html;
  try {
    if (language && hljs.getLanguage?.(language)) {
      html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } else if (hljs.highlightAuto) {
      html = hljs.highlightAuto(text, ["bash", "dos", "powershell"]).value;
    } else {
      html = escapeHtml(text);
    }
  } catch (error) {
    console.warn("command syntax highlight failed", error);
    html = escapeHtml(text);
  }

  hljsHtmlCache.set(cacheKey, html);
  return html;
}

function applySearchMarksToCode(container, highlightPattern) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (node.parentElement?.closest("mark")) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    const text = node.nodeValue ?? "";
    highlightPattern.lastIndex = 0;

    if (!highlightPattern.test(text)) {
      return;
    }

    highlightPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = highlightPattern.exec(text))) {
      if (match.index > lastIndex) {
        fragment.append(text.slice(lastIndex, match.index));
      }

      const mark = document.createElement("mark");
      mark.textContent = match[0];
      fragment.append(mark);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.append(text.slice(lastIndex));
    }

    node.parentNode?.replaceChild(fragment, node);
  });
}
