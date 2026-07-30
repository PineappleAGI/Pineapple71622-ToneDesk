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
 * @returns {{ text: string, enhanced: boolean, error?: string }}
 */
export async function enhanceWithBuiltInAi(draft) {
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

    const session = await window.ai.languageModel.create({
      systemPrompt: SYSTEM_PROMPT
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
