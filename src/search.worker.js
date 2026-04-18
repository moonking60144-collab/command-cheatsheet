// Search module worker — scoring logic imported as ESM.
import { filterCommands } from "./search-core.js";

let cachedPublicCommands = [];
let cachedUnlockedCommands = [];

self.onmessage = function (event) {
  const { type, seq, publicCommands, unlockedCommands, tokens, activeCategory, pinned } = event.data;

  if (type === "init") {
    cachedPublicCommands = publicCommands;
    cachedUnlockedCommands = unlockedCommands;
    return;
  }

  if (type === "update-unlocked") {
    cachedUnlockedCommands = unlockedCommands;
    return;
  }

  if (type === "search") {
    const pinnedSet = new Set(pinned);
    const filteredPublic = filterCommands(cachedPublicCommands, tokens, activeCategory, pinnedSet);
    const filteredProtected = filterCommands(cachedUnlockedCommands, tokens, activeCategory, pinnedSet);
    self.postMessage({ seq, filteredPublic, filteredProtected });
  }
};
