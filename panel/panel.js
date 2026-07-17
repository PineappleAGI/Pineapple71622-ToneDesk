import { getSettings, getActiveApiKey, platformLabel } from "../shared/storage.js";
import { normalizeProvider, PROVIDER_LABELS } from "../shared/ai.js";

const VARIANT_CHIPS = [
  { id: "formal", label: "More formal" },
  { id: "shorter", label: "Shorter" },
  { id: "softer", label: "Softer" }
];

const state = {
  step: "loading",
  platform: "gmail",
  tabId: null,
  pageContext: null,
  contextSummary: "",
  inferredIntent: "",
  inferredRelationship: "",
  userNotes: "",
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
  const [{ context, pageContext, tabId }, settings] = await Promise.all([
    sendMessage({ type: "GET_PANEL_CONTEXT" }),
    getSettings()
  ]);

  state.tabId = tabId || null;
  state.platform = context?.platform || pageContext?.platform || guessPlatformFromQuery() || "gmail";
  state.pageContext = pageContext || null;
  state.inferredRelationship = settings.lastRelationship || "";
  platformLabelEl.textContent = platformLabel(state.platform);

  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  restartBtn.addEventListener("click", () => {
    resetFlow();
    startContextFlow();
  });

  if (!getActiveApiKey(settings)) {
    renderMissingKey(settings);
    return;
  }

  startContextFlow();
}

function resetFlow() {
  state.step = "loading";
  state.contextSummary = "";
  state.inferredIntent = "";
  state.userNotes = "";
  state.draft = "";
  state.activeVariant = "balanced";
  state.fineTune = "";
  state.status = "";
  state.statusType = "";
  state.loading = false;
}

function guessPlatformFromQuery() {
  const params = new URLSearchParams(location.search);
  return params.get("platform") || null;
}

function renderMissingKey(settings) {
  const provider = normalizeProvider(settings.provider);
  const label = PROVIDER_LABELS[provider] || provider;
  const geminiLink =
    '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>';

  let message;
  if (provider === "gemini") {
    message = `
      <p>Get a <strong>free</strong> Gemini API key from ${geminiLink}, paste it in settings, then come back here.</p>
      <p class="hint">The free tier has rate limits — enough for everyday message drafting.</p>
    `;
  } else {
    message = `
      <p>ToneDesk is set to ${label}. Add your API key in settings, or switch to <strong>Gemini</strong> for a free tier via ${geminiLink}.</p>
      <p class="hint">Claude and OpenAI typically require paid API keys.</p>
    `;
  }

  restartBtn.hidden = true;
  main.innerHTML = `
    <section class="empty-state step">
      <h2 class="question">Add your API key</h2>
      ${message}
      <div class="actions">
        <button type="button" class="btn btn-primary" id="open-settings">Open settings</button>
      </div>
    </section>
  `;
  main.querySelector("#open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

async function startContextFlow() {
  state.step = "loading";
  state.loading = true;
  render();

  try {
    const res = await sendMessage({
      type: "SUMMARIZE_CONTEXT",
      tabId: state.tabId,
      pageContext: state.pageContext
    });

    if (!res?.ok) throw new Error(res?.error || "Could not read page context");

    state.pageContext = res.pageContext || state.pageContext;
    state.inferredIntent = res.intent || "";
    state.inferredRelationship = res.relationship || state.inferredRelationship || "";

    if (res.isWeak && !res.summary) {
      state.step = "fallback";
      state.contextSummary = "";
    } else {
      state.contextSummary = formatSummaryForEdit(res);
      state.step = res.isWeak ? "fallback" : "verify";
    }
  } catch (error) {
    state.step = "fallback";
    state.status = error.message || "Could not read the page";
    state.statusType = "error";
  } finally {
    state.loading = false;
    render();
  }
}

function formatSummaryForEdit(res) {
  const parts = [];
  if (res.intent) parts.push(`Goal: ${res.intent}`);
  if (res.relationship) parts.push(`Relationship: ${res.relationship}`);
  if (res.summary) {
    if (parts.length) parts.push("");
    parts.push(res.summary);
  }
  return parts.join("\n").trim() || res.rawSummary || "";
}

function render() {
  restartBtn.hidden = state.step === "loading";

  if (state.step === "loading") return renderLoading();
  if (state.step === "verify") return renderVerify();
  if (state.step === "fallback") return renderFallback();
  return renderDraft();
}

function renderLoading() {
  main.innerHTML = `
    <section class="step loading-state">
      <div class="loading-spinner" aria-hidden="true"></div>
      <h2 class="question">Reading the page…</h2>
      <p class="hint">Scanning the conversation and compose field on ${escapeHtml(platformLabel(state.platform))}.</p>
    </section>
  `;
}

function renderVerify() {
  main.innerHTML = `
    <section class="step">
      <h2 class="question">Does this look right?</h2>
      <p class="hint">We read the page to understand context. Edit anything that's off before drafting.</p>

      ${state.inferredIntent ? `<p class="intent-badge">${escapeHtml(state.inferredIntent)}</p>` : ""}

      <label class="field-label" for="context-summary">Context summary</label>
      <textarea id="context-summary" class="field context-field">${escapeHtml(state.contextSummary)}</textarea>

      <div class="actions">
        <button type="button" class="btn btn-secondary" id="rescan-btn" ${state.loading ? "disabled" : ""}>Re-scan page</button>
        <button type="button" class="btn btn-primary" id="confirm-btn" ${state.loading ? "disabled" : ""}>Looks right — draft</button>
      </div>

      <div class="status ${state.statusType} ${state.loading ? "loading-dot" : ""}" id="status">${escapeHtml(state.status)}</div>
    </section>
  `;

  main.querySelector("#context-summary").addEventListener("input", (e) => {
    state.contextSummary = e.target.value;
  });

  main.querySelector("#rescan-btn").addEventListener("click", rescanAndSummarize);
  main.querySelector("#confirm-btn").addEventListener("click", () => {
    state.contextSummary = main.querySelector("#context-summary")?.value || state.contextSummary;
    generateDraft();
  });
}

function renderFallback() {
  main.innerHTML = `
    <section class="step">
      <h2 class="question">What are you trying to say?</h2>
      <p class="hint">We couldn't read much from this page. Describe the situation in a sentence or two.</p>

      <textarea id="fallback-input" class="field context-field" placeholder="e.g. Reply to my manager about needing one more day on the report">${escapeHtml(state.userNotes || state.contextSummary)}</textarea>

      <div class="actions">
        <button type="button" class="btn btn-secondary" id="rescan-btn">Try re-scanning page</button>
        <button type="button" class="btn btn-primary" id="fallback-draft-btn">Draft message</button>
      </div>

      <div class="status ${state.statusType}" id="status">${escapeHtml(state.status)}</div>
    </section>
  `;

  main.querySelector("#fallback-input").addEventListener("input", (e) => {
    state.userNotes = e.target.value;
  });

  main.querySelector("#rescan-btn").addEventListener("click", rescanAndSummarize);
  main.querySelector("#fallback-draft-btn").addEventListener("click", () => {
    state.userNotes = main.querySelector("#fallback-input")?.value || "";
    state.contextSummary = state.userNotes;
    if (!state.contextSummary.trim()) {
      state.status = "Add a short description first";
      state.statusType = "error";
      const statusEl = main.querySelector("#status");
      if (statusEl) {
        statusEl.textContent = state.status;
        statusEl.className = `status ${state.statusType}`;
      }
      return;
    }
    generateDraft();
  });
}

async function rescanAndSummarize() {
  state.loading = true;
  state.status = "Re-scanning page…";
  state.statusType = "";
  render();

  try {
    const scan = await sendMessage({ type: "RESCAN_PAGE_CONTEXT", tabId: state.tabId });
    if (!scan?.ok) throw new Error(scan?.error || "Re-scan failed");

    state.pageContext = scan.pageContext;

    const res = await sendMessage({
      type: "SUMMARIZE_CONTEXT",
      tabId: state.tabId,
      pageContext: state.pageContext
    });

    if (!res?.ok) throw new Error(res?.error || "Could not summarize context");

    state.inferredIntent = res.intent || "";
    state.inferredRelationship = res.relationship || "";
    state.contextSummary = formatSummaryForEdit(res);
    state.step = res.isWeak ? "fallback" : "verify";
    state.status = "";
  } catch (error) {
    state.status = error.message || "Re-scan failed";
    state.statusType = "error";
  } finally {
    state.loading = false;
    render();
  }
}

async function generateDraft({ variant = null, fineTune = null } = {}) {
  state.loading = true;
  state.status = variant ? "Adjusting tone" : fineTune ? "Updating draft" : "Drafting your message";
  state.statusType = "";
  if (!state.draft) state.step = "draft";
  renderDraft();

  const verifiedSummary = state.contextSummary || state.userNotes;

  const payload = {
    platform: state.platform,
    verifiedSummary,
    intent: state.inferredIntent,
    relationship: state.inferredRelationship,
    fineTune: fineTune ?? state.fineTune,
    variant,
    pageContext: state.pageContext,
    tabId: state.tabId
  };

  try {
    const type = variant ? "GENERATE_VARIANT" : "GENERATE_DRAFT";
    const res = await sendMessage({ type, payload, tabId: state.tabId });
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
