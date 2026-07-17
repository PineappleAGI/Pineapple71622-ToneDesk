import { getSettings, saveSettings } from "../shared/storage.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const providerSelect = form.provider;
const keyFields = [...form.querySelectorAll(".key-field")];

init();

async function init() {
  const settings = await getSettings();
  form.provider.value = settings.provider || "gemini";
  form.keyClaude.value = settings.apiKeys?.claude || "";
  form.keyOpenai.value = settings.apiKeys?.openai || "";
  form.keyGemini.value = settings.apiKeys?.gemini || "";
  form.tonePreference.value = settings.tonePreference || "balanced";
  form.gmail.checked = settings.siteEnabled.gmail !== false;
  form.linkedin.checked = settings.siteEnabled.linkedin !== false;
  form.slack.checked = settings.siteEnabled.slack !== false;
  form.whatsapp.checked = settings.siteEnabled.whatsapp !== false;
  updateActiveKeyField();
}

providerSelect.addEventListener("change", updateActiveKeyField);

function updateActiveKeyField() {
  const active = providerSelect.value;
  keyFields.forEach((field) => {
    field.classList.toggle("active", field.dataset.provider === active);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Saving…";
  statusEl.className = "status";

  const apiKeys = {
    claude: form.keyClaude.value.trim(),
    openai: form.keyOpenai.value.trim(),
    gemini: form.keyGemini.value.trim()
  };

  try {
    const payload = {
      provider: form.provider.value,
      apiKeys,
      tonePreference: form.tonePreference.value,
      siteEnabled: {
        gmail: form.gmail.checked,
        linkedin: form.linkedin.checked,
        slack: form.slack.checked,
        whatsapp: form.whatsapp.checked
      }
    };

    // Keep legacy apiKey in sync for OpenAI migration compatibility
    if (apiKeys.openai) {
      payload.apiKey = apiKeys.openai;
    }

    await saveSettings(payload);
    statusEl.textContent = "Saved";
    statusEl.className = "status ok";
  } catch (error) {
    statusEl.textContent = error.message || "Could not save";
    statusEl.className = "status error";
  }
});
