/* ToneDesk — page launcher buttons. UI opens via side panel / window (not iframe). */

(() => {
  if (window.__tonedeskLoaded) return;
  window.__tonedeskLoaded = true;

  const BLUR_DELAY_MS = 300;

  let fab = null;
  let activeField = null;
  let lastEditable = null;
  let blurTimer = null;
  /** Kept when focus moves to the extension UI (selection often clears on panel open). */
  let lastSelection = "";

  init();

  function init() {
    createFab();
    bindFocusListeners();
    bindSelectionCache();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "INSERT_INTO_FIELD") {
        sendResponse({ ok: insertText(message.text), score: scoreEditable(lastEditable || activeField) });
        return true;
      }
      if (message.type === "GET_SELECTION") {
        const live = getSelectedText();
        const text = live || lastSelection || "";
        sendResponse({ ok: true, text });
        return true;
      }
      if (message.type === "CLEAR_SELECTION") {
        lastSelection = "";
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "PROBE_EDITABLE") {
        const el = bestEditableInFrame();
        sendResponse({
          ok: !!el,
          score: scoreEditable(el),
          hasLast: !!(lastEditable && document.contains(lastEditable))
        });
        return true;
      }
      return false;
    });
  }

  function bindSelectionCache() {
    let cacheTimer = null;
    const capture = () => {
      const text = getSelectedText();
      if (!text || text.length < 3) return;
      lastSelection = text;
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => {
        try {
          chrome.runtime.sendMessage({ type: "CACHE_SELECTION", text: lastSelection }, () => {
            void chrome.runtime.lastError;
          });
        } catch {
          /* ignore */
        }
      }, 80);
    };
    document.addEventListener("selectionchange", capture, true);
    document.addEventListener("mouseup", capture, true);
    document.addEventListener("keyup", capture, true);
  }

  function createFab() {
    if (fab) return;
    fab = document.createElement("button");
    fab.id = "tonedesk-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Open ToneDesk");
    fab.title = "Open ToneDesk";
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/brand.svg");
    img.alt = "";
    img.draggable = false;
    fab.appendChild(img);
    fab.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestOpen();
    });
    document.documentElement.appendChild(fab);
  }

  function requestOpen() {
    const platform = detectPlatform(location.hostname);
    try {
      chrome.runtime.sendMessage(
        { type: "OPEN_UI", platform, mode: "sidePanel" },
        (res) => {
          void chrome.runtime.lastError;
          if (!res?.ok) {
            chrome.runtime.sendMessage({ type: "OPEN_UI", platform, mode: "window" });
          }
        }
      );
    } catch {
      /* ignore */
    }
  }

  function bindFocusListeners() {
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("scroll", repositionFab, true);
    window.addEventListener("resize", repositionFab);
  }

  function onFocusIn(event) {
    const el = event.target;
    if (!isEditable(el)) return;
    if (el.closest("#tonedesk-fab")) return;
    clearTimeout(blurTimer);
    activeField = el;
    lastEditable = el;
    showFabNear(el);
    rememberFocus();
  }

  function rememberFocus() {
    try {
      chrome.runtime.sendMessage(
        {
          type: "CACHE_FOCUS",
          score: scoreEditable(lastEditable)
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      /* ignore */
    }
  }

  function onFocusOut() {
    blurTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (focused && isEditable(focused)) {
        activeField = focused;
        lastEditable = focused;
        showFabNear(focused);
        return;
      }
      hideFab();
      // Keep lastEditable — panel focus must not clear the compose target
    }, BLUR_DELAY_MS);
  }

  function isSensitiveField(el) {
    if (!el) return true;
    const type = (el.type || "").toLowerCase();
    if (["password", "hidden", "tel", "number"].includes(type)) return true;
    const name = (el.name || el.id || "").toLowerCase();
    if (/pass(word)?|secret|token|otp|cvv|ssn/.test(name)) return true;
    return false;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isSensitiveField(el)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return ["text", "search", "email", "url", ""].includes(type) && !el.disabled && !el.readOnly;
    }
    return false;
  }

  function showFabNear(el) {
    if (!fab) return;
    fab.classList.add("tonedesk-visible");
    positionFab(el);
  }

  function hideFab() {
    fab?.classList.remove("tonedesk-visible");
  }

  function positionFab(el) {
    if (!fab || !el) return;
    const rect = el.getBoundingClientRect();
    const size = 44;
    const gap = 8;
    let top = rect.bottom - size - gap;
    let left = rect.right - size - gap;
    if (rect.height < 60) {
      top = rect.bottom + gap;
      left = rect.right - size;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - size - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - size - 8));
    fab.style.top = `${Math.round(top)}px`;
    fab.style.left = `${Math.round(left)}px`;
  }

  function repositionFab() {
    if (activeField && fab?.classList.contains("tonedesk-visible")) {
      positionFab(activeField);
    }
  }

  function detectPlatform(host) {
    const h = (host || "").toLowerCase();
    if (h.includes("mail.google.com")) return "gmail";
    if (h.includes("linkedin.com")) return "linkedin";
    if (h.includes("slack.com")) return "slack";
    if (h.includes("whatsapp.com")) return "whatsapp";
    return "unknown";
  }

  function getSelectedText() {
    const sel = window.getSelection?.()?.toString()?.trim() || "";
    if (sel) return sel;

    const el =
      lastEditable && document.contains(lastEditable)
        ? lastEditable
        : activeField && document.contains(activeField)
          ? activeField
          : document.activeElement && isEditable(document.activeElement)
            ? document.activeElement
            : null;

    if (el && typeof el.selectionStart === "number" && typeof el.selectionEnd === "number") {
      const sliced = String(el.value || "").slice(el.selectionStart, el.selectionEnd).trim();
      if (sliced) return sliced;
    }
    return "";
  }

  function scoreEditable(el) {
    if (!el || !document.contains(el) || !isEditable(el)) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 18) return 0;

    let score = rect.width * rect.height;
    if (el.isContentEditable) score *= 4;
    if (el.tagName === "TEXTAREA") score *= 3;
    if (rect.height >= 60) score *= 2;

    const meta = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("role") || ""} ${el.className || ""} ${el.id || ""}`.toLowerCase();
    if (/compos|message|msg-form|ql-editor|lexical|ProseMirror|editor|chat-input|msg_input/.test(meta)) {
      score *= 5;
    }
    // Penalize search / filter boxes
    if (/search|filter|query/.test(meta) || (el.tagName === "INPUT" && (el.type || "") === "search")) {
      score *= 0.05;
    }
    if (el === lastEditable) score *= 3;
    return score;
  }

  function bestEditableInFrame() {
    if (lastEditable && document.contains(lastEditable) && isEditable(lastEditable)) {
      return lastEditable;
    }
    if (activeField && document.contains(activeField) && isEditable(activeField)) {
      return activeField;
    }
    const focused = document.activeElement;
    if (isEditable(focused)) return focused;

    let best = null;
    let bestScore = 0;
    const nodes = document.querySelectorAll(
      '[contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input:not([type])'
    );
    for (const el of nodes) {
      const s = scoreEditable(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function insertText(text) {
    const value = String(text || "");
    if (!value) return false;
    const el = bestEditableInFrame();
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) return insertIntoContentEditable(el, value);
    return insertIntoInput(el, value);
  }

  function insertIntoInput(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    try {
      el.setSelectionRange(start + text.length, start + text.length);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function insertIntoContentEditable(el, text) {
    el.focus();
    const selection = window.getSelection();
    try {
      if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } catch {
      /* ignore */
    }

    if (document.execCommand("insertText", false, text)) {
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      );
      return true;
    }

    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
        );
        return true;
      }
    } catch {
      /* fall through */
    }

    el.textContent =
      el.textContent.trim() === "" ? text : `${el.textContent.trim()}\n\n${text}`;
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    );
    return true;
  }
})();
