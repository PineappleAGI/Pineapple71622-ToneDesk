const DEFAULTS = {
  apiKey: "",
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

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    siteEnabled: {
      ...DEFAULTS.siteEnabled,
      ...(stored.siteEnabled || {})
    }
  };
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
