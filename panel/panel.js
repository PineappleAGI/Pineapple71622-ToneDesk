import { getSettings, saveSettings, toggleFavorite } from "../shared/storage.js";
import { fuzzySearch } from "../shared/fuzzy.js";
import { isBuiltInAiAvailable, enhanceWithBuiltInAi } from "../shared/ai.js";
import {
  getDraft,
  applySlotValues,
  extractSlots,
  applyVariant,
  flattenPhrases
} from "../shared/templates.js";

const main = document.getElementById("main");
const globalSearch = document.getElementById("global-search");

let phrasesData = null;
let templatesData = null;
let phraseCorpus = [];
let settings = null;
let activeTab = "write";
let panelContext = null;

/** Write flow state */
const writeState = {
  step: 1,
  q1: null,
  q2: null,
  q3: null,
  draftText: "",
  baseText: "",
  slots: [],
  slotValues: {},
  variant: "balanced",
  enhanced: false,
  enhancing: false,
  editingSlot: null
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

  document.getElementById("btn-close").addEventListener("click", closePanel);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  globalSearch.addEventListener("input", () => {
    const q = globalSearch.value.trim();
    if (q.length >= 2) {
      switchTab("search", { skipFocus: true });
      render();
    } else if (activeTab === "search" && !q) {
      render();
    }
  });

  globalSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      globalSearch.value = "";
      render();
    }
  });

  render();
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

function switchTab(tab, opts = {}) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((el) => {
    const on = el.dataset.tab === tab;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (tab === "search" && !opts.skipFocus) {
    globalSearch.focus();
  }
  render();
}

function render() {
  if (activeTab === "write") renderWrite();
  else if (activeTab === "phrases") renderPhrases();
  else renderSearch();
}

/* ── Write tab ── */

function renderWrite() {
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
      chips.appendChild(makeChip(opt.label, () => {
        writeState.q1 = opt.id;
        writeState.q2 = null;
        writeState.step = 2;
        render();
      }));
    }
    return;
  }

  if (writeState.step === 2) {
    const situations = templatesData.q2[writeState.q1] || [];
    const q1Label = labelFor(templatesData.q1, writeState.q1);
    main.innerHTML = `
      <div class="back-row">
        <button type="button" class="link-btn" id="btn-back">← Back</button>
      </div>
      <p class="answers-trail">${escapeHtml(q1Label)}</p>
      <p class="step-label">Step 2 of 3</p>
      <h2 class="question">What's the situation?</h2>
      <div class="chips" id="chips"></div>
    `;
    main.querySelector("#btn-back").onclick = () => {
      writeState.step = 1;
      writeState.q1 = null;
      render();
    };
    const chips = main.querySelector("#chips");
    for (const opt of situations) {
      chips.appendChild(makeChip(opt.label, () => {
        writeState.q2 = opt.id;
        writeState.step = 3;
        render();
      }));
    }
    return;
  }

  if (writeState.step === 3) {
    const q1Label = labelFor(templatesData.q1, writeState.q1);
    const q2Label = labelFor(templatesData.q2[writeState.q1], writeState.q2);
    main.innerHTML = `
      <div class="back-row">
        <button type="button" class="link-btn" id="btn-back">← Back</button>
      </div>
      <p class="answers-trail">${escapeHtml(q1Label)} · ${escapeHtml(q2Label)}</p>
      <p class="step-label">Step 3 of 3</p>
      <h2 class="question">Who are you talking to?</h2>
      <div class="chips" id="chips"></div>
    `;
    main.querySelector("#btn-back").onclick = () => {
      writeState.step = 2;
      writeState.q2 = null;
      render();
    };
    const chips = main.querySelector("#chips");
    for (const opt of templatesData.q3) {
      const chip = makeChip(opt.label, async () => {
        writeState.q3 = opt.id;
        await saveSettings({ lastRelationship: opt.id });
        settings.lastRelationship = opt.id;
        await generateDraft();
      });
      if (opt.id === writeState.q3 || opt.id === settings.lastRelationship) {
        chip.classList.add("selected");
      }
      chips.appendChild(chip);
    }
  }
}

async function generateDraft() {
  const result = getDraft(templatesData, writeState.q1, writeState.q2, writeState.q3);
  writeState.baseText = result.text;
  writeState.slots = unique([...result.slots, ...extractSlots(result.text)]);
  writeState.slotValues = {};
  writeState.variant = "balanced";
  writeState.enhanced = false;
  writeState.enhancing = isBuiltInAiAvailable();
  writeState.step = 4;
  writeState.draftText = applyVariant(result.text, writeState.variant, templatesData);
  renderDraft();

  if (isBuiltInAiAvailable()) {
    const { text, enhanced } = await enhanceWithBuiltInAi(writeState.draftText);
    writeState.enhancing = false;
    if (enhanced) {
      writeState.draftText = text;
      writeState.baseText = text;
      writeState.slots = extractSlots(text);
      writeState.enhanced = true;
    }
    if (activeTab === "write" && writeState.step === 4) renderDraft();
  }
}

function renderDraft() {
  const display = applySlotValues(writeState.draftText, writeState.slotValues);
  const badge = writeState.enhancing
    ? `<span class="badge">⏳ Enhancing…</span>`
    : writeState.enhanced
      ? `<span class="badge ai">✨ AI-enhanced</span>`
      : `<span class="badge template">📝 Template</span>`;

  main.innerHTML = `
    <div class="back-row">
      <button type="button" class="link-btn" id="btn-restart">← Start over</button>
      ${badge}
    </div>
    <p class="answers-trail">${escapeHtml(trailText())}</p>
    <div class="variant-row">
      <button type="button" class="variant-chip ${writeState.variant === "balanced" ? "active" : ""}" data-v="balanced">Balanced</button>
      <button type="button" class="variant-chip ${writeState.variant === "formal" ? "active" : ""}" data-v="formal">More formal</button>
      <button type="button" class="variant-chip ${writeState.variant === "shorter" ? "active" : ""}" data-v="shorter">Shorter</button>
      <button type="button" class="variant-chip ${writeState.variant === "warmer" ? "active" : ""}" data-v="warmer">Warmer</button>
    </div>
    <div class="preview-card" id="preview"></div>
    <div id="slot-editor"></div>
    <div class="actions">
      <button type="button" class="btn btn-secondary" id="btn-copy">Copy</button>
      <button type="button" class="btn btn-primary" id="btn-insert">Insert into page</button>
    </div>
  `;

  main.querySelector("#btn-restart").onclick = () => {
    writeState.step = 1;
    writeState.q1 = null;
    writeState.q2 = null;
    writeState.draftText = "";
    writeState.baseText = "";
    writeState.enhanced = false;
    writeState.enhancing = false;
    writeState.editingSlot = null;
    render();
  };

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
    const save = () => {
      const val = input.value.trim();
      if (val) writeState.slotValues[slot] = val;
      else delete writeState.slotValues[slot];
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
    copyText(finalText);
  };
  main.querySelector("#btn-insert").onclick = () => {
    const finalText = applySlotValues(writeState.draftText, writeState.slotValues);
    insertText(finalText);
  };
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
  const c = labelFor(templatesData.q3, writeState.q3);
  return [a, b, c].filter(Boolean).join(" · ");
}

/* ── Phrases tab ── */

function renderPhrases() {
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
    acc.innerHTML = `
      <button type="button" class="accordion-header">
        <span>${escapeHtml(cat.label)}</span>
        <span class="chevron">▼</span>
      </button>
      <div class="accordion-body"></div>
    `;
    const body = acc.querySelector(".accordion-body");
    for (const phrase of cat.phrases) {
      body.insertAdjacentHTML(
        "beforeend",
        phraseRowHtml(phrase, cat.label, favorites.has(phrase))
      );
    }
    acc.querySelector(".accordion-header").onclick = () => {
      acc.classList.toggle("open");
    };
    container.appendChild(acc);
  }

  // Open first accordion by default if no favorites focus
  if (!favorites.size) {
    container.querySelector(".accordion")?.classList.add("open");
  }

  bindPhraseActions(main);
}

function phraseRowHtml(phrase, categoryLabel, starred) {
  return `
    <div class="phrase-row" data-phrase="${escapeAttr(phrase)}">
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

/* ── Search tab ── */

function renderSearch() {
  const q = globalSearch.value.trim();
  if (!q) {
    main.innerHTML = `
      <div class="empty-state">
        Type in the search bar above to find phrases instantly.<br /><br />
        Try: <em>follow up</em>, <em>say no</em>, <em>apologize</em>, <em>request</em>
      </div>
    `;
    return;
  }

  const results = fuzzySearch(q, phraseCorpus, 5);
  if (!results.length) {
    main.innerHTML = `<div class="empty-state">No matches for “${escapeHtml(q)}”. Try a different word.</div>`;
    return;
  }

  const favorites = new Set(settings.favoritePhrases || []);
  main.innerHTML = `<p class="step-label">Top ${results.length} results</p><div id="results"></div>`;
  const resultsEl = main.querySelector("#results");
  for (const item of results) {
    resultsEl.insertAdjacentHTML(
      "beforeend",
      `
      <div class="phrase-row" data-phrase="${escapeAttr(item.phrase)}" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
        <p class="result-meta">${escapeHtml(item.categoryLabel)}</p>
        <p class="phrase-text">${escapeHtml(item.phrase)}</p>
        <div class="phrase-actions">
          <button type="button" class="mini-btn star ${favorites.has(item.phrase) ? "on" : ""}" data-action="star">${favorites.has(item.phrase) ? "★" : "☆"}</button>
          <button type="button" class="mini-btn" data-action="copy">Copy</button>
          <button type="button" class="mini-btn" data-action="insert">Insert</button>
        </div>
      </div>
      `
    );
  }
  bindPhraseActions(main);
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

function insertText(text) {
  chrome.runtime.sendMessage(
    {
      type: "INSERT_INTO_FIELD",
      text,
      tabId: panelContext?.tabId,
      frameId: panelContext?.frameId
    },
    (res) => {
      if (res?.ok) showToast("Inserted");
      else {
        copyText(text);
        showToast("Copied (insert unavailable)");
      }
    }
  );
}

function closePanel() {
  // Works for popup windows; side panel users can dismiss via Chrome UI
  try {
    window.close();
  } catch {
    /* ignore */
  }
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
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1600);
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
