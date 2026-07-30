/** chrome.storage.local helpers for ToneDesk preferences */

const DEFAULTS = {
  lastRelationship: "colleague",
  preferredTone: "balanced",
  favoritePhrases: [],
  hasSeenTooltip: false
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  const next = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (partial[key] !== undefined) next[key] = partial[key];
  }
  if (Object.keys(next).length === 0) return getSettings();
  await chrome.storage.local.set(next);
  return getSettings();
}

export async function toggleFavorite(phrase) {
  const settings = await getSettings();
  const set = new Set(settings.favoritePhrases || []);
  if (set.has(phrase)) set.delete(phrase);
  else set.add(phrase);
  const favoritePhrases = [...set];
  await chrome.storage.local.set({ favoritePhrases });
  return favoritePhrases;
}

export function detectPlatform(url = "") {
  const host = String(url).toLowerCase();
  if (host.includes("mail.google.com")) return "gmail";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("slack.com")) return "slack";
  if (host.includes("whatsapp.com")) return "whatsapp";
  return "unknown";
}
