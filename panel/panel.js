import { getSettings, getActiveApiKey, platformLabel } from "../shared/storage.js";
import { normalizeProvider, PROVIDER_LABELS } from "../shared/ai.js";

const INTENT_OPTIONS = [
  { id: "reply", label: "💬 Reply to a message" },
  { id: "new_email", label: "📧 Start a new email" },
  { id: "outreach", label: "🤝 Reach out to someone new" },
  { id: "post", label: "📢 Write a post/update" }
];

const SITUATION_OPTIONS = [
  { id: "concern", label: "Someone raised a concern or complaint" },
  { id: "need_think", label: "Someone asked me a question I need to think about" },
  { id: "pushback", label: "I need to say no / push back" },
  { id: "followup", label: "I'm following up on something" },
  { id: "feedback", label: "I'm delivering feedback" },
  { id: "went_wrong", label: "Something went wrong and I need to address it" }
];

const RELATIONSHIP_OPTIONS = [
  { id: "boss", label: "My boss / senior leader" },
  { id: "peer", label: "A colleague / peer" },
  { id: "junior", label: "Someone on my team / junior" },
  { id: "client", label: "A client or external partner" },
  { id: "new", label: "Someone I've never spoken to" }
];

const VARIANT_CHIPS = [
  { id: "formal", label: "More formal" },
  { id: "shorter", label: "Shorter" },
  { id: "softer", label: "Softer" }
];

const state = {
  step: "intent",
  platform: "gmail",
  tabId: null,
  intent: "",
  situation: "",
  relationship: "",
  draft: "",
  activeVariant: "balanced",
  fineTune: "",
  loading: false,
  status: "",
  statusType: ""
};

const main = document.getElementById("main");
const platformLabelEl = document.getElementById("platform-label");
const restartBtn = document.getElementById("btn-restart");
const settingsBtn = document.getElementById("btn-settings");

init();

async function init() {
  const [{ context, tabId }, settings] = await Promise.all([
    sendMessage({ type: "GET_PANEL_CONTEXT" }),
    getSettings()
  ]);

  state.tabId = tabId || null;
  state.platform = context?.platform || guessPlatformFromQuery() || "gmail";
  state.relationship = settings.lastRelationship || "";
  platformLabelEl.textContent = platformLabel(state.platform);

  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  restartBtn.addEventListener("click", () => {
    state.step = "intent";
    state.intent = "";
    state.situation = "";
    state.draft = "";
    state.activeVariant = "balanced";
    state.fineTune = "";
    state.status = "";
    state.statusType = "";
    render();
  });

  if (!getActiveApiKey(settings)) {
    renderMissingKey(settings);
    return;
  }

  render();
}

function guessPlatformFromQuery() {
  const params = new URLSearchParams(location.search);
  return params.get("platform") || null;
}

function renderMissingKey(settings) {
  const provider = normalizeProvider(settings.provider);
  const label = PROVIDER_LABELS[provider] || provider;
  restartBtn.hidden = true;
  main.innerHTML = `
    <section class="empty-state step">
      <h2 class="question">Add your API key</h2>
      <p>ToneDesk uses ${label} to draft messages. Add your key in settings, then come back here.</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" id="open-settings">Open settings</button>
      </div>
    </section>
  `;
  main.querySelector("#open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function render() {
  restartBtn.hidden = state.step === "intent";

  if (state.step === "intent") return renderIntent();
  if (state.step === "situation") return renderSituation();
  if (state.step === "relationship") return renderRelationship();
  return renderDraft();
}

function renderProgress(activeIndex) {
  return `
    <div class="progress" aria-hidden="true">
      <span class="${activeIndex >= 0 ? "active" : ""}"></span>
      <span class="${activeIndex >= 1 ? "active" : ""}"></span>
      <span class="${activeIndex >= 2 ? "active" : ""}"></span>
    </div>
  `;
}

function renderIntent() {
  main.innerHTML = `
    <section class="step">
      ${renderProgress(0)}
      <h2 class="question">What are you trying to do?</h2>
      <p class="hint">Pick one — we'll tailor the draft from here.</p>
      <div class="chips" id="intent-chips">
        ${INTENT_OPTIONS.map(
          (opt) => `
          <button type="button" class="chip ${state.intent === opt.id ? "selected" : ""}" data-id="${opt.id}">
            ${opt.label}
          </button>`
        ).join("")}
      </div>
    </section>
  `;

  main.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.intent = btn.dataset.id;
      if (state.intent === "reply") {
        state.step = "situation";
      } else {
        state.situation = defaultSituationForIntent(state.intent);
        state.step = "relationship";
      }
      render();
    });
  });
}

function defaultSituationForIntent(intent) {
  if (intent === "new_email") return "Starting a new professional email";
  if (intent === "outreach") return "Reaching out to someone new";
  if (intent === "post") return "Writing a professional post or update";
  return "General business communication";
}

function renderSituation() {
  main.innerHTML = `
    <section class="step">
      ${renderProgress(1)}
      <h2 class="question">What's the situation?</h2>
      <p class="hint">This shapes acknowledgments, pushback, and closings.</p>
      <div class="chips">
        ${SITUATION_OPTIONS.map(
          (opt) => `
          <button type="button" class="chip ${state.situation === opt.id ? "selected" : ""}" data-id="${opt.id}">
            ${opt.label}
          </button>`
        ).join("")}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="back-btn">Back</button>
      </div>
    </section>
  `;

  main.querySelector("#back-btn").addEventListener("click", () => {
    state.step = "intent";
    render();
  });

  main.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.situation = btn.dataset.id;
      state.step = "relationship";
      render();
    });
  });
}

function renderRelationship() {
  main.innerHTML = `
    <section class="step">
      ${renderProgress(2)}
      <h2 class="question">What's your relationship with this person?</h2>
      <p class="hint">We'll match formality to the audience.</p>
      <div class="chips">
        ${RELATIONSHIP_OPTIONS.map(
          (opt) => `
          <button type="button" class="chip ${state.relationship === opt.id ? "selected" : ""}" data-id="${opt.id}">
            ${opt.label}
          </button>`
        ).join("")}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="back-btn">Back</button>
        <button type="button" class="btn btn-primary" id="generate-btn" ${state.relationship ? "" : "disabled"}>
          Generate draft
        </button>
      </div>
    </section>
  `;

  main.querySelector("#back-btn").addEventListener("click", () => {
    state.step = state.intent === "reply" ? "situation" : "intent";
    render();
  });

  main.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.relationship = btn.dataset.id;
      renderRelationship();
    });
  });

  main.querySelector("#generate-btn").addEventListener("click", () => {
    generateDraft();
  });
}

async function generateDraft({ variant = null, fineTune = null } = {}) {
  state.loading = true;
  state.status = variant ? "Adjusting tone" : fineTune ? "Updating draft" : "Drafting your message";
  state.statusType = "";
  if (!state.draft) state.step = "draft";
  renderDraft();

  const payload = {
    platform: state.platform,
    intent: labelFor(INTENT_OPTIONS, state.intent) || state.intent,
    situation: labelFor(SITUATION_OPTIONS, state.situation) || state.situation,
    relationship: labelFor(RELATIONSHIP_OPTIONS, state.relationship) || state.relationship,
    relationshipId: state.relationship,
    fineTune: fineTune ?? state.fineTune,
    variant
  };

  try {
    const type = variant ? "GENERATE_VARIANT" : "GENERATE_DRAFT";
    const res = await sendMessage({ type, payload });
    if (!res?.ok) throw new Error(res?.error || "Failed to generate draft");
    state.draft = res.draft;
    state.activeVariant = variant || "balanced";
    state.status = "Draft ready";
    state.statusType = "ok";
  } catch (error) {
    state.status = error.message || "Something went wrong";
    state.statusType = "error";
  } finally {
    state.loading = false;
    renderDraft();
  }
}

function renderDraft() {
  restartBtn.hidden = false;
  const disabled = state.loading ? "disabled" : "";

  main.innerHTML = `
    <section class="step">
      <h2 class="question">Your draft</h2>
      <p class="hint">Copy it, insert it, or tweak the tone.</p>
      <div class="draft-card" id="draft-text">${escapeHtml(state.draft || (state.loading ? "Writing…" : "No draft yet."))}</div>

      <div class="variants">
        ${VARIANT_CHIPS.map(
          (v) => `
          <button type="button" class="variant-chip ${state.activeVariant === v.id ? "active" : ""}" data-id="${v.id}" ${disabled}>
            ${v.label}
          </button>`
        ).join("")}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-secondary" id="copy-btn" ${state.draft && !state.loading ? "" : "disabled"}>Copy</button>
        <button type="button" class="btn btn-primary" id="insert-btn" ${state.draft && !state.loading ? "" : "disabled"}>Insert</button>
      </div>

      <div class="fine-tune">
        <label for="fine-tune-input">Anything specific you want included or avoided?</label>
        <textarea id="fine-tune-input" class="field" placeholder="e.g. Mention Thursday works, avoid promising a firm deadline">${escapeHtml(state.fineTune)}</textarea>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="refine-btn" ${state.draft && !state.loading ? "" : "disabled"}>Update draft</button>
        </div>
      </div>

      <div class="status ${state.statusType} ${state.loading ? "loading-dot" : ""}" id="status">${escapeHtml(state.status)}</div>
    </section>
  `;

  main.querySelectorAll(".variant-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      generateDraft({ variant: btn.dataset.id });
    });
  });

  main.querySelector("#copy-btn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.draft);
      state.status = "Copied to clipboard";
      state.statusType = "ok";
    } catch {
      state.status = "Could not copy — select the text manually";
      state.statusType = "error";
    }
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = state.status;
      statusEl.className = `status ${state.statusType}`;
    }
  });

  main.querySelector("#insert-btn")?.addEventListener("click", async () => {
    try {
      const res = await sendMessage({
        type: "INSERT_TEXT",
        text: state.draft,
        tabId: state.tabId
      });
      if (!res?.ok) throw new Error(res?.error || "Insert failed");
      state.status = "Inserted into the message field";
      state.statusType = "ok";
    } catch (error) {
      state.status = error.message || "Could not insert — try Copy instead";
      state.statusType = "error";
    }
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = state.status;
      statusEl.className = `status ${state.statusType}`;
    }
  });

  const fineTuneInput = main.querySelector("#fine-tune-input");
  fineTuneInput?.addEventListener("input", () => {
    state.fineTune = fineTuneInput.value;
  });

  main.querySelector("#refine-btn")?.addEventListener("click", () => {
    state.fineTune = fineTuneInput?.value || "";
    generateDraft({ fineTune: state.fineTune });
  });
}

function labelFor(options, id) {
  return options.find((o) => o.id === id)?.label || id;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}
