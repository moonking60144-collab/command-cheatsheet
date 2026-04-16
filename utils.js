// Pure utility helpers used across the app. No DOM or app-state dependencies.
// Split out of app.js so the main module can stay focused on wiring, and so
// these functions can be imported by any future module that needs them.

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function escapeCssSelector(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Single-slot caches for the two highlight pattern compilers. Every render of
// the result section calls both with the same tokens, and the tokens only
// change when the user types — so a one-entry cache avoids rebuilding the
// regex on every render / pagination click.
let _htmlHighlightPatternCache = { key: null, pattern: null };
let _textHighlightPatternCache = { key: null, pattern: null };

export function compileHighlightPattern(tokens) {
  if (!tokens.length) {
    return null;
  }

  const key = tokens.join("\x00");
  if (_htmlHighlightPatternCache.key === key) {
    return _htmlHighlightPatternCache.pattern;
  }

  const uniqueTokens = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  if (!uniqueTokens.length) {
    _htmlHighlightPatternCache = { key, pattern: null };
    return null;
  }

  const pattern = uniqueTokens
    .map((token) => escapeRegex(escapeHtml(token)))
    .join("|");

  const regex = pattern ? new RegExp(`(${pattern})`, "gi") : null;
  _htmlHighlightPatternCache = { key, pattern: regex };
  return regex;
}

export function compileTextHighlightPattern(tokens) {
  if (!tokens.length) {
    return null;
  }

  const key = tokens.join("\x00");
  if (_textHighlightPatternCache.key === key) {
    return _textHighlightPatternCache.pattern;
  }

  const uniqueTokens = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  if (!uniqueTokens.length) {
    _textHighlightPatternCache = { key, pattern: null };
    return null;
  }

  const pattern = uniqueTokens
    .map((token) => escapeRegex(token))
    .join("|");

  const regex = pattern ? new RegExp(`(${pattern})`, "gi") : null;
  _textHighlightPatternCache = { key, pattern: regex };
  return regex;
}

export function highlightText(text, tokensOrPattern) {
  const escaped = escapeHtml(text);

  if (!tokensOrPattern) {
    return escaped;
  }

  if (tokensOrPattern instanceof RegExp) {
    tokensOrPattern.lastIndex = 0;
    return escaped.replace(tokensOrPattern, "<mark>$1</mark>");
  }

  const pattern = compileHighlightPattern(tokensOrPattern);
  return pattern ? escaped.replace(pattern, "<mark>$1</mark>") : escaped;
}

// Palette is frozen at module scope so we don't re-build the 15-entry object
// literal on every card render. Dynamic accents (categories not in the
// palette) go through a cache since categories don't change at runtime.
const CATEGORY_ACCENT_PALETTE = {
  Git: { color: "#7ee787", soft: "rgba(126, 231, 135, 0.14)", border: "rgba(126, 231, 135, 0.34)" },
  Docker: { color: "#79b8ff", soft: "rgba(121, 184, 255, 0.14)", border: "rgba(121, 184, 255, 0.34)" },
  GitHub: { color: "#a78bfa", soft: "rgba(167, 139, 250, 0.14)", border: "rgba(167, 139, 250, 0.34)" },
  Python: { color: "#f2cc60", soft: "rgba(242, 204, 96, 0.14)", border: "rgba(242, 204, 96, 0.34)" },
  PowerShell: { color: "#9a8cff", soft: "rgba(154, 140, 255, 0.14)", border: "rgba(154, 140, 255, 0.34)" },
  WSL: { color: "#66d1c1", soft: "rgba(102, 209, 193, 0.14)", border: "rgba(102, 209, 193, 0.34)" },
  Bash: { color: "#93d977", soft: "rgba(147, 217, 119, 0.14)", border: "rgba(147, 217, 119, 0.34)" },
  "Windows Network & DNS": { color: "#5bb0ff", soft: "rgba(91, 176, 255, 0.14)", border: "rgba(91, 176, 255, 0.34)" },
  "Windows Port & Firewall": { color: "#ff9d5c", soft: "rgba(255, 157, 92, 0.14)", border: "rgba(255, 157, 92, 0.34)" },
  "Windows Process & Service": { color: "#7cc8a5", soft: "rgba(124, 200, 165, 0.14)", border: "rgba(124, 200, 165, 0.34)" },
  "Windows Event Log": { color: "#c792ea", soft: "rgba(199, 146, 234, 0.14)", border: "rgba(199, 146, 234, 0.34)" },
  "Windows Repair": { color: "#f28b82", soft: "rgba(242, 139, 130, 0.14)", border: "rgba(242, 139, 130, 0.34)" },
  "Windows Shortcut": { color: "#d1b36a", soft: "rgba(209, 179, 106, 0.14)", border: "rgba(209, 179, 106, 0.34)" },
  "Windows File & Directory": { color: "#8fb0ff", soft: "rgba(143, 176, 255, 0.14)", border: "rgba(143, 176, 255, 0.34)" },
  npm: { color: "#cb3837", soft: "rgba(203, 56, 55, 0.14)", border: "rgba(203, 56, 55, 0.34)" }
};
const categoryAccentCache = new Map();

export function getCategoryAccent(category) {
  const known = CATEGORY_ACCENT_PALETTE[category];
  if (known) return known;

  const cached = categoryAccentCache.get(category);
  if (cached) return cached;

  const hue = hashToHue(category);
  const accent = {
    color: `hsl(${hue}, 65%, 72%)`,
    soft: `hsla(${hue}, 65%, 60%, 0.14)`,
    border: `hsla(${hue}, 65%, 60%, 0.34)`
  };
  categoryAccentCache.set(category, accent);
  return accent;
}

export function hashToHue(str) {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }

  return Math.abs(hash) % 360;
}
