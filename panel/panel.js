import {
  getSettings,
  saveSettings,
  toggleFavorite,
  saveSlotDefaults,
  platformToQ1,
  hostFromUrl,
  resolveAudience,
  resolveTone
} from "../shared/storage.js";
import { fuzzySearch } from "../shared/fuzzy.js";
import { isBuiltInAiAvailable, enhanceWithBuiltInAi } from "../shared/ai.js";
import { rewriteMessage, TONES, AUDIENCES } from "../shared/rewrite.js";
import { diffHtml } from "../shared/diff.js";
import {
  getDraft,
  applySlotValues,
  extractSlots,
  applyVariant,
  flattenPhrases,
  remainingSlots
} from "../shared/templates.js";

const main = document.getElementById("main");
const globalSearch = document.getElementById("global-search");

let phrasesData = null;
let templatesData = null;
let phraseCorpus = [];
let writeCorpus = [];
let audienceCorpus = [];
let settings = null;
let activeTab = "rewrite";
let panelContext = null;
let pageSelection = "";
let pageSelectionFrameId = undefined;

/** Write flow state (new draft wizard) */
const writeState = {
  step: 1,
  q1: null,
  q2: null,
  q3: null,
  preselectedFromPlatform: false,
  draftText: "",
  baseText: "",
  slots: [],
  slotValues: {},
  variant: "balanced",
  tone: "formal",
  enhanced: false,
  enhancing: false,
  editingSlot: null
};

/** Rewrite tab state */
const rewriteState = {
  active: false,
  source: "",
  tone: "formal",
  audience: "peer",
  notes: [],
  draftText: "",
  enhanced: false,
  enhancing: false,
  pasteDraft: "",
  whyOpen: false
};

const SEARCH_PLACEHOLDERS = {
  rewrite: "Find a specific tone…",
  write: "Search situations — follow up, say no…",
  phrases: "Find phrases — follow up, say no…"
};

const DEFAULT_OPEN_CATEGORIES = new Set(["openers", "following_up", "requests"]);

const CATEGORY_ICONS = {
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  scale:
    '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  briefcase:
    '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'
};

const PLATFORM_LABEL = {
  gmail: "Gmail",
  linkedin: "LinkedIn",
  slack: "Slack",
  whatsapp: "WhatsApp",
  teams: "Teams"
};

init().catch((err) => {
  console.error("ToneDesk panel failed to init", err);
  if (main) {
    main.innerHTML = `<div class="empty-state">ToneDesk failed to load.<br/>Reload the extension and try again.<br/><small>${escapeHtml(err?.message || String(err))}</small></div>`;
  }
});

async function init() {
  let phrases;
  let templates;
  let s;
  let ctx;

  try {
    [phrases, templates, s, ctx] = await Promise.all([
      fetch(chrome.runtime.getURL("data/phrases.json")).then((r) => {
        if (!r.ok) throw new Error(`phrases.json ${r.status}`);
        return r.json();
      }),
      fetch(chrome.runtime.getURL("data/templates.json")).then((r) => {
        if (!r.ok) throw new Error(`templates.json ${r.status}`);
        return r.json();
      }),
      getSettings(),
      getPanelContext()
    ]);
  } catch (err) {
    throw err;
  }

  phrasesData = phrases;
  templatesData = templates;
  phraseCorpus = flattenPhrases(phrases);
  writeCorpus = buildWriteCorpus(templates);
  audienceCorpus = buildAudienceCorpus(templates);
  settings = s;
  panelContext = ctx;

  if (settings.lastRelationship) {
    writeState.q3 = settings.lastRelationship;
  }
  if (settings.preferredTone && settings.preferredTone !== "balanced") {
    writeState.variant =
      settings.preferredTone === "formal"
        ? "formal"
        : settings.preferredTone === "warm"
          ? "warmer"
          : "balanced";
  }

  applyPlatformPreselect();
  rewriteState.tone = resolveTone(settings, panelContext?.url);
  rewriteState.audience = resolveAudience(settings, panelContext?.url);

  pageSelection = await fetchPageSelection();
  await maybeStartShortcutRewrite();

  document.getElementById("btn-window")?.addEventListener("click", openInWindow);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  updateSearchPlaceholder();

  globalSearch.addEventListener("input", () => {
    render();
  });

  globalSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      globalSearch.value = "";
      render();
    }
  });

  render();
}

function applyPlatformPreselect() {
  const q1 = platformToQ1(panelContext?.platform);
  if (!q1 || writeState.q1) return;
  writeState.q1 = q1;
  writeState.step = 2;
  writeState.preselectedFromPlatform = true;
}

async function getPanelContext() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "GET_PANEL_CONTEXT" }, (res) => {
        void chrome.runtime.lastError;
        resolve(res?.context || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function fetchPageSelection() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "GET_SELECTION",
          tabId: panelContext?.tabId,
          frameId: panelContext?.frameId
        },
        (res) => {
          void chrome.runtime.lastError;
          const text = String(res?.text || "").trim();
          if (typeof res?.frameId === "number") pageSelectionFrameId = res.frameId;
          resolve(text);
        }
      );
    } catch {
      resolve("");
    }
  });
}

function clearStoredSelection() {
  pageSelection = "";
  pageSelectionFrameId = undefined;
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "CLEAR_SELECTION", tabId: panelContext?.tabId },
        () => {
          void chrome.runtime.lastError;
          resolve();
        }
      );
    } catch {
      resolve();
    }
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((el) => {
    const on = el.dataset.tab === tab;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });
  updateSearchPlaceholder();
  render();
}

function searchQuery() {
  return globalSearch?.value.trim() || "";
}

function updateSearchPlaceholder() {
  if (!globalSearch) return;
  globalSearch.placeholder = SEARCH_PLACEHOLDERS[activeTab] || "Search…";
}

function captureTransientInputs() {
  const paste = main.querySelector("#paste-rewrite-input");
  if (paste) rewriteState.pasteDraft = paste.value;
  const slot = main.querySelector("#slot-input");
  if (slot && writeState.editingSlot) {
    const val = slot.value.trim();
    if (val) writeState.slotValues[writeState.editingSlot] = val;
    else delete writeState.slotValues[writeState.editingSlot];
  }
}

function render() {
  captureTransientInputs();
  if (activeTab === "write") renderWrite();
  else if (activeTab === "phrases") renderPhrases();
  else renderRewriteTab();
}

function matchingRewriteTones(query) {
  const n = String(query || "").toLowerCase().trim();
  if (n.length < 2) return TONES.slice();
  const parts = n.split(/\s+/).filter((part) => part.length >= 2);
  if (!parts.length) return TONES.slice();
  return TONES.filter((tone) => {
    const hay = `${tone.label} ${tone.hint} ${tone.keys}`.toLowerCase();
    return parts.some((part) => {
      if (hay.includes(part)) return true;
      return tone.keys.split(/\s+/).some((key) => key.startsWith(part) || (part.startsWith(key) && key.length > 3));
    });
  });
}

function currentHost() {
  return hostFromUrl(panelContext?.url || "");
}

async function persistToneAudience() {
  const host = currentHost() || "default";
  const audienceByHost = { ...(settings.audienceByHost || {}), [host]: rewriteState.audience };
  const toneByHost = { ...(settings.toneByHost || {}), [host]: rewriteState.tone };
  settings.audienceByHost = audienceByHost;
  settings.toneByHost = toneByHost;
  await saveSettings({ audienceByHost, toneByHost, preferredTone: rewriteState.tone });
  settings.preferredTone = rewriteState.tone;
}

async function rememberRewrite() {
  const list = Array.isArray(settings.rewriteHistory) ? settings.rewriteHistory.slice() : [];
  list.unshift({
    source: String(rewriteState.source || "").slice(0, 2000),
    result: String(rewriteState.draftText || "").slice(0, 2000),
    tone: rewriteState.tone,
    audience: rewriteState.audience,
    notes: (rewriteState.notes || []).slice(0, 4),
    at: Date.now()
  });
  settings.rewriteHistory = list.slice(0, 10);
  await saveSettings({ rewriteHistory: settings.rewriteHistory });
}

async function maybeStartShortcutRewrite() {
  try {
    const data = await chrome.storage.session.get("pendingRewrite");
    const pending = data?.pendingRewrite;
    if (!pending || Date.now() - Number(pending.at || 0) > 20000) return;
    await chrome.storage.session.remove("pendingRewrite");
    if (pageSelection && pageSelection.length >= 3) startRewrite(pageSelection);
  } catch {
    /* session storage is extension-only */
  }
}

/* ── Rewrite tab ── */

function renderRewriteTab() {
  if (rewriteState.active) {
    renderRewriteResult();
    return;
  }

  main.innerHTML = `
    ${selectionBannerHtml()}
    ${toneAudienceControlsHtml()}
    <div class="paste-rewrite">
      <label for="paste-rewrite-input">Or paste text to rewrite</label>
      <textarea id="paste-rewrite-input" rows="4" placeholder="Paste a draft here…">${escapeHtml(rewriteState.pasteDraft || "")}</textarea>
      <button type="button" class="btn btn-primary" id="btn-paste-rewrite">Rewrite pasted text</button>
      <p class="shortcut-hint">Shortcut: Alt+Shift+R</p>
    </div>
    ${historyHtml()}
  `;
  bindSelectionBanner();
  bindToneAudienceControls();
  bindHistory();
}

function labelForTone(id) {
  return TONES.find((tone) => tone.id === id)?.label || "Formal";
}

function labelForAudience(id) {
  return AUDIENCES.find((item) => item.id === id)?.label || "Peer/Colleague";
}

function toneAudienceControlsHtml() {
  const q = searchQuery();
  const tones = matchingRewriteTones(q);
  const chips = tones.length
    ? `<div class="tone-scroll" role="listbox" aria-label="Tone">${tones
        .map(
          (tone) =>
            `<button type="button" class="tone-chip ${rewriteState.tone === tone.id ? "active" : ""}" data-tone="${tone.id}" title="${escapeAttr(tone.hint)}">${escapeHtml(tone.label)}</button>`
        )
        .join("")}</div>`
    : `<div class="empty-state">No tones match “${escapeHtml(q)}”.</div>`;
  const options = AUDIENCES.map(
    (item) =>
      `<option value="${item.id}" ${rewriteState.audience === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`
  ).join("");
  return `
    <p class="field-label">Tone</p>
    ${chips}
    <label class="field-label" for="audience-select">Audience</label>
    <select id="audience-select" class="audience-select">${options}</select>
  `;
}

function historyHtml() {
  if (searchQuery().length >= 2) return "";
  const items = settings?.rewriteHistory || [];
  if (!items.length) return "";
  const rows = items
    .map((item, index) => {
      const preview = String(item.source || "").replace(/\s+/g, " ").trim();
      const short = preview.length > 72 ? `${preview.slice(0, 72)}…` : preview;
      return `<button type="button" class="chip history-row" data-history="${index}"><span class="result-meta">${escapeHtml(labelForTone(item.tone))} · ${escapeHtml(labelForAudience(item.audience))}</span>${escapeHtml(short)}</button>`;
    })
    .join("");
  return `
    <div class="recent-head">
      <p class="field-label">Recent</p>
      <button type="button" class="recent-clear" id="btn-clear-recent">Clear</button>
    </div>
    <div class="chips">${rows}</div>`;
}

function selectionBannerHtml() {
  if (pageSelection && pageSelection.length >= 3) {
    const preview =
      pageSelection.length > 90 ? `${pageSelection.slice(0, 90)}…` : pageSelection;
    return `
      <div class="rewrite-banner" id="rewrite-banner">
        <div>
          <p class="rewrite-banner-title">Page selection</p>
          <p class="rewrite-banner-preview">${escapeHtml(preview)}</p>
        </div>
        <button type="button" class="btn btn-primary btn-compact" id="btn-start-rewrite">Rewrite</button>
      </div>
    `;
  }

  return `
    <div class="rewrite-banner rewrite-banner-idle" id="rewrite-banner">
      <div>
        <p class="rewrite-banner-title">Rewrite selection</p>
        <p class="rewrite-banner-preview">1) Highlight text on Gmail / LinkedIn / Slack / WhatsApp<br/>2) Tap Use selection — or paste below</p>
      </div>
      <button type="button" class="btn btn-secondary btn-compact" id="btn-use-selection">Use selection</button>
    </div>
  `;
}

function bindSelectionBanner() {
  const grabLatest = async ({ start = false } = {}) => {
    showToast("Looking for selection…");
    pageSelection = await fetchPageSelection();
    if (pageSelection && pageSelection.length >= 3) {
      if (start) startRewrite(pageSelection);
      else render();
      return;
    }
    pageSelection = "";
    showToast("Still none — paste text in the box below");
    if (!start) render();
  };

  // Always re-fetch — never trust a stale banner preview
  main.querySelector("#btn-start-rewrite")?.addEventListener("click", () => {
    grabLatest({ start: true });
  });

  main.querySelector("#btn-use-selection")?.addEventListener("click", () => {
    grabLatest({ start: false });
  });

  main.querySelector("#btn-paste-rewrite")?.addEventListener("click", () => {
    const raw = main.querySelector("#paste-rewrite-input")?.value?.trim() || "";
    if (raw.length < 3) {
      showToast("Paste a bit more text first");
      return;
    }
    rewriteState.pasteDraft = "";
    startRewrite(raw, rewriteState.tone);
  });
}

function bindToneAudienceControls({ rerun = false } = {}) {
  main.querySelectorAll("[data-tone]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      rewriteState.tone = btn.dataset.tone;
      await persistToneAudience();
      if (rerun && rewriteState.source) {
        startRewrite(rewriteState.source, rewriteState.tone);
        return;
      }
      render();
    });
  });

  main.querySelector("#audience-select")?.addEventListener("change", async (event) => {
    rewriteState.audience = event.target.value;
    await persistToneAudience();
    if (rerun && rewriteState.source) startRewrite(rewriteState.source);
  });
}

function bindHistory() {
  main.querySelector("#btn-clear-recent")?.addEventListener("click", async () => {
    settings.rewriteHistory = [];
    await saveSettings({ rewriteHistory: [] });
    render();
  });

  main.querySelectorAll("[data-history]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = settings.rewriteHistory?.[Number(btn.dataset.history)];
      if (!item) return;
      rewriteState.active = true;
      rewriteState.source = item.source;
      rewriteState.draftText = item.result;
      rewriteState.tone = item.tone || "formal";
      rewriteState.audience = item.audience || "peer";
      rewriteState.notes = item.notes || [];
      rewriteState.enhanced = false;
      rewriteState.enhancing = false;
      renderRewriteResult();
    });
  });
}

function applyRewrite(source, tone) {
  const selected = tone || rewriteState.tone || "formal";
  const audience = rewriteState.audience || "peer";
  const { text, notes } = rewriteMessage(source, {
    tone: selected,
    audience,
    platform: panelContext?.platform
  });
  rewriteState.tone = selected;
  rewriteState.draftText = text;
  rewriteState.notes = notes;
}

function startRewrite(source, tone) {
  rewriteState.active = true;
  rewriteState.source = source;
  rewriteState.enhanced = false;
  rewriteState.enhancing = false;
  applyRewrite(source, tone);
  rememberRewrite();
  if (activeTab !== "rewrite") switchTab("rewrite");
  else renderRewriteResult();
}

function renderRewriteResult() {
  const q = searchQuery();
  const filtered = q.length >= 2 ? matchingRewriteTones(q) : [];
  const filterRow = q.length >= 2
    ? filtered.length
      ? `<div class="tone-scroll">${filtered
          .map(
            (tone) =>
              `<button type="button" class="tone-chip ${rewriteState.tone === tone.id ? "active" : ""}" data-tone="${tone.id}">${escapeHtml(tone.label)}</button>`
          )
          .join("")}</div>`
      : `<div class="empty-state">No tones match “${escapeHtml(q)}”.</div>`
    : "";

  const notes = rewriteState.notes?.length
    ? rewriteState.notes
    : ["Adjusted wording to match the selected tone and audience"];

  main.innerHTML = `
    <div class="back-row">
      <button type="button" class="link-btn" id="btn-new-rewrite">← New rewrite</button>
      <span class="badge template">${escapeHtml(labelForTone(rewriteState.tone))} · ${escapeHtml(labelForAudience(rewriteState.audience))}</span>
    </div>
    ${filterRow}
    <p class="step-label">Before / after</p>
    <div class="preview-card diff" id="rewrite-preview">${diffHtml(rewriteState.source, rewriteState.draftText, escapeHtml)}</div>
    <details class="why-panel" ${rewriteState.whyOpen ? "open" : ""}>
      <summary>Why this edit</summary>
      <ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </details>
    <div class="actions">
      <button type="button" class="btn btn-primary" id="btn-copy">Copy</button>
      <button type="button" class="btn btn-secondary" id="btn-insert">Insert</button>
    </div>
    <button type="button" class="btn btn-secondary btn-block" id="btn-regenerate">Regenerate with a different tone</button>
  `;

  main.querySelector(".why-panel")?.addEventListener("toggle", (event) => {
    rewriteState.whyOpen = event.currentTarget.open;
  });

  main.querySelector("#btn-new-rewrite").onclick = async () => {
    rewriteState.active = false;
    rewriteState.source = "";
    rewriteState.draftText = "";
    rewriteState.notes = [];
    rewriteState.enhanced = false;
    rewriteState.enhancing = false;
    rewriteState.pasteDraft = "";
    await clearStoredSelection();
    renderRewriteTab();
  };

  main.querySelector("#btn-regenerate").onclick = () => {
    rewriteState.active = false;
    rewriteState.pasteDraft = rewriteState.source;
    renderRewriteTab();
    main.querySelector("#paste-rewrite-input")?.focus();
  };

  bindToneAudienceControls({ rerun: true });

  main.querySelector("#btn-copy").onclick = () => copyAndRemember(rewriteState.draftText, "Rewrite");
  main.querySelector("#btn-insert").onclick = () => insertAndRemember(rewriteState.draftText, "Rewrite");
}

/* ── Write tab ── */

function renderWrite() {
  const q = searchQuery();
  if (q.length >= 2) {
    renderWriteSearch(q);
    return;
  }

  if (writeState.step === 4 || writeState.draftText) {
    renderDraft();
    return;
  }

  if (writeState.step === 1) {
    main.innerHTML = `
      <p class="step-label">Step 1 of 3</p>
      <h2 class="question">What are you writing?</h2>
      <div class="chips" id="chips"></div>
    `;
    const chips = main.querySelector("#chips");
    for (const opt of templatesData.q1) {
      chips.appendChild(
        makeChip(opt.label, () => {
          writeState.q1 = opt.id;
          writeState.q2 = null;
          writeState.step = 2;
          writeState.preselectedFromPlatform = false;
          if (opt.id === "job_search") {
            writeState.q3 = "recruiter";
            writeState.tone = rewriteState.tone || "formal";
          }
          render();
        })
      );
    }
    return;
  }

  if (writeState.step === 2) {
    const situations = templatesData.q2[writeState.q1] || [];
    const q1Label = labelFor(templatesData.q1, writeState.q1);
    const platformHint = writeState.preselectedFromPlatform
      ? `<p class="platform-hint">Suggested for ${escapeHtml(PLATFORM_LABEL[panelContext?.platform] || "this page")} — change anytime</p>`
      : "";
    main.innerHTML = `
      <div class="back-row">
        <button type="button" class="link-btn" id="btn-back">← Back</button>
      </div>
      <p class="answers-trail">${escapeHtml(q1Label)}</p>
      ${platformHint}
      <p class="step-label">Step 2 of 3</p>
      <h2 class="question">What's the situation?</h2>
      <div class="chips" id="chips"></div>
    `;
    main.querySelector("#btn-back").onclick = () => {
      writeState.step = 1;
      writeState.q1 = null;
      writeState.preselectedFromPlatform = false;
      render();
    };
    const chips = main.querySelector("#chips");
    for (const opt of situations) {
      chips.appendChild(
        makeChip(opt.label, () => {
          writeState.q2 = opt.id;
          writeState.step = 3;
          if (writeState.q1 === "job_search") writeState.q3 = writeState.q3 || "recruiter";
          render();
        })
      );
    }
    return;
  }

  if (writeState.step === 3) {
    const q1Label = labelFor(templatesData.q1, writeState.q1);
    const q2Label = labelFor(templatesData.q2[writeState.q1], writeState.q2);
    const jobSearch = writeState.q1 === "job_search";
    const toneRow = jobSearch
      ? `<p class="field-label">Tone</p><div class="tone-scroll">${TONES.map(
          (tone) =>
            `<button type="button" class="tone-chip ${writeState.tone === tone.id ? "active" : ""}" data-write-tone="${tone.id}">${escapeHtml(tone.label)}</button>`
        ).join("")}</div>`
      : "";
    main.innerHTML = `
      <div class="back-row">
        <button type="button" class="link-btn" id="btn-back">← Back</button>
      </div>
      <p class="answers-trail">${escapeHtml(q1Label)} · ${escapeHtml(q2Label)}</p>
      <p class="step-label">Step 3 of 3</p>
      ${toneRow}
      <h2 class="question">Who are you talking to?</h2>
      <div class="chips" id="chips"></div>
      ${jobSearch ? `<button type="button" class="btn btn-primary btn-block" id="btn-create-draft">Create draft</button>` : ""}
    `;
    main.querySelector("#btn-back").onclick = () => {
      writeState.step = 2;
      writeState.q2 = null;
      render();
    };
    main.querySelectorAll("[data-write-tone]").forEach((btn) => {
      btn.addEventListener("click", () => {
        writeState.tone = btn.dataset.writeTone;
        render();
      });
    });
    const choices = jobSearch ? AUDIENCES : templatesData.q3;
    const chips = main.querySelector("#chips");
    for (const opt of choices) {
      const chip = makeChip(opt.label, async () => {
        writeState.q3 = opt.id;
        if (jobSearch) {
          rewriteState.audience = opt.id;
          await persistToneAudience();
        } else {
          await saveSettings({ lastRelationship: opt.id });
          settings.lastRelationship = opt.id;
        }
        await generateDraft();
      });
      const selected = jobSearch
        ? opt.id === (writeState.q3 || "recruiter")
        : opt.id === writeState.q3 || opt.id === settings.lastRelationship;
      if (selected) chip.classList.add("selected");
      chips.appendChild(chip);
    }
    main.querySelector("#btn-create-draft")?.addEventListener("click", async () => {
      writeState.q3 = writeState.q3 || "recruiter";
      rewriteState.audience = writeState.q3;
      rewriteState.tone = writeState.tone || "formal";
      await persistToneAudience();
      await generateDraft();
    });
  }
}

async function generateDraft() {
  const result = getDraft(templatesData, writeState.q1, writeState.q2, writeState.q3);
  writeState.baseText = result.text;
  writeState.slots = unique([...result.slots, ...extractSlots(result.text)]);
  writeState.slotValues = pickSlotDefaults(writeState.slots);
  writeState.variant = "balanced";
  writeState.enhanced = false;
  writeState.enhancing = isBuiltInAiAvailable() && writeState.q1 !== "job_search";
  writeState.step = 4;
  if (writeState.q1 === "job_search") {
    const { text } = rewriteMessage(result.text, {
      tone: writeState.tone || "formal",
      audience: writeState.q3 || "recruiter",
      platform: panelContext?.platform
    });
    writeState.draftText = text;
  } else {
    writeState.draftText = applyVariant(result.text, writeState.variant, templatesData);
  }
  renderDraft();

  if (isBuiltInAiAvailable() && writeState.q1 !== "job_search") {
    const { text, enhanced } = await enhanceWithBuiltInAi(writeState.draftText);
    writeState.enhancing = false;
    if (enhanced) {
      writeState.draftText = text;
      writeState.baseText = text;
      writeState.slots = extractSlots(text);
      writeState.slotValues = pickSlotDefaults(writeState.slots);
      writeState.enhanced = true;
    }
    if (activeTab === "write" && writeState.step === 4) renderDraft();
  }
}

function pickSlotDefaults(slots) {
  const defaults = settings.slotDefaults || {};
  const values = {};
  for (const slot of slots) {
    if (defaults[slot]) values[slot] = defaults[slot];
  }
  return values;
}

function renderDraft() {
  const display = applySlotValues(writeState.draftText, writeState.slotValues);
  const unfilled = remainingSlots(writeState.draftText, writeState.slotValues);
  const badge = writeState.enhancing
    ? `<span class="badge">⏳ Enhancing…</span>`
    : writeState.enhanced
      ? `<span class="badge ai">✨ AI-enhanced</span>`
      : `<span class="badge template">📝 Template</span>`;

  const slotWarn = unfilled.length
    ? `<p class="slot-warn">${unfilled.length} blank${unfilled.length > 1 ? "s" : ""} left — tap yellow slots to fill</p>`
    : "";

  main.innerHTML = `
    <div class="back-row">
      <button type="button" class="link-btn" id="btn-restart">← Start over</button>
      ${badge}
    </div>
    <p class="answers-trail">${escapeHtml(trailText() || "Recent draft")}</p>
    ${
      writeState.q1 === "job_search"
        ? `<div class="tone-scroll">${TONES.map(
            (tone) =>
              `<button type="button" class="tone-chip ${writeState.tone === tone.id ? "active" : ""}" data-tone="${tone.id}">${escapeHtml(tone.label)}</button>`
          ).join("")}</div>`
        : `<div class="variant-row">
      <button type="button" class="variant-chip ${writeState.variant === "balanced" ? "active" : ""}" data-v="balanced">Balanced</button>
      <button type="button" class="variant-chip ${writeState.variant === "formal" ? "active" : ""}" data-v="formal">More formal</button>
      <button type="button" class="variant-chip ${writeState.variant === "shorter" ? "active" : ""}" data-v="shorter">Shorter</button>
      <button type="button" class="variant-chip ${writeState.variant === "warmer" ? "active" : ""}" data-v="warmer">Warmer</button>
    </div>`
    }
    <div class="preview-card" id="preview"></div>
    ${slotWarn}
    <div id="slot-editor"></div>
    <div class="actions">
      <button type="button" class="btn btn-secondary" id="btn-copy">Copy</button>
      <button type="button" class="btn btn-primary" id="btn-insert">Insert into page</button>
    </div>
  `;

  main.querySelector("#btn-restart").onclick = () => {
    writeState.draftText = "";
    writeState.baseText = "";
    writeState.enhanced = false;
    writeState.enhancing = false;
    writeState.editingSlot = null;
    writeState.slotValues = {};
    writeState.q2 = null;
    const q1 = platformToQ1(panelContext?.platform);
    if (q1) {
      writeState.q1 = q1;
      writeState.step = 2;
      writeState.preselectedFromPlatform = true;
    } else {
      writeState.q1 = null;
      writeState.step = 1;
      writeState.preselectedFromPlatform = false;
    }
    render();
  };

  main.querySelectorAll("[data-tone]").forEach((btn) => {
    btn.onclick = () => {
      writeState.tone = btn.dataset.tone;
      const { text } = rewriteMessage(writeState.baseText, {
        tone: writeState.tone,
        audience: writeState.q3 || "recruiter",
        platform: panelContext?.platform
      });
      writeState.draftText = text;
      writeState.enhanced = false;
      writeState.slots = extractSlots(writeState.draftText);
      renderDraft();
    };
  });

  main.querySelectorAll(".variant-chip").forEach((btn) => {
    btn.onclick = async () => {
      const v = btn.dataset.v;
      writeState.variant = v;
      const preferred =
        v === "formal" ? "formal" : v === "warmer" ? "warm" : "balanced";
      saveSettings({ preferredTone: preferred });
      settings.preferredTone = preferred;

      let text = applyVariant(writeState.baseText, v === "balanced" ? null : v, templatesData);
      writeState.draftText = text;
      writeState.enhanced = false;

      if (isBuiltInAiAvailable() && v !== "shorter") {
        writeState.enhancing = true;
        renderDraft();
        const { text: polished, enhanced } = await enhanceWithBuiltInAi(text);
        writeState.enhancing = false;
        if (enhanced) {
          writeState.draftText = polished;
          writeState.enhanced = true;
        }
      }
      writeState.slots = extractSlots(writeState.draftText);
      renderDraft();
    };
  });

  const preview = main.querySelector("#preview");
  preview.innerHTML = renderPreviewHtml(display);

  preview.querySelectorAll(".slot").forEach((el) => {
    el.addEventListener("click", () => {
      writeState.editingSlot = el.dataset.slot;
      renderDraft();
    });
  });

  if (writeState.editingSlot) {
    const editor = main.querySelector("#slot-editor");
    const slot = writeState.editingSlot;
    editor.innerHTML = `
      <div class="slot-prompt">
        <label for="slot-input">Fill in: [${escapeHtml(slot)}]</label>
        <input id="slot-input" type="text" value="${escapeAttr(writeState.slotValues[slot] || "")}" placeholder="Type here…" />
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="slot-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="slot-save">Done</button>
        </div>
      </div>
    `;
    const input = editor.querySelector("#slot-input");
    input.focus();
    input.select();
    const save = async () => {
      const val = input.value.trim();
      if (val) {
        writeState.slotValues[slot] = val;
        settings.slotDefaults = await saveSlotDefaults({ [slot]: val });
      } else {
        delete writeState.slotValues[slot];
      }
      writeState.editingSlot = null;
      renderDraft();
    };
    editor.querySelector("#slot-save").onclick = save;
    editor.querySelector("#slot-cancel").onclick = () => {
      writeState.editingSlot = null;
      renderDraft();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") {
        writeState.editingSlot = null;
        renderDraft();
      }
    });
  }

  main.querySelector("#btn-copy").onclick = () => {
    const finalText = applySlotValues(writeState.draftText, writeState.slotValues);
    withEmptySlotCheck(finalText, () => copyAndRemember(finalText, trailText()));
  };
  main.querySelector("#btn-insert").onclick = () => {
    const finalText = applySlotValues(writeState.draftText, writeState.slotValues);
    withEmptySlotCheck(finalText, () => insertAndRemember(finalText, trailText()));
  };
}

function withEmptySlotCheck(finalText, proceed) {
  const left = extractSlots(finalText);
  if (!left.length) {
    proceed();
    return;
  }
  const ok = window.confirm(
    `${left.length} blank${left.length > 1 ? "s" : ""} still empty (${left.map((s) => `[${s}]`).join(", ")}).\n\nContinue anyway?`
  );
  if (ok) proceed();
}

function renderPreviewHtml(text) {
  return escapeHtml(text).replace(/\[([^\]]+)\]/g, (_, slot) => {
    const filled = writeState.slotValues[slot];
    if (filled) {
      return `<span class="slot filled" data-slot="${escapeAttr(slot)}" title="Edit">${escapeHtml(filled)}</span>`;
    }
    return `<span class="slot" data-slot="${escapeAttr(slot)}" title="Tap to fill">[${escapeHtml(slot)}]</span>`;
  });
}

function trailText() {
  const a = labelFor(templatesData.q1, writeState.q1);
  const b = labelFor(templatesData.q2[writeState.q1], writeState.q2);
  const c =
    writeState.q1 === "job_search"
      ? labelForAudience(writeState.q3)
      : labelFor(templatesData.q3, writeState.q3);
  return [a, b, c].filter(Boolean).join(" · ");
}

/* ── Phrases tab ── */

function renderPhrases() {
  const q = searchQuery();
  if (q.length >= 2) {
    renderPhraseSearch(q);
    return;
  }

  const favorites = new Set(settings.favoritePhrases || []);
  let html = "";

  if (favorites.size) {
    html += `<div class="favorites-section"><h3>★ Favorites</h3>`;
    for (const phrase of settings.favoritePhrases) {
      html += phraseRowHtml(phrase, "Favorites", true);
    }
    html += `</div>`;
  }

  html += `<div id="accordions"></div>`;
  main.innerHTML = html;

  const container = main.querySelector("#accordions");
  for (const cat of phrasesData.categories) {
    const acc = document.createElement("div");
    acc.className = "accordion";
    if (DEFAULT_OPEN_CATEGORIES.has(cat.id)) acc.classList.add("open");
    acc.innerHTML = `
      <button type="button" class="accordion-header">
        <span class="acc-title">${categoryIcon(cat.icon)}<span>${escapeHtml(cat.label)}</span></span>
        <span class="chevron">▼</span>
      </button>
      <div class="accordion-body"></div>
    `;
    const body = acc.querySelector(".accordion-body");
    let lastSection = "";
    for (const item of phrasesInCategory(cat)) {
      if (item.section && item.section !== lastSection) {
        body.insertAdjacentHTML(
          "beforeend",
          `<p class="section-label">${escapeHtml(item.section)}</p>`
        );
        lastSection = item.section;
      }
      body.insertAdjacentHTML(
        "beforeend",
        phraseRowHtml(item.phrase, cat.label, favorites.has(item.phrase))
      );
    }
    acc.querySelector(".accordion-header").onclick = () => {
      acc.classList.toggle("open");
    };
    container.appendChild(acc);
  }

  bindPhraseActions(main);
}

function phrasesInCategory(cat) {
  if (Array.isArray(cat.sections) && cat.sections.length) {
    return cat.sections.flatMap((section) =>
      (section.phrases || []).map((phrase) => ({ phrase, section: section.label }))
    );
  }
  return (cat.phrases || []).map((phrase) => ({ phrase, section: "" }));
}

function categoryIcon(name) {
  const body = CATEGORY_ICONS[name] || CATEGORY_ICONS.message;
  return `<svg class="cat-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function phraseRowHtml(phrase, categoryLabel, starred, showCategory = false) {
  const meta =
    showCategory && categoryLabel
      ? `<p class="result-meta">${escapeHtml(categoryLabel)}</p>`
      : "";
  return `
    <div class="phrase-row ${showCategory ? "result-card" : ""}" data-phrase="${escapeAttr(phrase)}">
      ${meta}
      <p class="phrase-text">${escapeHtml(phrase)}</p>
      <div class="phrase-actions">
        <button type="button" class="mini-btn star ${starred ? "on" : ""}" data-action="star" title="Favorite">${starred ? "★" : "☆"}</button>
        <button type="button" class="mini-btn" data-action="copy">Copy</button>
        <button type="button" class="mini-btn" data-action="insert">Insert</button>
      </div>
    </div>
  `;
}

function bindPhraseActions(root) {
  root.querySelectorAll(".phrase-row").forEach((row) => {
    const phrase = row.dataset.phrase;
    row.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        if (action === "copy") copyText(phrase);
        else if (action === "insert") insertText(phrase);
        else if (action === "star") {
          const favs = await toggleFavorite(phrase);
          settings.favoritePhrases = favs;
          if (activeTab === "phrases") renderPhrases();
          else render();
        }
      });
    });
  });
}

function renderPhraseSearch(q) {
  const results = fuzzySearch(q, phraseCorpus, 50);
  if (!results.length) {
    main.innerHTML = `<div class="empty-state">No phrases match “${escapeHtml(q)}”. Try a different word.</div>`;
    return;
  }

  const favorites = new Set(settings.favoritePhrases || []);
  main.innerHTML = `<p class="step-label">${results.length} matching phrase${results.length === 1 ? "" : "s"}</p><div id="results"></div>`;
  const resultsEl = main.querySelector("#results");
  for (const item of results) {
    resultsEl.insertAdjacentHTML(
      "beforeend",
      phraseRowHtml(item.phrase, item.categoryLabel, favorites.has(item.phrase), true)
    );
  }
  bindPhraseActions(main);
}

function renderWriteSearch(q) {
  const situations = fuzzySearch(q, writeCorpus, 8);
  const audiences = fuzzySearch(q, audienceCorpus, 5);
  if (!situations.length && !audiences.length) {
    main.innerHTML = `<div class="empty-state">No situations match “${escapeHtml(q)}”.</div>`;
    return;
  }

  const resume =
    writeState.draftText || writeState.step > 1
      ? `<p class="platform-hint">Clear the search to return to where you were.</p>`
      : "";

  main.innerHTML = `
    ${resume}
    ${situations.length ? `<p class="step-label">Situations</p><div class="chips" id="situation-hits"></div>` : ""}
    ${audiences.length ? `<p class="step-label">Who you're talking to</p><div class="chips" id="audience-hits"></div>` : ""}
  `;

  const situationBox = main.querySelector("#situation-hits");
  for (const item of situations) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.innerHTML = `<span class="result-meta">${escapeHtml(item.categoryLabel)}</span>${escapeHtml(item.phrase)}`;
    btn.addEventListener("click", () => {
      globalSearch.value = "";
      writeState.q1 = item.q1;
      writeState.q2 = item.q2;
      writeState.draftText = "";
      writeState.baseText = "";
      writeState.enhanced = false;
      writeState.enhancing = false;
      writeState.editingSlot = null;
      writeState.step = 3;
      writeState.preselectedFromPlatform = false;
      if (item.q1 === "job_search") writeState.q3 = writeState.q3 || "recruiter";
      render();
    });
    situationBox?.appendChild(btn);
  }

  const audienceBox = main.querySelector("#audience-hits");
  for (const item of audiences) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (item.q3 === writeState.q3 || item.q3 === settings.lastRelationship) btn.classList.add("selected");
    btn.textContent = item.phrase;
    btn.addEventListener("click", () => applyAudienceFromSearch(item.q3, item.jobAudience));
    audienceBox?.appendChild(btn);
  }
}

async function applyAudienceFromSearch(q3, jobAudience = false) {
  writeState.q3 = q3;
  globalSearch.value = "";
  if (jobAudience) {
    rewriteState.audience = q3;
    await persistToneAudience();
    if (writeState.q1 === "job_search" && writeState.q2) {
      await generateDraft();
      return;
    }
    writeState.q1 = "job_search";
    writeState.q2 = null;
    writeState.step = 2;
    writeState.tone = writeState.tone || rewriteState.tone || "formal";
    showToast("Audience saved — choose a job-search situation");
    render();
    return;
  }
  await saveSettings({ lastRelationship: q3 });
  settings.lastRelationship = q3;
  if (writeState.q1 && writeState.q2 && writeState.q1 !== "job_search") {
    await generateDraft();
    return;
  }
  showToast("Audience saved — choose a situation to draft");
  render();
}

function buildWriteCorpus(templates) {
  const keywords = {
    "reply:concern": ["sorry", "apologize", "complaint", "issue"],
    "reply:need_think": ["delay", "later", "hold", "think"],
    "reply:pushback": ["say no", "no", "pushback", "disagree"],
    "reply:followup_overdue": ["follow up", "nudge", "overdue", "reminder"],
    "reply:feedback": ["feedback", "thanks", "appreciate"],
    "reply:went_wrong": ["apologize", "sorry", "mistake", "wrong"],
    "new_email:intro": ["introduction", "cold", "reach out", "hello"],
    "new_email:request": ["request", "ask", "favor"],
    "new_email:schedule": ["meeting", "schedule", "calendar", "time"],
    "new_email:update": ["update", "status"],
    "new_email:news": ["bad news", "good news", "announce", "apologize"],
    "new_email:thanks": ["thank", "thanks", "grateful", "appreciate"],
    "linkedin:win": ["win", "milestone", "announce"],
    "linkedin:comment": ["comment", "reply", "post"],
    "linkedin:connect": ["connect", "network", "introduction"],
    "linkedin:insight": ["opinion", "insight", "thought"],
    "slack:status": ["status", "update"],
    "slack:request": ["request", "ask"],
    "slack:followup": ["follow up", "nudge", "ping"],
    "slack:problem": ["problem", "issue", "blocker"],
    "job_search:cold_recruiter": ["cold", "recruiter", "alum", "outreach", "introduce"],
    "job_search:info_interview": ["informational", "interview", "coffee", "15 minutes"],
    "job_search:thank_you": ["thank you", "thanks", "interview"],
    "job_search:recruiter_quiet": ["follow up", "ghost", "quiet", "recruiter"],
    "job_search:referral": ["referral", "refer", "recommend"],
    "job_search:negotiate_offer": ["offer", "negotiate", "salary", "deadline"],
    "job_search:decline_offer": ["decline", "reject", "no thanks", "offer"],
    "job_search:networking_followup": ["networking", "coffee chat", "event", "follow up"]
  };

  const out = [];
  for (const q1 of templates.q1 || []) {
    for (const situation of templates.q2?.[q1.id] || []) {
      const key = `${q1.id}:${situation.id}`;
      out.push({
        phrase: situation.label,
        categoryId: q1.id,
        categoryLabel: q1.label,
        keywords: keywords[key] || [],
        q1: q1.id,
        q2: situation.id
      });
    }
  }
  return out;
}

function buildAudienceCorpus(templates) {
  const keywords = {
    boss: ["manager", "senior", "leadership"],
    colleague: ["peer", "coworker"],
    junior: ["team", "report", "direct report"],
    client: ["customer", "partner", "external"],
    stranger: ["new", "cold", "haven't met"],
    recruiter: ["recruiter", "hiring", "manager"],
    manager: ["boss", "senior", "leadership"],
    professor: ["professor", "faculty", "teacher"],
    peer: ["colleague", "coworker"]
  };
  const fromTemplates = (templates.q3 || []).map((opt) => ({
    phrase: opt.label,
    categoryId: opt.id,
    categoryLabel: "Audience",
    keywords: keywords[opt.id] || [],
    q3: opt.id
  }));
  const jobAudiences = AUDIENCES.map((opt) => ({
    phrase: opt.label,
    categoryId: opt.id,
    categoryLabel: "Job search audience",
    keywords: keywords[opt.id] || [],
    q3: opt.id,
    jobAudience: true
  }));
  return [...fromTemplates, ...jobAudiences];
}

/* ── Shared helpers ── */

function makeChip(label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function labelFor(list, id) {
  return list?.find((x) => x.id === id)?.label || "";
}

function unique(arr) {
  return [...new Set(arr)];
}

async function copyAndRemember(text) {
  await copyText(text);
}

async function insertAndRemember(text) {
  await insertText(text);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copied");
  }
}

async function insertText(text) {
  // Refresh tab context — Pop out window is not a tab, so we must use stored Gmail/etc tabId
  try {
    const ctx = await getPanelContext();
    if (ctx) panelContext = ctx;
  } catch {
    /* keep existing */
  }

  const frameId =
    typeof pageSelectionFrameId === "number"
      ? pageSelectionFrameId
      : typeof panelContext?.frameId === "number"
        ? panelContext.frameId
        : undefined;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "INSERT_INTO_FIELD",
        text,
        tabId: panelContext?.tabId,
        frameId
      },
      async (res) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (res?.ok) {
          showToast("Inserted into page");
          resolve(true);
        } else {
          await copyText(text);
          showToast(runtimeError || res?.error || "Click in the text so the cursor is blinking, then Insert again");
          resolve(false);
        }
      }
    );
  });
}

function openInWindow() {
  chrome.runtime.sendMessage(
    {
      type: "OPEN_UI",
      mode: "window",
      tabId: panelContext?.tabId,
      platform: panelContext?.platform
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2000);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
