import { normalizeProvider } from "./ai.js";

const DEFAULTS = {
  provider: "claude",
  apiKeys: {
    claude: "",
    gemini: "",
    openai: ""
  },
  tonePreference: "balanced",
  lastRelationship: "",
  siteEnabled: {
    gmail: true,
    linkedin: true,
    slack: true,
    whatsapp: true
  },
  hasSeenTooltip: false
};

export const PROVIDERS = {
  claude: { id: "claude", label: "Claude (Anthropic)", keyLabel: "Anthropic API key", placeholder: "sk-ant-..." },
  gemini: { id: "gemini", label: "Gemini (Google)", keyLabel: "Google AI API key", placeholder: "AIza..." },
  openai: { id: "openai", label: "OpenAI", keyLabel: "OpenAI API key", placeholder: "sk-..." }
};

export async function getSettings() {
  const stored = await chrome.storage.local.get([...Object.keys(DEFAULTS), "apiKey"]);
  const apiKeys = {
    ...DEFAULTS.apiKeys,
    ...(stored.apiKeys || {})
  };

  // Migrate legacy anthropic key slot
  if (apiKeys.anthropic && !apiKeys.claude) {
    apiKeys.claude = apiKeys.anthropic;
  }

  // Migrate legacy single apiKey into OpenAI slot without changing default provider
  if (stored.apiKey && !apiKeys.openai) {
    apiKeys.openai = stored.apiKey;
  }

  const provider = normalizeProvider(stored.provider);

  return {
    ...DEFAULTS,
    ...stored,
    provider,
    apiKeys,
    siteEnabled: {
      ...DEFAULTS.siteEnabled,
      ...(stored.siteEnabled || {})
    }
  };
}

export function getActiveApiKey(settings) {
  const provider = normalizeProvider(settings.provider);
  const keys = settings.apiKeys || DEFAULTS.apiKeys;
  if (provider === "openai") {
    return keys.openai || settings.apiKey || "";
  }
  return keys[provider] || "";
}

export function providerLabel(providerId) {
  return PROVIDERS[normalizeProvider(providerId)]?.label || providerId;
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

export function detectPlatform(hostnameOrUrl = "") {
  let host = String(hostnameOrUrl || "").toLowerCase();
  try {
    if (host.includes("://")) host = new URL(hostnameOrUrl).hostname.toLowerCase();
  } catch {
    /* use raw string */
  }
  if (host.includes("mail.google.com")) return "gmail";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("slack.com")) return "slack";
  if (host.includes("whatsapp.com")) return "whatsapp";
  return "unknown";
}

export function platformLabel(platform) {
  const labels = {
    gmail: "Gmail / Email",
    linkedin: "LinkedIn",
    slack: "Slack",
    whatsapp: "WhatsApp",
    unknown: "Message"
  };
  return labels[platform] || "Message";
}
