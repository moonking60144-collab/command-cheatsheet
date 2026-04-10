// search-core.js — shared between app.js and search.worker.js

function fuzzyScore(query, target) {
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

function getMatchScore(item, tokens) {
  if (!tokens.length) {
    return 1;
  }

  let score = 0;

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
        continue;
      }

      if (fuzzyScore(token, item.descriptionLower) >= 0) {
        score += 1;
        continue;
      }
    }

    return -1;
  }

  return score;
}

function filterCommands(commands, tokens, activeCategory, pinnedSet) {
  return commands
    .filter((item) => {
      if (activeCategory === "pinned") return pinnedSet.has(item.id);
      return activeCategory === "all" || item.category === activeCategory;
    })
    .map((item) => ({ item, score: getMatchScore(item, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      const lp = pinnedSet.has(left.item.id);
      const rp = pinnedSet.has(right.item.id);
      if (lp !== rp) return lp ? -1 : 1;
      return right.score - left.score || left.item.category.localeCompare(right.item.category, "zh-Hant");
    })
    .map((entry) => entry.item);
}
