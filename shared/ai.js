import { SYSTEM_PROMPT, SUMMARIZE_SYSTEM_PROMPT } from "./prompts.js";

export const PROVIDER_MODELS = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash-lite"
};

const GEMINI_FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

export const PROVIDER_LABELS = {
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Gemini (Google)"
};

export function normalizeProvider(provider) {
  if (provider === "anthropic") return "claude";
  return provider || "gemini";
}

export async function generateMessage({ provider, apiKey, userPrompt, systemPrompt = SYSTEM_PROMPT }) {
  switch (normalizeProvider(provider)) {
    case "openai":
      return callOpenAI({ apiKey, userPrompt, systemPrompt });
    case "gemini":
      return callGemini({ apiKey, userPrompt, systemPrompt });
    case "claude":
    default:
      return callClaude({ apiKey, userPrompt, systemPrompt });
  }
}

export async function summarizeContext({ provider, apiKey, userPrompt }) {
  return generateMessage({
    provider,
    apiKey,
    userPrompt,
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT
  });
}

async function callOpenAI({ apiKey, userPrompt, systemPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: PROVIDER_MODELS.openai,
      temperature: 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "OpenAI"));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No response returned from the model.");
  return text;
}

async function callClaude({ apiKey, userPrompt, systemPrompt }) {
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
      temperature: 0.5,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Claude"));
  }

  const data = await response.json();
  const text = data?.content?.find((block) => block.type === "text")?.text?.trim();
  if (!text) throw new Error("No response returned from the model.");
  return text;
}

async function callGemini({ apiKey, userPrompt, systemPrompt }) {
  const models = [PROVIDER_MODELS.gemini, ...GEMINI_FALLBACK_MODELS];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.5 }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) throw new Error("No response returned from the model.");
      return text;
    }

    const { detail, status } = await readErrorBody(response);
    const canRetry = i < models.length - 1 && isGeminiModelUnavailable(detail, status);
    if (!canRetry) {
      throw new Error(formatProviderErrorMessage("Gemini", detail, status));
    }
  }

  throw new Error("Gemini request failed.");
}

function isGeminiModelUnavailable(detail, status) {
  const lower = (detail || "").toLowerCase();
  return (
    status === 404 ||
    lower.includes("no longer available") ||
    lower.includes("not found") ||
    lower.includes("is not supported")
  );
}

async function readErrorBody(response) {
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
  return { detail, status: response.status };
}

function formatProviderErrorMessage(providerName, detail, status) {
  const friendly = formatProviderError(providerName, detail, status);
  return friendly || detail || `${providerName} request failed (${status})`;
}

async function extractError(response, providerName) {
  const { detail, status } = await readErrorBody(response);
  return formatProviderErrorMessage(providerName, detail, status);
}

export function isQuotaError(message) {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("too many requests") ||
    lower.includes("limit: 0")
  );
}

function formatProviderError(providerName, detail, status) {
  const lower = (detail || "").toLowerCase();
  const isQuota =
    status === 429 ||
    lower.includes("quota exceeded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests");

  if (!isQuota) return null;

  if (providerName === "Gemini") {
    const limitZero = /limit:\s*0/i.test(detail);
    const modelMatch = detail.match(/model:\s*([^\s,]+)/i);
    const modelNote = limitZero
      ? ` That model${modelMatch ? ` (${modelMatch[1]})` : ""} has no free-tier quota for your project — limits vary by model.`
      : " Free-tier limits vary by model.";
    return (
      `Gemini quota or rate limit reached.${modelNote} ` +
      "Wait and try again later, check your limits at https://ai.dev/rate-limit, " +
      "enable billing in Google AI Studio, or switch to another provider in ToneDesk settings."
    );
  }

  if (providerName === "OpenAI") {
    return (
      "OpenAI rate limit reached. Wait a moment and try again, or check your usage at platform.openai.com."
    );
  }

  if (providerName === "Claude") {
    return (
      "Claude rate limit reached. Wait a moment and try again, or check your usage at console.anthropic.com."
    );
  }

  return `${providerName} quota or rate limit reached. Please wait and try again.`;
}
