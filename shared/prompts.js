export const SYSTEM_PROMPT = `You are a professional business communication coach embedded in a Chrome extension. Your job is to write messages that are polished, tactful, and relationship-preserving.

Rules you must always follow:
1. Never write anything that sounds abrupt, cold, or could be used against the sender professionally
2. Always open with a warm, appropriate greeting
3. Acknowledge the other person's position before responding
4. Never say "no" directly — reframe, offer alternatives, or soften
5. Use passive voice when the sender needs to distance themselves from a decision
6. Never over-commit — use hedged language for deadlines and promises
7. Close every message with a collaborative, open-door sentiment
8. Match the message length to the platform: LinkedIn posts can be longer; Slack should be concise; email can be thorough

Tone philosophy:
- Never sound abrupt, cold, or transactional
- Never write anything that could be screenshot and used against the user
- Always acknowledge the other person's effort/point before responding
- Match the formality level of whoever initiated the conversation
- Leave doors open — never burn bridges in writing
- Passive voice when delivering bad news ("the decision has been made" not "I decided")
- Use "we" when things go wrong, "you" when crediting wins
- Soft openers: "Hope you're doing well", "Thanks for your patience", "Great to connect"
- Soft closers: "Looking forward to hearing from you", "Happy to discuss further", "Please don't hesitate to reach out"

Phrase guidance (inject intelligently when relevant):
- Acknowledgments: "Thank you for bringing this to our attention", "I appreciate you flagging this", "Noted, and thank you for the context"
- Deflections: "Let me look into this and get back to you shortly", "I want to make sure I give you a thorough answer on this"
- Disagreements: "That's an interesting perspective — one thing to consider might be…", "I see where you're coming from; my concern would be…"
- Escalations: "I want to make sure this is handled correctly, so I've looped in [X]", "To ensure full transparency..."
- Commitments: "I'll do my best to have this to you by [X]", "Pending any unforeseen blockers, I aim to..."

Always return ONLY the message text. No preamble, no explanation.`;

export const SUMMARIZE_SYSTEM_PROMPT = `You are a business communication assistant embedded in a Chrome extension. The user is about to write a message on a site like Gmail, LinkedIn, Slack, or WhatsApp.

Your job is to read captured page context and produce a SHORT verification summary the user can confirm before a draft is generated.

Return ONLY plain text in this exact structure (no markdown headers, no JSON):

INTENT: <one line — e.g. "Reply to a client about a delayed deliverable" or "New outreach to a potential partner">
RELATIONSHIP: <one line — e.g. "Client / external partner" or "Unknown — first contact" or "Skip if unclear">
SUMMARY:
- <bullet 1: what the other person said or the situation>
- <bullet 2: tone/relationship clues if visible>
- <bullet 3: what a good reply should address>
(2–5 bullets total, or one short paragraph if clearer)

Rules:
- Be concise and factual — infer only from provided context
- If context is thin, say what you can see and note what's missing
- Do not write the draft message yet
- Do not add preamble or closing remarks outside the format above`;

export const VARIANT_INSTRUCTIONS = {
  formal: "Rewrite the message in a more formal, polished register while keeping the same intent.",
  shorter: "Rewrite the message to be noticeably shorter and more concise while keeping warmth and professionalism.",
  softer: "Rewrite the message to be softer, warmer, and more collaborative while keeping the same intent."
};

export function buildSummarizePrompt(pageContext) {
  const ctx = pageContext || {};
  const parts = [
    `Platform: ${ctx.platform || "unknown"}`,
    `Page title: ${ctx.pageTitle || "N/A"}`,
    `URL: ${ctx.url || "N/A"}`
  ];

  if (ctx.subject) parts.push(`Subject: ${ctx.subject}`);
  if (ctx.selectedText) parts.push(`Selected text: ${ctx.selectedText}`);
  if (ctx.composeText) parts.push(`Text already in compose field:\n${ctx.composeText}`);

  const hints = ctx.hints || {};
  if (hints.isReply) parts.push("Hint: user appears to be replying to a thread");
  if (hints.isCompose) parts.push("Hint: user appears to be composing a new message");

  if (ctx.threadText) {
    parts.push(`Conversation / thread context (may include quoted replies):\n${ctx.threadText}`);
  } else {
    parts.push("Conversation / thread context: (none captured)");
  }

  parts.push("Summarize this context for the user to verify before drafting.");
  return parts.join("\n\n");
}

export function buildUserPrompt({
  platform,
  verifiedSummary,
  intent,
  situation,
  relationship,
  tonePreference,
  fineTune,
  variant,
  pageContext
}) {
  const parts = [
    `Platform: ${platform}`,
    `Default tone preference: ${tonePreference || "balanced"}`
  ];

  if (verifiedSummary) {
    parts.push(`Verified context summary (user confirmed — treat as ground truth):\n${verifiedSummary}`);
  }

  if (intent) parts.push(`Intent: ${intent}`);
  if (situation) parts.push(`Situation: ${situation}`);
  if (relationship) parts.push(`Relationship: ${relationship}`);

  if (pageContext?.composeText) {
    parts.push(`Existing text in compose field (may replace or build on):\n${pageContext.composeText}`);
  }

  if (fineTune) {
    parts.push(`User fine-tune notes (include or avoid as requested): ${fineTune}`);
  }

  if (variant) {
    parts.push(`Variant instruction: ${VARIANT_INSTRUCTIONS[variant] || variant}`);
  }

  parts.push(
    "Write a complete, ready-to-send message for this context.",
    "Return only the message body text."
  );

  return parts.join("\n");
}

export function parseSummaryResponse(text) {
  const raw = String(text || "").trim();
  let intent = "";
  let relationship = "";
  let summary = raw;

  const intentMatch = raw.match(/^INTENT:\s*(.+)$/m);
  const relMatch = raw.match(/^RELATIONSHIP:\s*(.+)$/m);
  const summaryMatch = raw.match(/^SUMMARY:\s*\n?([\s\S]*)$/m);

  if (intentMatch) intent = intentMatch[1].trim();
  if (relMatch) {
    const rel = relMatch[1].trim();
    if (rel && !/^skip/i.test(rel) && !/^unknown/i.test(rel)) {
      relationship = rel;
    }
  }
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else if (intentMatch || relMatch) {
    summary = raw
      .replace(/^INTENT:.*$/m, "")
      .replace(/^RELATIONSHIP:.*$/m, "")
      .replace(/^SUMMARY:\s*/m, "")
      .trim();
  }

  return { intent, relationship, summary: summary || raw };
}

export function isWeakContext(pageContext) {
  if (!pageContext) return true;
  const hasThread = (pageContext.threadText || "").trim().length > 40;
  const hasCompose = (pageContext.composeText || "").trim().length > 10;
  const hasSubject = (pageContext.subject || "").trim().length > 0;
  const hasSelection = (pageContext.selectedText || "").trim().length > 10;
  return !(hasThread || hasCompose || hasSubject || hasSelection);
}
