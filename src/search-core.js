// search-core.js — shared scoring and filter logic.
// Imported by app.js (main thread) and search.worker.js (module worker).

export function fuzzyScore(query, target) {
  let qi = 0, consecutive = 0, lastTi = -1, firstTi = -1, score = 0;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) {
      if (firstTi === -1) firstTi = ti;
      consecutive = lastTi === ti - 1 ? consecutive + 1 : 0;
      score += 1 + consecutive;
      lastTi = ti;
      qi++;
    }
  }

  if (qi < query.length) return -1;
  if (lastTi - firstTi + 1 > query.length * 5) return -1;

  return score;
}

// Returns { score, fuzzy }:
//   score < 0   → does not match
//   fuzzy true  → matched only via fuzzyScore (no substring hit)
// The fuzzy flag is carried through filterCommands so the UI layer can
// render the "近似匹配" hint without re-computing fuzzyScore.
export function getMatchScore(item, tokens) {
  if (!tokens.length) {
    return { score: 1, fuzzy: false };
  }

  let score = 0;
  let fuzzy = false;

  for (const token of tokens) {
    if (item.commandLower.startsWith(token)) {
      score += 12;
      continue;
    }

    if (item.commandLower.includes(token)) {
      score += 8;
      continue;
    }

    if (item.tagsLower.some((tag) => tag === token)) {
      score += 7;
      continue;
    }

    if (item.categoryLower.includes(token)) {
      score += 5;
      continue;
    }

    if (item.searchBlob.includes(token)) {
      score += 3;
      continue;
    }

    if (token.length >= 3) {
      if (fuzzyScore(token, item.commandLower) >= 0) {
        score += 2;
        fuzzy = true;
        continue;
      }

      if (fuzzyScore(token, item.descriptionLower) >= 0) {
        score += 1;
        fuzzy = true;
        continue;
      }
    }

    return { score: -1, fuzzy: false };
  }

  return { score, fuzzy };
}

export function filterCommands(commands, tokens, activeCategory, pinnedSet) {
  return commands
    .filter((item) => {
      if (activeCategory === "pinned") return pinnedSet.has(item.id);
      return activeCategory === "all" || item.category === activeCategory;
    })
    .map((item) => {
      const { score, fuzzy } = getMatchScore(item, tokens);
      return { item, score, fuzzy };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      const lp = pinnedSet.has(left.item.id);
      const rp = pinnedSet.has(right.item.id);
      if (lp !== rp) return lp ? -1 : 1;
      return right.score - left.score || left.item.category.localeCompare(right.item.category, "zh-Hant");
    })
    .map((entry) => ({ ...entry.item, _fuzzy: entry.fuzzy }));
}
