import { getSettings, saveSettings, detectPlatform } from "../shared/storage.js";

async function enableSidePanelOnClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    /* older Chromium */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnClick();
  purgeLegacyDiskCache();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelOnClick();
  purgeLegacyDiskCache();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

enableSidePanelOnClick();
injectCaretTrackers();

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "rewrite-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.storage.session.set({
      pendingRewrite: { tabId: tab.id, at: Date.now() }
    });
  } catch {
    /* ignore */
  }
  await openUi({
    tabId: tab.id,
    platform: tab.url ? detectPlatform(tab.url) : "unknown",
    mode: "panel"
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };

    case "SAVE_SETTINGS":
      await saveSettings(message.payload || {});
      return { ok: true, settings: await getSettings() };

    case "OPEN_UI":
    case "OPEN_PANEL_FROM_ACTION":
      return openUi({
        tabId: message.tabId || sender.tab?.id,
        frameId: typeof sender.frameId === "number" ? sender.frameId : message.frameId,
        platform: message.platform,
        mode: message.mode
      });

    case "REGISTER_PANEL_CONTEXT": {
      const tabId = sender.tab?.id || message.tabId;
      if (!tabId) return { ok: false };
      await savePanelContext({
        platform: message.platform || "unknown",
        tabId,
        frameId: typeof sender.frameId === "number" ? sender.frameId : 0
      });
      return { ok: true, tabId };
    }

    case "GET_PANEL_CONTEXT": {
      const tabId = message.tabId || (await getActiveTabId());
      const context = await refreshPanelContext(tabId);
      return { ok: true, context, tabId };
    }

    case "CACHE_SELECTION": {
      const tabId = sender.tab?.id || message.tabId;
      const text = String(message.text || "").trim();
      if (!tabId || text.length < 3) return { ok: false };
      await saveSelectionCache(tabId, {
        text,
        frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
        at: Date.now()
      });
      // Selection usually means the compose frame — remember it for Insert
      await saveFocusCache(tabId, {
        frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
        score: Number(message.score) || 1,
        at: Date.now()
      });
      return { ok: true };
    }

    case "CLEAR_SELECTION": {
      const tabId = message.tabId || sender.tab?.id || (await getActiveTabId());
      if (!tabId) return { ok: false, error: "No active tab" };
      await clearSelectionCache(tabId);
      // Wipe content-script in-memory lastSelection across frames
      await broadcastToFrames(tabId, { type: "CLEAR_SELECTION" });
      return { ok: true };
    }

    case "CACHE_FOCUS": {
      const tabId = sender.tab?.id || message.tabId;
      if (!tabId) return { ok: false };
      const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
      await saveFocusCache(tabId, {
        frameId,
        score: Number(message.score) || 1,
        at: Date.now()
      });
      const existing = await loadPanelContext(tabId);
      await savePanelContext({
        platform: existing?.platform || "unknown",
        tabId,
        frameId,
        url: existing?.url || ""
      });
      return { ok: true };
    }

    case "GET_SELECTION": {
      const tabId = message.tabId || (await getActiveTabId());
      if (!tabId) return { ok: false, text: "", error: "No active tab" };
      return getSelectionForTab(tabId, message.frameId);
    }

    case "CACHE_POINTER": {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: false };
      await savePointerCache(tabId, {
        x: Number(message.x) || 0,
        y: Number(message.y) || 0,
        at: Number(message.at) || Date.now(),
        frameId: typeof sender.frameId === "number" ? sender.frameId : 0
      });
      return { ok: true };
    }

    case "INSERT_INTO_FIELD": {
      const tabId = message.tabId || sender.tab?.id || (await getActiveTabId());
      if (!tabId) return { ok: false, error: "No active tab" };
      return insertIntoTab(tabId, message.text, message.frameId);
    }

    default:
      return { ok: false, error: `Unknown message: ${message.type}` };
  }
}

async function getSelectionForTab(tabId, preferredFrameId) {
  // 1) Live read across ALL frames (Gmail compose is often an iframe)
  const live = await readLiveSelectionAllFrames(tabId);
  if (live?.text) {
    await saveSelectionCache(tabId, {
      text: live.text,
      frameId: live.frameId ?? 0,
      at: Date.now()
    });
    return { ok: true, text: live.text, frameId: live.frameId ?? 0, source: "live" };
  }

  // 2) Ask content scripts (includes their in-memory lastSelection)
  const fromCs = await querySelectionFromContentScripts(tabId, preferredFrameId);
  if (fromCs?.text) {
    await saveSelectionCache(tabId, {
      text: fromCs.text,
      frameId: fromCs.frameId ?? 0,
      at: Date.now()
    });
    return { ok: true, text: fromCs.text, frameId: fromCs.frameId ?? 0, source: "content" };
  }

  // 3) Session cache — survives panel open clearing the highlight
  const cached = await loadSelectionCache(tabId);
  if (cached?.text) {
    return {
      ok: true,
      text: cached.text,
      frameId: cached.frameId ?? 0,
      source: "cache"
    };
  }

  return { ok: true, text: "", frameId: 0 };
}

async function readLiveSelectionAllFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const sel = window.getSelection?.()?.toString()?.trim() || "";
        if (sel) return sel;
        const el = document.activeElement;
        if (
          el &&
          typeof el.selectionStart === "number" &&
          typeof el.selectionEnd === "number" &&
          el.selectionStart !== el.selectionEnd
        ) {
          return String(el.value || "").slice(el.selectionStart, el.selectionEnd).trim();
        }
        return "";
      }
    });
    for (const row of results || []) {
      const text = String(row?.result || "").trim();
      if (text.length >= 3) {
        return { text, frameId: row.frameId };
      }
    }
  } catch {
    /* tab may not allow scripting */
  }
  return null;
}

async function querySelectionFromContentScripts(tabId, preferredFrameId) {
  const tryFrame = async (frameId) => {
    try {
      const opts = typeof frameId === "number" ? { frameId } : undefined;
      const res = opts
        ? await chrome.tabs.sendMessage(tabId, { type: "GET_SELECTION" }, opts)
        : await chrome.tabs.sendMessage(tabId, { type: "GET_SELECTION" });
      const text = String(res?.text || "").trim();
      if (text.length >= 3) return { text, frameId: frameId ?? 0 };
    } catch {
      /* frame missing content script */
    }
    return null;
  };

  if (typeof preferredFrameId === "number") {
    const hit = await tryFrame(preferredFrameId);
    if (hit) return hit;
  }

  // Probe common frame ids (0 = top). Gmail often uses higher ids; scripting path covers those.
  for (const frameId of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    if (frameId === preferredFrameId) continue;
    const hit = await tryFrame(frameId);
    if (hit) return hit;
  }
  return null;
}

async function insertIntoTab(tabId, text, preferredFrameId) {
  const value = String(text || "");
  if (!value.trim()) return { ok: false, error: "Empty text" };

  await ensureCaretTracker(tabId);
  const atCaret = await insertWhereCaretIs(tabId, value);
  if (atCaret?.ok) return atCaret;

  const pointer = await loadPointerCache(tabId);
  if (pointer && Date.now() - Number(pointer.at || 0) < 10 * 60 * 1000) {
    const pointed = await insertInFrame(tabId, value, pointer.frameId);
    if (pointed?.ok) return pointed;
    const atPoint = await insertAtPointer(tabId, value, pointer);
    if (atPoint?.ok) return atPoint;
  }

  const focus = await loadFocusCache(tabId);
  const sel = await loadSelectionCache(tabId);
  const preferred =
    typeof preferredFrameId === "number"
      ? preferredFrameId
      : typeof focus?.frameId === "number"
        ? focus.frameId
        : typeof sel?.frameId === "number"
          ? sel.frameId
          : undefined;

  // 1) Probe frames for the best compose target, then insert only there
  const targetFrame = await findBestInsertFrame(tabId, preferred);
  if (typeof targetFrame === "number") {
    const sent = await insertInFrame(tabId, value, targetFrame);
    if (sent?.ok) return sent;
  }

  // 2) Direct scripting insert across frames (works even if CS message fails)
  const scripted = await insertViaScripting(tabId, value, preferred);
  if (scripted?.ok) return scripted;

  return { ok: false, error: "Click in the text so the cursor is blinking, then Insert again" };
}

async function ensureCaretTracker(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/content.js"]
    });
  } catch {
    /* page may block injection */
  }
}

async function injectCaretTrackers() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/i.test(tab.url || "")) continue;
      ensureCaretTracker(tab.id);
    }
  } catch {
    /* ignore */
  }
}

function caretProbe() {
  const findMarked = (root) => {
    if (!root?.querySelector) return null;
    const direct = root.querySelector("[data-tonedesk-caret='1']");
    if (direct) return direct;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const hit = findMarked(el.shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  };
  const marked = findMarked(document);
  const at = marked ? Number(marked.getAttribute("data-tonedesk-at")) || 1 : 0;
  const active = document.activeElement;
  const live =
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT");
  return { ready: !!(marked || live), at: live ? Date.now() : at };
}

function caretCommit(value) {
  const SKIP = new Set(["password", "hidden", "file", "checkbox", "radio", "button", "submit", "reset"]);
  const isField = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const type = (el.type || "").toLowerCase();
    if (SKIP.has(type)) return false;
    const name = `${el.name || ""} ${el.id || ""}`.toLowerCase();
    if (/pass(word)?|secret|token|otp|cvv|ssn/.test(name)) return false;
    const ce = el.getAttribute?.("contenteditable");
    if (el.isContentEditable || ce === "" || ce === "true" || ce === "plaintext-only") return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return !el.disabled && !el.readOnly;
    return false;
  };
  const findMarked = (root) => {
    if (!root?.querySelector) return null;
    const direct = root.querySelector("[data-tonedesk-caret='1']");
    if (direct) return direct;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const hit = findMarked(el.shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  };
  const walk = (node) => {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    while (el) {
      if (isField(el)) return el;
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    return null;
  };
  const placeOffset = (field, offset) => {
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let left = offset;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent.length;
      if (left <= len) {
        const range = document.createRange();
        range.setStart(node, left);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      left -= len;
      node = walker.nextNode();
    }
  };

  let field = findMarked(document);
  const sel = window.getSelection();
  if (!field && sel?.anchorNode) field = walk(sel.anchorNode);
  if (!field) field = walk(document.activeElement);
  if (!field) return { ok: false };

  const at = Number(field.getAttribute?.("data-tonedesk-at")) || Date.now();
  const pageHadFocus = document.hasFocus();
  field.focus();

  if (typeof field.selectionStart === "number") {
    let start = field.selectionStart ?? 0;
    let end = field.selectionEnd ?? start;
    const savedStart = field.getAttribute?.("data-tonedesk-start");
    if (savedStart != null && !pageHadFocus) {
      start = Number(savedStart);
      end = Number(field.getAttribute("data-tonedesk-end") ?? savedStart);
    }
    const next = String(field.value || "").slice(0, start) + value + String(field.value || "").slice(end);
    const proto = field.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(field, next);
    else field.value = next;
    const caret = start + value.length;
    try { field.setSelectionRange(caret, caret); } catch { /* ignore */ }
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return { ok: true, at };
  }

  const savedOffset = field.getAttribute?.("data-tonedesk-offset");
  const live = window.getSelection();
  const selectionInside = live?.anchorNode && (field === live.anchorNode || field.contains(live.anchorNode));
  if (savedOffset != null && (!pageHadFocus || !selectionInside)) placeOffset(field, Number(savedOffset));

  if (document.execCommand("insertText", false, value)) {
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return { ok: true, at };
  }
  try {
    const live = window.getSelection();
    if (live?.rangeCount) {
      const range = live.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(value);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      live.removeAllRanges();
      live.addRange(range);
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return { ok: true, at };
    }
  } catch {
    /* ignore */
  }
  return { ok: false };
}

async function insertWhereCaretIs(tabId, text) {
  let probes = [];
  try {
    probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: caretProbe
    });
  } catch {
    return { ok: false };
  }

  const ranked = (probes || [])
    .filter((row) => row?.result?.ready && typeof row.frameId === "number")
    .sort((a, b) => (b.result.at || 0) - (a.result.at || 0));
  if (!ranked.length) return { ok: false };

  try {
    const rows = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [ranked[0].frameId] },
      func: caretCommit,
      args: [text]
    });
    if (rows?.[0]?.result?.ok) return { ok: true, frameId: ranked[0].frameId, via: "caret" };
  } catch {
    /* ignore */
  }
  return { ok: false };
}

async function insertInFrame(tabId, text, frameId) {
  if (typeof frameId !== "number") return { ok: false };
  try {
    const res = await chrome.tabs.sendMessage(
      tabId,
      { type: "INSERT_INTO_FIELD", text },
      { frameId }
    );
    if (res?.ok) {
      await saveFocusCache(tabId, { frameId, score: res.score || 1, at: Date.now() });
      return { ok: true, frameId };
    }
  } catch {
    /* frame has no content script */
  }
  return { ok: false };
}

async function insertAtPointer(tabId, text, pointer) {
  if (typeof pointer?.frameId !== "number") return { ok: false };
  try {
    const rows = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [pointer.frameId] },
      func: (value, x, y) => {
        const isSensitive = (el) => {
          const type = (el.type || "").toLowerCase();
          if (["password", "hidden", "file", "checkbox", "radio"].includes(type)) return true;
          const name = (el.name || el.id || "").toLowerCase();
          return /pass(word)?|secret|token|otp|cvv|ssn/.test(name);
        };
        const resolveField = (el) => {
          if (!el || el.nodeType !== 1 || isSensitive(el)) return null;
          const ceAttr = el.getAttribute?.("contenteditable");
          const ce = (ceAttr || "").toLowerCase();
          if (el.isContentEditable || ce === "true" || ce === "plaintext-only" || ceAttr === "") return el;
          if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly ? el : null;
          if (el.tagName === "INPUT") {
            const type = (el.type || "text").toLowerCase();
            if (["password", "hidden", "file", "checkbox", "radio", "button", "submit", "reset"].includes(type)) {
              return null;
            }
            return !el.disabled && !el.readOnly ? el : null;
          }
          return null;
        };
        const fromNode = (node) => {
          let el = node?.nodeType === 1 ? node : node?.parentElement;
          while (el) {
            const field = resolveField(el);
            if (field) return field;
            el = el.parentElement;
          }
          return null;
        };
        let host = document.elementFromPoint(x, y);
        let field = fromNode(host);
        if (!field && host?.shadowRoot?.elementFromPoint) {
          field = fromNode(host.shadowRoot.elementFromPoint(x, y));
        }
        if (!field) {
          const pos = document.caretPositionFromPoint?.(x, y);
          if (pos?.offsetNode) field = fromNode(pos.offsetNode);
        }
        if (!field) return { ok: false };
        field.focus();
        if (field.isContentEditable) {
          try {
            const pos = document.caretPositionFromPoint?.(x, y);
            const sel = window.getSelection();
            if (pos?.offsetNode && sel && (field === pos.offsetNode || field.contains(pos.offsetNode))) {
              const range = document.createRange();
              range.setStart(pos.offsetNode, pos.offset);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch {
            /* ignore */
          }
          if (document.execCommand("insertText", false, value)) return { ok: true };
        }
        if (typeof field.selectionStart === "number") {
          const start = field.selectionStart ?? field.value.length;
          const end = field.selectionEnd ?? field.value.length;
          const next = field.value.slice(0, start) + value + field.value.slice(end);
          const proto =
            field.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(field, next);
          else field.value = next;
          try {
            field.setSelectionRange(start + value.length, start + value.length);
          } catch {
            /* ignore */
          }
          field.dispatchEvent(new Event("input", { bubbles: true }));
          return { ok: true };
        }
        return { ok: false };
      },
      args: [text, pointer.x, pointer.y]
    });
    if (rows?.[0]?.result?.ok) return { ok: true, frameId: pointer.frameId, via: "pointer" };
  } catch {
    /* ignore */
  }
  return { ok: false };
}

async function findBestInsertFrame(tabId, preferredFrameId) {
  let bestFrame = typeof preferredFrameId === "number" ? preferredFrameId : null;
  let bestScore = 0;

  // Prefer scripting probe — covers all frames including Gmail compose iframes
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isSensitive = (el) => {
          const type = (el.type || "").toLowerCase();
          if (["password", "hidden", "tel", "number"].includes(type)) return true;
          const name = (el.name || el.id || "").toLowerCase();
          return /pass(word)?|secret|token|otp|cvv|ssn/.test(name);
        };
        const isEditable = (el) => {
          if (!el || el.nodeType !== 1 || isSensitive(el)) return false;
          if (el.isContentEditable) return true;
          if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
          if (el.tagName === "INPUT") {
            const type = (el.type || "text").toLowerCase();
            return ["text", "search", "email", "url", ""].includes(type) && !el.disabled && !el.readOnly;
          }
          return false;
        };
        let best = 0;
        for (const el of document.querySelectorAll(
          '[contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input:not([type])'
        )) {
          if (!isEditable(el)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 18) continue;
          let score = rect.width * rect.height;
          if (el.isContentEditable) score *= 4;
          if (el.tagName === "TEXTAREA") score *= 3;
          if (rect.height >= 60) score *= 2;
          const meta = `${el.getAttribute("aria-label") || ""} ${el.className || ""}`.toLowerCase();
          if (/compos|message|ql-editor|lexical|editor|chat-input/.test(meta)) score *= 5;
          if (/search|filter/.test(meta)) score *= 0.05;
          if (score > best) best = score;
        }
        return best;
      }
    });
    for (const row of results || []) {
      const score = Number(row?.result) || 0;
      // Prefer remembered frame when scores are close
      const bias = row.frameId === preferredFrameId ? score * 0.15 : 0;
      const total = score + bias;
      if (total > bestScore) {
        bestScore = total;
        bestFrame = row.frameId;
      }
    }
  } catch {
    /* ignore */
  }

  return bestScore > 0 ? bestFrame : preferredFrameId;
}

async function insertViaScripting(tabId, text, preferredFrameId) {
  const insertFn = (value) => {
    const isSensitive = (el) => {
      const type = (el.type || "").toLowerCase();
      if (["password", "hidden", "tel", "number"].includes(type)) return true;
      const name = (el.name || el.id || "").toLowerCase();
      return /pass(word)?|secret|token|otp|cvv|ssn/.test(name);
    };
    const isEditable = (el) => {
      if (!el || el.nodeType !== 1 || isSensitive(el)) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
      if (el.tagName === "INPUT") {
        const type = (el.type || "text").toLowerCase();
        return ["text", "search", "email", "url", ""].includes(type) && !el.disabled && !el.readOnly;
      }
      return false;
    };
    const scoreEditable = (el) => {
      if (!isEditable(el)) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 18) return 0;
      let score = rect.width * rect.height;
      if (el.isContentEditable) score *= 4;
      if (el.tagName === "TEXTAREA") score *= 3;
      if (rect.height >= 60) score *= 2;
      const meta = `${el.getAttribute("aria-label") || ""} ${el.className || ""}`.toLowerCase();
      if (/compos|message|ql-editor|lexical|editor|chat-input/.test(meta)) score *= 5;
      if (/search|filter/.test(meta)) score *= 0.05;
      return score;
    };

    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll(
      '[contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input:not([type])'
    )) {
      const s = scoreEditable(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    if (!best) return { ok: false, score: 0 };

    best.focus();
    if (best.isContentEditable) {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(best);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        /* ignore */
      }
      if (document.execCommand("insertText", false, value)) {
        best.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
        );
        return { ok: true, score: bestScore };
      }
      best.textContent =
        best.textContent.trim() === "" ? value : `${best.textContent.trim()}\n\n${value}`;
      best.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
      );
      return { ok: true, score: bestScore };
    }

    const start = best.selectionStart ?? best.value.length;
    const end = best.selectionEnd ?? best.value.length;
    const next = best.value.slice(0, start) + value + best.value.slice(end);
    const proto =
      best.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(best, next);
    else best.value = next;
    try {
      best.setSelectionRange(start + value.length, start + value.length);
    } catch {
      /* ignore */
    }
    best.dispatchEvent(new Event("input", { bubbles: true }));
    best.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, score: bestScore };
  };

  // If we have a preferred frame, try it first; else score all frames and insert in the best one only
  if (typeof preferredFrameId === "number") {
    try {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [preferredFrameId] },
        func: insertFn,
        args: [text]
      });
      if (rows?.[0]?.result?.ok) {
        return { ok: true, frameId: preferredFrameId, via: "script" };
      }
    } catch {
      /* try all frames */
    }
  }

  try {
    const probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isSensitive = (el) => {
          const type = (el.type || "").toLowerCase();
          if (["password", "hidden", "tel", "number"].includes(type)) return true;
          const name = (el.name || el.id || "").toLowerCase();
          return /pass(word)?|secret|token|otp|cvv|ssn/.test(name);
        };
        const isEditable = (el) => {
          if (!el || el.nodeType !== 1 || isSensitive(el)) return false;
          if (el.isContentEditable) return true;
          if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
          if (el.tagName === "INPUT") {
            const type = (el.type || "text").toLowerCase();
            return ["text", "search", "email", "url", ""].includes(type) && !el.disabled && !el.readOnly;
          }
          return false;
        };
        let best = 0;
        for (const el of document.querySelectorAll(
          '[contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input:not([type])'
        )) {
          if (!isEditable(el)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 18) continue;
          let score = rect.width * rect.height;
          if (el.isContentEditable) score *= 4;
          if (rect.height >= 60) score *= 2;
          const meta = `${el.getAttribute("aria-label") || ""} ${el.className || ""}`.toLowerCase();
          if (/compos|message|ql-editor|lexical|editor|chat-input/.test(meta)) score *= 5;
          if (/search|filter/.test(meta)) score *= 0.05;
          if (score > best) best = score;
        }
        return best;
      }
    });

    let bestFrame = null;
    let bestScore = 0;
    for (const row of probes || []) {
      const score = Number(row?.result) || 0;
      if (score > bestScore) {
        bestScore = score;
        bestFrame = row.frameId;
      }
    }
    if (bestFrame == null || bestScore <= 0) return { ok: false };

    const rows = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [bestFrame] },
      func: insertFn,
      args: [text]
    });
    if (rows?.[0]?.result?.ok) {
      await saveFocusCache(tabId, { frameId: bestFrame, score: bestScore, at: Date.now() });
      return { ok: true, frameId: bestFrame, via: "script" };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  return { ok: false, error: "Click in the text so the cursor is blinking, then Insert again" };
}

/* Message text never touches disk — session storage only, cleared when Chrome closes. */

async function savePointerCache(tabId, payload) {
  try {
    await chrome.storage.session.set({ [`ptr:${tabId}`]: payload });
  } catch {
    /* ignore */
  }
}

async function loadPointerCache(tabId) {
  try {
    const data = await chrome.storage.session.get(`ptr:${tabId}`);
    const saved = data[`ptr:${tabId}`];
    return typeof saved?.frameId === "number" ? saved : null;
  } catch {
    return null;
  }
}

async function saveSelectionCache(tabId, payload) {
  try {
    await chrome.storage.session.set({ [`sel:${tabId}`]: payload });
  } catch {
    /* no session storage — skip caching rather than persisting user text */
  }
}

async function loadSelectionCache(tabId) {
  try {
    const data = await chrome.storage.session.get(`sel:${tabId}`);
    return data[`sel:${tabId}`]?.text ? data[`sel:${tabId}`] : null;
  } catch {
    return null;
  }
}

async function clearSelectionCache(tabId) {
  try {
    await chrome.storage.session.remove(`sel:${tabId}`);
  } catch {
    /* ignore */
  }
}

async function broadcastToFrames(tabId, payload) {
  const jobs = [];
  for (let frameId = 0; frameId < 40; frameId++) {
    jobs.push(
      chrome.tabs.sendMessage(tabId, payload, { frameId }).catch(() => null)
    );
  }
  await Promise.all(jobs);
}

async function saveFocusCache(tabId, payload) {
  try {
    await chrome.storage.session.set({ [`focus:${tabId}`]: payload });
  } catch {
    /* ignore */
  }
}

async function loadFocusCache(tabId) {
  try {
    const data = await chrome.storage.session.get(`focus:${tabId}`);
    return data[`focus:${tabId}`] || null;
  } catch {
    return null;
  }
}

async function openUi({ tabId, frameId, platform, mode } = {}) {
  const resolvedTabId = tabId || (await getActiveTabId());
  const tab = resolvedTabId ? await chrome.tabs.get(resolvedTabId).catch(() => null) : null;
  const resolvedPlatform = platform || (tab?.url ? detectPlatform(tab.url) : "unknown");

  if (resolvedTabId) {
    await savePanelContext({
      platform: resolvedPlatform,
      tabId: resolvedTabId,
      frameId: typeof frameId === "number" ? frameId : 0
    });
  }

  if (mode === "window") {
    await chrome.windows.create({
      url: "panel/panel.html",
      type: "popup",
      width: 380,
      height: 680,
      focused: true
    });
    return { ok: true, mode: "window" };
  }

  if (resolvedTabId) {
    try {
      await chrome.sidePanel.setOptions({
        tabId: resolvedTabId,
        path: "panel/panel.html",
        enabled: true
      });
      await chrome.sidePanel.open({ tabId: resolvedTabId });
      return { ok: true, mode: "sidePanel" };
    } catch (err) {
      console.warn("sidePanel.open failed, falling back to window", err);
    }
  }

  await chrome.windows.create({
    url: "panel/panel.html",
    type: "popup",
    width: 380,
    height: 680,
    focused: true
  });
  return { ok: true, mode: "window" };
}

async function refreshPanelContext(tabId) {
  const existing = tabId ? await loadPanelContext(tabId) : null;
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const platform = tab?.url ? detectPlatform(tab.url) : existing?.platform || "unknown";
  const payload = {
    platform,
    tabId: tabId || existing?.tabId || null,
    frameId: typeof existing?.frameId === "number" ? existing.frameId : 0,
    url: tab?.url || existing?.url || ""
  };
  if (payload.tabId) await savePanelContext(payload);
  return payload;
}

async function savePanelContext(ctx) {
  const payload = { ...ctx, openedAt: Date.now() };
  try {
    await chrome.storage.session.set({
      [`panelContext:${ctx.tabId}`]: payload,
      lastPanelContext: payload
    });
  } catch {
    /* ignore */
  }
}

async function loadPanelContext(tabId) {
  try {
    const data = await chrome.storage.session.get([`panelContext:${tabId}`, "lastPanelContext"]);
    return data[`panelContext:${tabId}`] || data.lastPanelContext || null;
  } catch {
    return null;
  }
}

async function clearTabState(tabId) {
  try {
    await chrome.storage.session.remove([
      `sel:${tabId}`,
      `focus:${tabId}`,
      `ptr:${tabId}`,
      `panelContext:${tabId}`
    ]);
  } catch {
    /* ignore */
  }
}

/** Purge user text written to disk by earlier versions. */
async function purgeLegacyDiskCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter(
      (key) =>
        key.startsWith("sel:") ||
        key.startsWith("focus:") ||
        key.startsWith("panelContext:") ||
        key === "lastPanelContext" ||
        key === "recentDrafts"
    );
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch {
    /* ignore */
  }
}

async function getActiveTabId() {
  // Prefer last known host tab (Pop out window has no tabs of its own)
  let cachedId = null;
  try {
    const last = await chrome.storage.session.get("lastPanelContext");
    cachedId = last.lastPanelContext?.tabId || null;
  } catch {
    /* ignore */
  }
  if (cachedId) {
    try {
      const tab = await chrome.tabs.get(cachedId);
      if (tab?.id) return tab.id;
    } catch {
      /* stale */
    }
  }

  const inWindow = await chrome.tabs.query({ active: true, currentWindow: true });
  if (inWindow[0]?.id && !inWindow[0].url?.startsWith("chrome-extension://")) {
    return inWindow[0].id;
  }

  const any = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (any[0]?.id && !any[0].url?.startsWith("chrome-extension://")) {
    return any[0].id;
  }

  const hosts = await chrome.tabs.query({
    url: [
      "https://mail.google.com/*",
      "https://*.linkedin.com/*",
      "https://web.whatsapp.com/*",
      "https://app.slack.com/*"
    ]
  });
  const focused = hosts.find((t) => t.active) || hosts[0];
  return focused?.id || null;
}
