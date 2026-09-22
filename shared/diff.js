/**
 * Word-level inline diff for short messages.
 * Returns parts of { type: "same" | "add" | "del", text }.
 */

function tokenize(text) {
  return String(text || "").match(/\s+|[^\s]+/g) || [];
}

export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  if (n * m > 50000) {
    return [{ type: "add", text: String(after || "") }];
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, text) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return parts;
}

export function diffHtml(before, after, escapeHtml) {
  return diffWords(before, after)
    .map((part) => {
      const text = escapeHtml(part.text);
      if (part.type === "del") return `<del>${text}</del>`;
      if (part.type === "add") return `<mark class="diff-add">${text}</mark>`;
      return text;
    })
    .join("");
}
