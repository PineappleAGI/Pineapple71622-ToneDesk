import { getSettings, saveSettings } from "../shared/storage.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");

init();

async function init() {
  const settings = await getSettings();
  form.apiKey.value = settings.apiKey || "";
  form.tonePreference.value = settings.tonePreference || "balanced";
  form.gmail.checked = settings.siteEnabled.gmail !== false;
  form.linkedin.checked = settings.siteEnabled.linkedin !== false;
  form.slack.checked = settings.siteEnabled.slack !== false;
  form.whatsapp.checked = settings.siteEnabled.whatsapp !== false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Saving…";
  statusEl.className = "status";

  try {
    await saveSettings({
      apiKey: form.apiKey.value.trim(),
      tonePreference: form.tonePreference.value,
      siteEnabled: {
        gmail: form.gmail.checked,
        linkedin: form.linkedin.checked,
        slack: form.slack.checked,
        whatsapp: form.whatsapp.checked
      }
    });
    statusEl.textContent = "Saved";
    statusEl.className = "status ok";
  } catch (error) {
    statusEl.textContent = error.message || "Could not save";
    statusEl.className = "status error";
  }
});
