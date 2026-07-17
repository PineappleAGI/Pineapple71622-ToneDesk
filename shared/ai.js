import { SYSTEM_PROMPT } from "./prompts.js";

export const PROVIDER_MODELS = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash"
};

export const PROVIDER_LABELS = {
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Gemini (Google)"
};

export function normalizeProvider(provider) {
  if (provider === "anthropic") return "claude";
  return provider || "gemini";
}

export async function generateMessage({ provider, apiKey, userPrompt }) {
  switch (normalizeProvider(provider)) {
    case "openai":
      return callOpenAI({ apiKey, userPrompt });
    case "gemini":
      return callGemini({ apiKey, userPrompt });
    case "claude":
    default:
      return callClaude({ apiKey, userPrompt });
  }
}

async function callOpenAI({ apiKey, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: PROVIDER_MODELS.openai,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "OpenAI"));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No draft returned from the model.");
  return text;
}

async function callClaude({ apiKey, userPrompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: PROVIDER_MODELS.claude,
      max_tokens: 1024,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Claude"));
  }

  const data = await response.json();
  const text = data?.content?.find((block) => block.type === "text")?.text?.trim();
  if (!text) throw new Error("No draft returned from the model.");
  return text;
}

async function callGemini({ apiKey, userPrompt }) {
  const model = PROVIDER_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Gemini"));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("No draft returned from the model.");
  return text;
}

async function extractError(response, providerName) {
  let detail = "";
  try {
    const err = await response.json();
    detail =
      err?.error?.message ||
      err?.error?.status ||
      err?.message ||
      (typeof err?.error === "string" ? err.error : "");
  } catch {
    /* ignore */
  }
  return detail || `${providerName} request failed (${response.status})`;
}
