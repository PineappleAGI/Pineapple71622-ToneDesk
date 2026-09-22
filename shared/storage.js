/**
 * chrome.storage.local helpers for ToneDesk preferences.
 * Tone and audience are stored per site. The last 10 rewrites are kept
 * so the panel can show recent history. Live selections stay in session storage.
 */

const DEFAULTS = {
  lastRelationship: "colleague",
  preferredTone: "balanced",
  favoritePhrases: [],
  hasSeenTooltip: false,
  slotDefaults: {},
  audienceByHost: {},
  toneByHost: {},
  rewriteHistory: []
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    slotDefaults: { ...DEFAULTS.slotDefaults, ...(stored.slotDefaults || {}) },
    favoritePhrases: Array.isArray(stored.favoritePhrases) ? stored.favoritePhrases : [],
    audienceByHost: { ...(stored.audienceByHost || {}) },
    toneByHost: { ...(stored.toneByHost || {}) },
    rewriteHistory: Array.isArray(stored.rewriteHistory) ? stored.rewriteHistory.slice(0, 10) : []
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
  if (host.includes("teams.microsoft.com")) return "teams";
  return "unknown";
}

export function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Built-in audience when the user has not chosen one on this site. */
export function defaultAudienceForHost(host = "") {
  const h = String(host).toLowerCase();
  if (h.includes("mail.google.com") || h === "gmail.com") return "client";
  if (h.includes("teams.microsoft.com")) return "peer";
  return "peer";
}

export function resolveAudience(settings, url = "") {
  const host = hostFromUrl(url);
  const saved = host && settings?.audienceByHost?.[host];
  if (saved) return saved;
  return defaultAudienceForHost(host);
}

export function resolveTone(settings, url = "") {
  const host = hostFromUrl(url);
  const saved = host && settings?.toneByHost?.[host];
  if (saved) return saved;
  return "formal";
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
    case "teams":
      return "slack";
    default:
      return null;
  }
}
