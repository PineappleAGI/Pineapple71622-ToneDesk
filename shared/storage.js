/**
 * chrome.storage.local helpers for ToneDesk preferences.
 * Only settings live here — message text is never written to disk.
 */

const DEFAULTS = {
  lastRelationship: "colleague",
  preferredTone: "balanced",
  favoritePhrases: [],
  hasSeenTooltip: false,
  slotDefaults: {}
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    slotDefaults: { ...DEFAULTS.slotDefaults, ...(stored.slotDefaults || {}) },
    favoritePhrases: Array.isArray(stored.favoritePhrases) ? stored.favoritePhrases : []
  };
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

export async function saveSlotDefaults(values) {
  const settings = await getSettings();
  const slotDefaults = { ...settings.slotDefaults };
  for (const [slot, value] of Object.entries(values || {})) {
    const v = String(value || "").trim();
    if (v) slotDefaults[slot] = v;
  }
  await chrome.storage.local.set({ slotDefaults });
  return slotDefaults;
}

export function detectPlatform(url = "") {
  const host = String(url).toLowerCase();
  if (host.includes("mail.google.com")) return "gmail";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("slack.com")) return "slack";
  if (host.includes("whatsapp.com")) return "whatsapp";
  return "unknown";
}

/** Map host platform → Write Q1 id */
export function platformToQ1(platform) {
  switch (platform) {
    case "gmail":
      return "reply";
    case "linkedin":
      return "linkedin";
    case "slack":
    case "whatsapp":
      return "slack";
    default:
      return null;
  }
}
