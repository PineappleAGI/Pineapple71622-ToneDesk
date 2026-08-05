/**
 * Chrome Built-in AI (Prompt API) — optional enhancement layer.
 * Degrades gracefully when unavailable.
 */

const SYSTEM_PROMPT = `You are a professional business communication editor. The user will give you a draft message. Your job is to make it sound polished, warm, and tactful without changing its meaning. Apply these rules:
- Never sound abrupt or cold
- Open with a warm greeting if missing
- Use passive voice when distancing from a decision
- Never say "no" directly — soften and reframe
- Close with an open, collaborative sentiment
Return only the revised message. No explanation.`;

const VARIANT_PROMPTS = {
  soften: `Rewrite the message to be softer and more tactful. Keep the meaning. Return only the rewritten message.`,
  formal: `Rewrite the message to be more formal and professional. Keep the meaning. Return only the rewritten message.`,
  warmer: `Rewrite the message to sound warmer and friendlier. Keep the meaning. Return only the rewritten message.`,
  shorter: `Rewrite the message to be shorter and tighter. Keep the meaning. Return only the rewritten message.`,
  balanced: `Lightly polish the message for clarity. Keep the meaning and length. Return only the rewritten message.`
};

export function isBuiltInAiAvailable() {
  try {
    return (
      typeof window !== "undefined" &&
      "ai" in window &&
      window.ai &&
      "languageModel" in window.ai
    );
  } catch {
    return false;
  }
}

/**
 * Polish a draft with Gemini Nano when available.
 * @param {string} draft
 * @param {{ variant?: string }} [opts]
 * @returns {{ text: string, enhanced: boolean, error?: string }}
 */
export async function enhanceWithBuiltInAi(draft, opts = {}) {
  if (!draft || !String(draft).trim()) {
    return { text: draft || "", enhanced: false };
  }

  if (!isBuiltInAiAvailable()) {
    return { text: draft, enhanced: false };
  }

  try {
    const availability = await window.ai.languageModel.availability?.();
    if (availability && availability !== "readily" && availability !== "available" && availability !== "after-download") {
      return { text: draft, enhanced: false, error: `AI status: ${availability}` };
    }

    const variant = opts.variant || "";
    const systemPrompt = VARIANT_PROMPTS[variant]
      ? `${SYSTEM_PROMPT}\n\nSpecific task: ${VARIANT_PROMPTS[variant]}`
      : SYSTEM_PROMPT;

    const session = await window.ai.languageModel.create({
      systemPrompt
    });

    try {
      const result = await session.prompt(String(draft).trim());
      const text = String(result || "").trim();
      if (!text) return { text: draft, enhanced: false, error: "Empty AI response" };
      return { text, enhanced: true };
    } finally {
      session.destroy?.();
    }
  } catch (err) {
    return {
      text: draft,
      enhanced: false,
      error: err?.message || String(err)
    };
  }
}
