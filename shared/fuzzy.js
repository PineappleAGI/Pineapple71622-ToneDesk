/**
 * Lightweight fuzzy match for phrase search.
 * Scores by substring, token overlap, and simple edit distance.
 */

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Synonym / intent hints so queries like "say no" or "apologize" hit useful phrases.
 */
const INTENT_HINTS = {
  "follow up": ["circle back", "following up", "radar", "previous message"],
  "say no": ["not in a position", "concern would be", "aligned", "interesting perspective"],
  pushback: ["interesting perspective", "concern would be", "aligned", "explore this further"],
  apologize: ["difficult decision", "unfortunately", "transparent", "patience"],
  delay: ["look into this", "thorough answer", "until", "get back"],
  thanks: ["appreciate", "grateful", "thank you", "invaluable"],
  request: ["would it be possible", "when you get a chance", "grateful if", "earliest convenience"],
  document: ["document this", "summarize", "aligned", "misunderstood", "unless i hear"],
  closer: ["looking forward", "hesitate", "convenience", "consideration", "continued support"],
  opener: ["finds you well", "great week", "reaching out", "follow up", "all is well"]
};

function expandQuery(query) {
  const n = normalize(query);
  const extras = [];
  for (const [key, hints] of Object.entries(INTENT_HINTS)) {
    if (n.includes(key) || key.includes(n) || n.split(" ").some((t) => key.includes(t) && t.length > 2)) {
      extras.push(...hints);
    }
  }
  return { normalized: n, extras };
}

/**
 * @param {string} query
 * @param {Array<{ phrase: string, categoryId: string, categoryLabel: string }>} corpus
 * @param {number} limit
 */
export function fuzzySearch(query, corpus, limit = 5) {
  const q = String(query || "").trim();
  if (!q) return [];

  const { normalized, extras } = expandQuery(q);
  const qTokens = tokens(normalized);
  if (!normalized) return [];

  const scored = corpus.map((item) => {
    const phrase = item.phrase;
    const pNorm = normalize(phrase);
    const pTokens = tokens(pNorm);
    let score = 0;

    if (pNorm === normalized) score += 100;
    if (pNorm.includes(normalized)) score += 50;
    if (normalized.includes(pNorm) && pNorm.length > 8) score += 30;

    for (const qt of qTokens) {
      if (qt.length < 2) continue;
      if (pNorm.includes(qt)) score += 12;
      else {
        const best = Math.min(...pTokens.map((pt) => editDistance(qt, pt)));
        if (best <= 1 && qt.length > 3) score += 6;
        else if (best <= 2 && qt.length > 4) score += 3;
      }
    }

    for (const hint of extras) {
      if (pNorm.includes(normalize(hint))) score += 18;
    }

    return { ...item, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.phrase.length - b.phrase.length)
    .slice(0, limit);
}
