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

/**
 * Transform free-form selected/pasted text for Rewrite variants.
 * Always produces a visible rewrite for non-balanced variants (not just
 * dictionary hits on template phrases).
 */
export function transformFreeText(text, variantId, _templates) {
  const raw = String(text || "").trim();
  if (!raw) return raw;

  if (!variantId || variantId === "balanced") return raw;

  if (variantId === "shorter") return rewriteShorter(raw);
  if (variantId === "formal") return rewriteFormal(raw);
  if (variantId === "warmer") return rewriteWarmer(raw);
  if (variantId === "soften") return rewriteSofter(raw);

  return raw;
}

function rewriteSofter(text) {
  let out = text;
  const pairs = [
    [/\bhi guys\b/gi, "Hi there"],
    [/\bhey guys\b/gi, "Hi there"],
    [/\bhey\b/gi, "Hi"],
    [/\byo\b/gi, "Hi"],
    [/\bnope\b/gi, "I'm not sure that works"],
    [/\bno way\b/gi, "I'm not sure that works"],
    [/\bcan't do that\b/gi, "I don't think I can take that on right now"],
    [/\bi can't\b/gi, "I'm not able to at the moment"],
    [/\bthat's wrong\b/gi, "I see it a bit differently"],
    [/\byou need to\b/gi, "Would you be open to"],
    [/\byou should\b/gi, "It might help to"],
    [/\basap\b/gi, "as soon as you're able"],
    [/\bidk\b/gi, "I'm not sure yet"],
    [/\btbh\b/gi, "honestly"],
    [/\blol\b/gi, ""],
    [/\bomg\b/gi, ""],
    [/\bguys\b/gi, "everyone"],
    [/\bnice to hear from you\b/gi, "it's lovely to hear from you"],
    [/\bgood to hear from you\b/gi, "it's good to hear from you"],
    [/!\s*$/g, "."]
  ];
  for (const [from, to] of pairs) out = out.replace(from, to);
  out = tidySpaces(out);

  // Soften abrupt short notes
  if (/^(no|nope|nah)[.!]?\s*$/i.test(out)) {
    return "I'm not sure that works for me right now — happy to look at alternatives.";
  }

  if (out === text || out.toLowerCase() === text.toLowerCase()) {
    // Still ensure a visible soften: wrap with a tactful frame for short lines
    if (text.length < 120 && !/\b(please|would|could|appreciate|happy to)\b/i.test(text)) {
      out = softenShortLine(text);
    }
  }
  return out;
}

function softenShortLine(text) {
  const t = text.trim().replace(/^[a-z]/, (c) => c.toUpperCase());
  if (/^(hi|hello|hey)\b/i.test(t)) {
    return t
      .replace(/^(hi|hey)\s+guys\b/i, "Hi there")
      .replace(/^(hi|hey)\b/i, "Hi")
      .replace(/\bnice to hear from you\b/i, "it's lovely to hear from you")
      .replace(/\bgood to hear from you\b/i, "it's good to hear from you");
  }
  return `${t.replace(/\.*$/, "")} — happy to help however I can.`;
}

function rewriteFormal(text) {
  let out = text;
  const pairs = [
    [/\bhi guys\b/gi, "Hello everyone"],
    [/\bhey guys\b/gi, "Hello everyone"],
    [/\bhi there\b/gi, "Hello"],
    [/\bhey\b/gi, "Hello"],
    [/\bhi\b/gi, "Hello"],
    [/\bguys\b/gi, "everyone"],
    [/\bthanks!\b/gi, "Thank you."],
    [/\bthanks\b/gi, "Thank you"],
    [/\bthx\b/gi, "Thank you"],
    [/\bty\b/gi, "Thank you"],
    [/\bwanna\b/gi, "want to"],
    [/\bgonna\b/gi, "going to"],
    [/\bkinda\b/gi, "somewhat"],
    [/\byeah\b/gi, "yes"],
    [/\byep\b/gi, "yes"],
    [/\bnope\b/gi, "no"],
    [/\basap\b/gi, "as soon as possible"],
    [/\bfyi\b/gi, "for your information"],
    [/\bbtw\b/gi, "by the way"],
    [/\bnice to hear from you\b/gi, "it was a pleasure to hear from you"],
    [/\bgood to hear from you\b/gi, "it was good to hear from you"],
    [/\blet me know\b/gi, "please let me know"],
    [/\bping me\b/gi, "please let me know"],
    [/!+/g, "."]
  ];
  for (const [from, to] of pairs) out = out.replace(from, to);
  out = tidySpaces(out);
  out = out.replace(/^[a-z]/, (c) => c.toUpperCase());
  if (!/[.!?]$/.test(out)) out = `${out}.`;

  if (out === text || out.toLowerCase() === text.toLowerCase()) {
    out = `Hello — ${text.trim().replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/[.!]*$/, "")}.`;
  }
  return out;
}

function rewriteWarmer(text) {
  let out = text;
  const pairs = [
    [/\bhi guys\b/gi, "Hi everyone"],
    [/\bhey guys\b/gi, "Hi everyone"],
    [/\bhi\b/gi, "Hi"],
    [/\bhey\b/gi, "Hi"],
    [/\bnice to hear from you\b/gi, "so nice to hear from you"],
    [/\bgood to hear from you\b/gi, "great to hear from you"],
    [/\bthank you\b/gi, "thank you so much"],
    [/\bthanks\b/gi, "thanks so much"],
    [/\bbest regards\b/gi, "Warm regards"],
    [/\bsincerely\b/gi, "Warm regards"]
  ];
  for (const [from, to] of pairs) out = out.replace(from, to);
  out = tidySpaces(out);

  if (/^(hi|hello)\b/i.test(out) && !/\bhope\b/i.test(out) && out.length < 140) {
    out = out.replace(/([.!?])?\s*$/, "");
    out = `${out} — hope you're doing well!`;
  } else if (out === text || out.toLowerCase() === text.toLowerCase()) {
    out = text.trim().replace(/[.!]*$/, "");
    out = `${out} — hope you're doing well!`;
  }
  return out;
}

function rewriteShorter(text) {
  let out = text
    .replace(/\b(just|really|very|actually|basically|literally|kind of|sort of)\b/gi, "")
    .replace(/\bi wanted to (say|mention|note) that\b/gi, "")
    .replace(/\bi hope this (email|message) finds you well[,.]?\s*/gi, "")
    .replace(/\bplease don't hesitate to reach out\b/gi, "let me know")
    .replace(/\blooking forward to hearing from you\b/gi, "thanks")
    .replace(/\bhi guys,?\s*/gi, "")
    .replace(/\bhey,?\s*/gi, "")
    .replace(/\bhi,?\s*/gi, "");
  out = tidySpaces(out);

  const lines = out
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 2) {
    out = lines.slice(0, 2).join(" ");
  }

  if (!out) out = text.trim();
  out = out.replace(/^[a-z]/, (c) => c.toUpperCase());
  if (out === text) {
    // Force a shorter version for short greetings
    out = text
      .replace(/\bhi guys,?\s*/i, "")
      .replace(/\bhey,?\s*/i, "")
      .replace(/\bhi,?\s*/i, "")
      .trim();
    out = out.replace(/^[a-z]/, (c) => c.toUpperCase()) || text;
  }
  return out;
}

function tidySpaces(s) {
  return String(s || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+!/g, "!")
    .replace(/\s+\?/g, "?")
    .replace(/\s+—\s+/g, " — ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remaining unfilled [slots] in text after applying values */
export function remainingSlots(text, values) {
  return extractSlots(applySlotValues(text, values));
}
