import { PHRASE_LIBRARY } from "./phrases.js";

const PLATFORM_LABELS = {
  gmail: "Gmail",
  linkedin: "LinkedIn",
  slack: "Slack",
  whatsapp: "WhatsApp"
};

/** Build a local summary from extracted page fields — no API tokens. */
export function buildHeuristicSummary(pageContext) {
  const ctx = pageContext || {};
  const platform = ctx.platform || "unknown";
  const label = PLATFORM_LABELS[platform] || platform;
  const hints = ctx.hints || {};

  let intent = "";
  if (hints.isReply && ctx.subject) {
    intent = `Reply on ${label}: ${ctx.subject}`;
  } else if (hints.isReply) {
    intent = `Reply to a conversation on ${label}`;
  } else if (hints.isCompose || ctx.composeText) {
    intent = `Compose a new message on ${label}`;
  } else {
    intent = `Write a message on ${label}`;
  }

  const bullets = [];

  if (ctx.subject) {
    bullets.push(`Subject: ${ctx.subject}`);
  }

  if (ctx.threadText) {
    const segments = ctx.threadText.split(/\n\n---\n\n/).filter(Boolean);
    const recent = segments.slice(-3);
    if (recent.length === 1) {
      bullets.push(`Latest message: ${truncateSnippet(recent[0], 400)}`);
    } else {
      bullets.push("Recent messages:");
      recent.forEach((seg, i) => {
        bullets.push(`  ${i + 1}. ${truncateSnippet(seg, 280)}`);
      });
    }
  }

  if (ctx.selectedText) {
    bullets.push(`Selected text: ${truncateSnippet(ctx.selectedText, 200)}`);
  }

  if (ctx.composeText) {
    bullets.push(`Started draft: "${truncateSnippet(ctx.composeText, 180)}"`);
  }

  if (ctx.pageTitle && !ctx.subject) {
    bullets.push(`Page: ${truncateSnippet(ctx.pageTitle, 120)}`);
  }

  const relationship = inferRelationship(ctx);
  const summary = bullets.join("\n");
  const isEmpty = bullets.length === 0;

  return { intent, relationship, summary, isEmpty };
}

function inferRelationship(ctx) {
  const text = `${ctx.threadText || ""} ${ctx.subject || ""} ${ctx.pageTitle || ""}`.toLowerCase();
  if (/\b(client|customer|vendor|partner|external)\b/.test(text)) return "External / client";
  if (/\b(manager|boss|director|lead|supervisor)\b/.test(text)) return "Manager";
  if (/\b(team|colleague|coworker|internal)\b/.test(text)) return "Colleague / internal";
  if (ctx.platform === "linkedin") return "Professional network";
  return "";
}

function truncateSnippet(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Template-based draft — no API. Uses ToneDesk phrase philosophy. */
export function generateOfflineDraft({
  platform,
  verifiedSummary,
  intent,
  relationship,
  variant,
  fineTune,
  pageContext,
  tonePreference
}) {
  const isShort = platform === "slack" || platform === "whatsapp";
  const isFormal = tonePreference === "formal" || variant === "formal";

  const opener = pickPhrase(
    isFormal ? ["Dear colleague", "Hello"] : PHRASE_LIBRARY.softOpeners
  );
  const closer = pickPhrase(PHRASE_LIBRARY.softClosers);
  const acknowledge = pickPhrase(PHRASE_LIBRARY.acknowledgments);

  const bodySource = verifiedSummary || intent || "";
  const replyContext = extractReplyContext(bodySource, pageContext);
  const body = buildBodyParagraph(replyContext, isShort);

  const parts = [];
  parts.push(`${opener},`);
  parts.push("");
  parts.push(`${acknowledge}.`);
  if (body) parts.push(body);
  if (fineTune?.trim()) {
    parts.push(fineTune.trim());
  }
  parts.push("");
  parts.push(`${closer}.`);

  let draft = parts.filter((p) => p !== undefined).join("\n");

  if (variant === "shorter") draft = shortenDraft(draft, isShort);
  if (variant === "softer") draft = softenDraft(draft);
  if (variant === "formal") draft = formalizeDraft(draft);

  return draft.trim();
}

function pickPhrase(list) {
  const arr = Array.isArray(list) ? list : [list];
  return arr[Math.floor(Math.random() * arr.length)] || arr[0] || "";
}

function extractReplyContext(summary, pageContext) {
  const thread = pageContext?.threadText || "";
  if (thread) {
    const last = thread.split(/\n\n---\n\n/).filter(Boolean).pop() || "";
    if (last.length > 20) return truncateSnippet(last, 300);
  }

  const lines = String(summary || "")
    .split("\n")
    .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
    .filter(Boolean);

  const substantive = lines.find(
    (l) =>
      !/^subject:/i.test(l) &&
      !/^page:/i.test(l) &&
      !/^goal:/i.test(l) &&
      !/^relationship:/i.test(l) &&
      !/^recent messages/i.test(l) &&
      l.length > 15
  );

  return substantive || "";
}

function buildBodyParagraph(context, isShort) {
  if (!context) {
    return isShort
      ? "I've reviewed your note and wanted to follow up."
      : "I've had a chance to review your message and wanted to follow up with a thoughtful response.";
  }

  if (isShort) {
    return `Re your note — I've reviewed what you shared and will follow up shortly.`;
  }

  return `Regarding your message — I've reviewed the points you raised${context ? ` (${truncateSnippet(context, 120)})` : ""} and wanted to respond.`;
}

function shortenDraft(text, isShort) {
  let out = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/I wanted to make sure I give you a thorough answer on this/gi, "I'll follow up")
    .replace(/Thank you for bringing this to our attention/gi, "Thanks for flagging this")
    .replace(/I've had a chance to review your message and wanted to follow up with a thoughtful response\./gi, "Reviewed your note — following up.")
    .replace(/Regarding your message — I've reviewed the points you raised \([^)]+\) and wanted to respond\./gi, "Reviewed your points — following up.");

  if (isShort) {
    const lines = out.split("\n").filter((l) => l.trim());
    out = lines.slice(0, Math.min(5, lines.length)).join("\n");
  }
  return out;
}

function softenDraft(text) {
  return text
    .replace(/\bI'll\b/gi, "I'll do my best to")
    .replace(/\bI will\b/gi, "I'll do my best to")
    .replace(
      /Please don't hesitate to reach out\./i,
      "Please don't hesitate to reach out — happy to discuss further."
    );
}

function formalizeDraft(text) {
  return text
    .replace(/^(Hope you're doing well|Thanks for your patience|Great to connect),/m, "Hello,")
    .replace(/Thanks for flagging this/gi, "Thank you for bringing this to our attention")
    .replace(/I've reviewed/gi, "I have reviewed")
    .replace(/I'll /gi, "I will ")
    .replace(/don't/gi, "do not");
}

/** Score richness of extracted context for multi-frame merge. */
export function contextScore(ctx) {
  if (!ctx) return 0;
  return (
    (ctx.threadText?.length || 0) +
    (ctx.composeText?.length || 0) * 2 +
    (ctx.subject?.length || 0) * 3 +
    (ctx.selectedText?.length || 0)
  );
}

export function pickRichestContext(...contexts) {
  return contexts.filter(Boolean).sort((a, b) => contextScore(b) - contextScore(a))[0] || null;
}
