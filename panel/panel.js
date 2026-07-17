import { getSettings, platformLabel } from "../shared/storage.js";
import { buildHeuristicSummary } from "../shared/offline.js";

const VARIANT_CHIPS = [
  { id: "formal", label: "More formal" },
  { id: "shorter", label: "Shorter" },
  { id: "softer", label: "Softer" }
];

const SUMMARIZE_CLIENT_TIMEOUT_MS = 10000;

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
  statusType: "",
  notice: "",
  offlineMode: false,
  quotaError: false
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
  state.notice = "";
  state.offlineMode = false;
  state.quotaError = false;
  state.loading = false;
}

function guessPlatformFromQuery() {
  const params = new URLSearchParams(location.search);
  return params.get("platform") || null;
}

async function startContextFlow() {
  state.step = "loading";
  state.loading = true;
  state.notice = "";
  render();

  try {
    const res = await withTimeout(
      sendMessage({
        type: "SUMMARIZE_CONTEXT",
        tabId: state.tabId,
        pageContext: state.pageContext
      }),
      SUMMARIZE_CLIENT_TIMEOUT_MS
    );

    if (!res?.ok) throw new Error(res?.error || "Could not read page context");

    applySummaryResult(res);
  } catch (error) {
    if (state.pageContext && !isContextEmpty(state.pageContext)) {
      const heuristic = buildHeuristicSummary(state.pageContext);
      applySummaryResult({
        ok: true,
        pageContext: state.pageContext,
        summary: heuristic.summary,
        intent: heuristic.intent,
        relationship: heuristic.relationship,
        isWeak: heuristic.isEmpty,
        offlineFallback: true,
        notice: "Reading timed out — showing page capture instead. You can edit and still draft."
      });
    } else {
      showEmptyContextFallback(error.message);
    }
  } finally {
    state.loading = false;
    render();
  }
}

function applySummaryResult(res) {
  state.pageContext = res.pageContext || state.pageContext;
  state.inferredIntent = res.intent || "";
  state.inferredRelationship = res.relationship || state.inferredRelationship || "";
  state.offlineMode = Boolean(res.offlineFallback);
  state.quotaError = Boolean(res.quotaError);
  state.notice = res.notice || "";

  if (res.isWeak && !res.summary) {
    state.step = "fallback";
    state.contextSummary = "";
    if (!state.notice) {
      state.notice = "Couldn't read much from this page — describe what you need below.";
    }
  } else {
    state.contextSummary = formatSummaryForEdit(res);
    state.step = res.isWeak ? "fallback" : "verify";
  }
}

function showEmptyContextFallback(errorMessage) {
  state.step = "fallback";
  state.contextSummary = "";
  state.offlineMode = true;
  state.notice =
    state.quotaError || /quota|rate limit/i.test(errorMessage || "")
      ? "AI quota reached — couldn't summarize. Describe your message below to draft offline."
      : "Couldn't read this page. Describe what you're trying to say and we'll draft offline.";
  state.status = errorMessage && !state.notice ? errorMessage : "";
  state.statusType = state.status ? "error" : "";
}

function isContextEmpty(ctx) {
  if (!ctx) return true;
  return !(
    (ctx.threadText || "").trim() ||
    (ctx.composeText || "").trim() ||
    (ctx.subject || "").trim() ||
    (ctx.selectedText || "").trim()
  );
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

function noticeHtml() {
  if (!state.notice) return "";
  return `<div class="notice-banner ${state.quotaError ? "quota" : "offline"}">${state.notice}</div>`;
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
      ${noticeHtml()}
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
      ${noticeHtml()}
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

    if (isContextEmpty(state.pageContext)) {
      state.step = "fallback";
      state.notice = "Couldn't read this page — describe what you need below.";
      state.status = "";
      return;
    }

    const res = await withTimeout(
      sendMessage({
        type: "SUMMARIZE_CONTEXT",
        tabId: state.tabId,
        pageContext: state.pageContext
      }),
      SUMMARIZE_CLIENT_TIMEOUT_MS
    );

    if (!res?.ok) throw new Error(res?.error || "Could not summarize context");

    applySummaryResult(res);
    state.status = "";
  } catch (error) {
    if (state.pageContext && !isContextEmpty(state.pageContext)) {
      applySummaryResult({
        ok: true,
        pageContext: state.pageContext,
        summary: formatLocalCapture(state.pageContext),
        intent: "",
        relationship: "",
        isWeak: false,
        offlineFallback: true,
        notice: "Showing page capture — AI unavailable."
      });
      state.status = "";
    } else {
      state.step = "fallback";
      state.status = error.message || "Re-scan failed";
      state.statusType = "error";
      state.notice = "Couldn't read this page — describe what you need below.";
    }
  } finally {
    state.loading = false;
    render();
  }
}

function formatLocalCapture(ctx) {
  const parts = [];
  if (ctx.subject) parts.push(`Subject: ${ctx.subject}`);
  if (ctx.threadText) parts.push(ctx.threadText.slice(0, 1200));
  if (ctx.composeText) parts.push(`Draft started: ${ctx.composeText.slice(0, 300)}`);
  if (ctx.selectedText) parts.push(`Selected: ${ctx.selectedText.slice(0, 200)}`);
  return parts.join("\n\n");
}

async function generateDraft({ variant = null, fineTune = null, forceOffline = false } = {}) {
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
    const type = forceOffline
      ? "GENERATE_OFFLINE_DRAFT"
      : variant
        ? "GENERATE_VARIANT"
        : "GENERATE_DRAFT";
    const res = await sendMessage({ type, payload, tabId: state.tabId });
    if (!res?.ok) throw new Error(res?.error || "Failed to generate draft");
    state.draft = res.draft;
    state.activeVariant = variant || "balanced";
    state.offlineMode = Boolean(res.offlineFallback);
    state.quotaError = Boolean(res.quotaError);
    if (res.notice) state.notice = res.notice;
    state.status = res.offlineFallback ? "Draft ready (offline)" : "Draft ready";
    state.statusType = "ok";
  } catch (error) {
    state.status = error.message || "Something went wrong";
    state.statusType = "error";
    state.showOfflineButton = true;
  } finally {
    state.loading = false;
    renderDraft();
  }
}

function renderDraft() {
  restartBtn.hidden = false;
  const disabled = state.loading ? "disabled" : "";
  const showOfflineBtn = state.statusType === "error" && !state.draft;

  main.innerHTML = `
    <section class="step">
      ${noticeHtml()}
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

      ${showOfflineBtn ? `
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="offline-draft-btn">Draft offline</button>
      </div>` : ""}

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
      generateDraft({ variant: btn.dataset.id, forceOffline: state.offlineMode });
    });
  });

  main.querySelector("#offline-draft-btn")?.addEventListener("click", () => {
    generateDraft({ forceOffline: true });
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
    generateDraft({ fineTune: state.fineTune, forceOffline: state.offlineMode });
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Reading the page timed out")), ms)
    )
  ]);
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
