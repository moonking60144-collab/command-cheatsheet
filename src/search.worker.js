// Search module worker — scoring logic imported as ESM.
import { filterCommands } from "./search-core.js";

let cachedPublicCommands = [];

self.onmessage = function (event) {
  const { type, seq, publicCommands, tokens, activeCategory, pinned } = event.data;

  if (type === "init") {
    cachedPublicCommands = publicCommands;
    return;
  }

  if (type === "search") {
    const pinnedSet = new Set(pinned);
    const filteredPublic = filterCommands(cachedPublicCommands, tokens, activeCategory, pinnedSet);
    self.postMessage({ seq, filteredPublic });
  }
};
