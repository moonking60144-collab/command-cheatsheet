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

export function normalizeCommandShapeToken(token) {
  return String(token ?? "")
    .toLowerCase()
    .replace(/^[|&;:]+|[|&;:=]+$/g, "")
    .trim();
}

export function getCommandTemplateTokens(command) {
  if (!/<[^>]+>/.test(command)) {
    return [];
  }

  return String(command)
    .replace(/<[^>]+>/g, " ")
    .replace(/[|&;]/g, " ")
    .split(/\s+/)
    .map(normalizeCommandShapeToken)
    .filter((token) => token && /[a-z0-9/-]/i.test(token));
}

function getPhraseScore(item, tokens) {
  const phrase = tokens.join(" ");

  if (phrase.length < 3) {
    return 0;
  }

  if (item.commandLower === phrase) {
    return 30;
  }

  if (item.commandLower.startsWith(phrase)) {
    return 24;
  }

  if (item.commandLower.includes(phrase)) {
    return 18;
  }

  if (item.searchBlob.includes(phrase)) {
    return 10;
  }

  return 0;
}

function getTemplateScore(item, tokens) {
  if (!item.commandTemplateTokenSets?.length || !tokens.length) {
    return 0;
  }

  const queryTokens = tokens
    .map(normalizeCommandShapeToken)
    .filter(Boolean);
  let bestScore = 0;

  for (const templateTokens of item.commandTemplateTokenSets) {
    if (!templateTokens.length) {
      continue;
    }

    const matchedCount = templateTokens.filter((templateToken) =>
      queryTokens.some((queryToken) =>
        queryToken === templateToken ||
        queryToken.startsWith(`${templateToken}:`) ||
        queryToken.startsWith(`${templateToken}=`)
      )
    ).length;

    if (matchedCount !== templateTokens.length) {
      continue;
    }

    const concreteValueCount = Math.max(0, queryTokens.length - matchedCount);
    const score = 18 + matchedCount * 4 - concreteValueCount * 0.25;
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

export function parseSearchTokenPlan(tokens) {
  const searchTokens = [];
  const tagFilters = [];
  const categoryFilters = [];

  tokens.forEach((token) => {
    const match = token.match(/^(tag|tags|cat|category):(.+)$/);

    if (!match) {
      searchTokens.push(token);
      return;
    }

    const value = normalizeCommandShapeToken(match[2]).replace(/^#+/, "");
    if (!value) {
      return;
    }

    if (match[1] === "tag" || match[1] === "tags") {
      tagFilters.push(value);
    } else {
      categoryFilters.push(value);
    }
  });

  return { searchTokens, tagFilters, categoryFilters };
}

function matchesTokenPlan(item, tagFilters, categoryFilters) {
  return tagFilters.every((filter) => item.tagsLower.some((tag) => tag.includes(filter))) &&
    categoryFilters.every((filter) => item.categoryLower.includes(filter));
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
  const phraseScore = getPhraseScore(item, tokens);
  const templateScore = getTemplateScore(item, tokens);
  const canIgnoreConcreteValues = templateScore > 0;

  score += phraseScore + templateScore;

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
    }

    if (canIgnoreConcreteValues) {
      continue;
    }

    return { score: -1, fuzzy: false };
  }

  return { score, fuzzy };
}

export function filterCommands(commands, tokens, activeCategory, pinnedSet) {
  const { searchTokens, tagFilters, categoryFilters } = parseSearchTokenPlan(tokens);

  return commands
    .filter((item) => {
      if (activeCategory === "pinned") return pinnedSet.has(item.id);
      return (activeCategory === "all" || item.category === activeCategory) &&
        matchesTokenPlan(item, tagFilters, categoryFilters);
    })
    .map((item) => {
      const { score, fuzzy } = getMatchScore(item, searchTokens);
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
