/**
 * Template engine — maps Q1 + Q2 + Q3 to drafts with fill-in slots and tone variants.
 */

function uniqueSlots(list) {
  return [...new Set((list || []).filter(Boolean))];
}

export function getDraft(templates, q1, q2, q3) {
  const key = `${q1}:${q2}`;
  const entry = templates.drafts?.[key];
  if (!entry) {
    return {
      text: "Sorry — no template found for that combination. Try a different situation.",
      slots: [],
      key
    };
  }

  const audienceText = entry.audience?.[q3];
  const text = audienceText || entry.base;
  const slots = uniqueSlots([...(entry.slots || []), ...(entry.extraSlots || [])]);

  return { text, slots, key };
}

export function applySlotValues(text, values) {
  let out = String(text || "");
  for (const [slot, value] of Object.entries(values || {})) {
    if (!value) continue;
    const pattern = new RegExp(`\\[${escapeRegExp(slot)}\\]`, "gi");
    out = out.replace(pattern, value);
  }
  return out;
}

export function extractSlots(text) {
  const found = [];
  const re = /\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

export function applyVariant(text, variantId, templates) {
  if (!variantId || variantId === "balanced") return text;

  if (variantId === "shorter") {
    return shortenDraft(text);
  }

  const variant = templates.variants?.[variantId];
  if (!variant?.replacements) return text;

  let out = text;
  for (const [from, to] of variant.replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function shortenDraft(text) {
  const lines = String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 3) return text;

  const greeting = lines[0];
  const closer = lines[lines.length - 1];
  const body = lines.slice(1, -1);

  const keep = body
    .filter((l) => !/^(best|warm|sincerely|thanks|thank you)/i.test(l))
    .slice(0, 2);

  const parts = [greeting, ...keep];
  if (/^(best|warm|sincerely|thanks)/i.test(closer)) {
    parts.push(closer);
  } else {
    parts.push(closer);
  }

  return parts.join("\n\n");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function flattenPhrases(phrasesData) {
  const out = [];
  for (const cat of phrasesData.categories || []) {
    for (const phrase of cat.phrases || []) {
      out.push({
        phrase,
        categoryId: cat.id,
        categoryLabel: cat.label
      });
    }
  }
  return out;
}
