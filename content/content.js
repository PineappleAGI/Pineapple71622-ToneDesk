/* ToneDesk — page launcher buttons. UI opens via side panel / window (not iframe). */

/* Remembers the blinking caret so Insert can paste there after the panel takes focus. */
(() => {
  if (window.__tonedeskCaretMark === 2) return;
  window.__tonedeskCaretMark = 2;

  const SKIP = new Set(["password", "hidden", "file", "checkbox", "radio", "button", "submit", "reset", "image", "range", "color"]);

  function fieldFrom(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    while (el && el !== document.documentElement) {
      if (el.id === "tonedesk-fab") return null;
      const type = (el.type || "").toLowerCase();
      const name = `${el.name || ""} ${el.id || ""}`.toLowerCase();
      if (SKIP.has(type) || /pass(word)?|secret|token|otp|cvv|ssn/.test(name)) return null;
      const ce = el.getAttribute?.("contenteditable");
      if (el.isContentEditable || ce === "" || ce === "true" || ce === "plaintext-only") return el;
      if (el.tagName === "TEXTAREA" && !el.disabled && !el.readOnly) return el;
      if (el.tagName === "INPUT" && !el.disabled && !el.readOnly && !SKIP.has(type || "text")) return el;
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    return null;
  }

  function caretOffset(field) {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !field.contains(sel.anchorNode)) return null;
    try {
      const range = sel.getRangeAt(0);
      const pre = range.cloneRange();
      pre.selectNodeContents(field);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    } catch {
      return null;
    }
  }

  function mark(field) {
    if (!field || !field.setAttribute) return;
    const root = field.getRootNode?.() || document;
    root.querySelectorAll?.("[data-tonedesk-caret]").forEach((el) => {
      if (el !== field) el.removeAttribute("data-tonedesk-caret");
    });
    field.setAttribute("data-tonedesk-caret", "1");
    field.setAttribute("data-tonedesk-at", String(Date.now()));
    if (typeof field.selectionStart === "number") {
      field.setAttribute("data-tonedesk-start", String(field.selectionStart));
      field.setAttribute("data-tonedesk-end", String(field.selectionEnd ?? field.selectionStart));
    } else {
      const offset = caretOffset(field);
      if (offset != null) field.setAttribute("data-tonedesk-offset", String(offset));
    }
  }

  function captureFrom(event) {
    const path = event?.composedPath?.() || [];
    for (const node of path) {
      const field = fieldFrom(node);
      if (field) {
        mark(field);
        return;
      }
    }
    const direct = fieldFrom(event?.target) || fieldFrom(document.activeElement);
    if (direct) mark(direct);
  }

  document.addEventListener("focusin", captureFrom, true);
  document.addEventListener("focusout", captureFrom, true);
  document.addEventListener("pointerdown", captureFrom, true);
  document.addEventListener("pointerup", captureFrom, true);
  document.addEventListener("keyup", captureFrom, true);
  document.addEventListener(
    "selectionchange",
    () => {
      if (!document.hasFocus()) return;
      const sel = window.getSelection();
      const field = fieldFrom(sel?.anchorNode) || fieldFrom(document.activeElement);
      if (field) mark(field);
    },
    true
  );
  captureFrom({ target: document.activeElement });
})();

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
  let lastPointer = null;
  let caretBookmark = null;

  init();

  function init() {
    createFab();
    bindFocusListeners();
    bindSelectionCache();
    bindPointerTracking();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "INSERT_INTO_FIELD") {
        sendResponse({ ok: insertText(message.text), score: scoreEditable(lastEditable || activeField) });
        return true;
      }
      if (message.type === "GET_INSERT_TARGET") {
        const field = targetForInsert();
        sendResponse({
          ok: !!field,
          at: lastPointer?.at || caretBookmark?.at || 0,
          x: lastPointer?.x,
          y: lastPointer?.y
        });
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
    const el = fieldFromEvent(event);
    if (!el) return;
    if (el.closest?.("#tonedesk-fab")) return;
    clearTimeout(blurTimer);
    activeField = el;
    lastEditable = el;
    showFabNear(el);
    snapshotCaret(el);
    rememberFocus();
  }

  function bindPointerTracking() {
    const onPointer = (event) => {
      if (event.target?.closest?.("#tonedesk-fab")) return;
      lastPointer = { x: event.clientX, y: event.clientY, at: Date.now() };
      const field = editableFromPoint(event.clientX, event.clientY) || fieldFromEvent(event);
      if (!field) return;
      activeField = field;
      lastEditable = field;
      snapshotCaret(field);
      reportPointer();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("pointerup", onPointer, true);
    document.addEventListener("keyup", () => snapshotCaret(lastEditable), true);
    document.addEventListener(
      "selectionchange",
      () => {
        if (document.hasFocus()) snapshotCaret();
      },
      true
    );
  }

  function fieldFromEvent(event) {
    const path = event.composedPath?.() || [];
    for (const node of path) {
      const field = resolveField(node);
      if (field) return field;
    }
    return resolveField(event.target);
  }

  function snapshotCaret(preferred) {
    if (!document.hasFocus() && !preferred) return;
    let field = preferred && document.contains(preferred) ? preferred : null;
    if (!field) field = resolveField(document.activeElement);
    const sel = window.getSelection();
    if (!field && sel?.anchorNode) field = editableFromNode(sel.anchorNode);
    if (!field) return;
    lastEditable = field;
    const at = Date.now();
    if (typeof field.selectionStart === "number") {
      caretBookmark = {
        kind: "input",
        field,
        start: field.selectionStart,
        end: field.selectionEnd,
        at
      };
      return;
    }
    if (sel && sel.rangeCount && field.contains(sel.anchorNode)) {
      try {
        caretBookmark = { kind: "range", field, range: sel.getRangeAt(0).cloneRange(), at };
      } catch {
        /* ignore */
      }
    }
  }

  function reportPointer() {
    if (!lastPointer) return;
    try {
      chrome.runtime.sendMessage(
        { type: "CACHE_POINTER", x: lastPointer.x, y: lastPointer.y, at: lastPointer.at },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      /* ignore */
    }
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
    return !!resolveField(el);
  }

  function resolveField(el) {
    if (!el || el.nodeType !== 1 || isSensitiveField(el)) return null;
    const ceAttr = el.getAttribute?.("contenteditable");
    const ce = (ceAttr || "").toLowerCase();
    if (el.isContentEditable || ce === "true" || ce === "plaintext-only" || ceAttr === "") return el;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly ? el : null;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      if (["password", "hidden", "file", "checkbox", "radio", "button", "submit", "reset", "image", "range", "color"].includes(type)) {
        return null;
      }
      return !el.disabled && !el.readOnly ? el : null;
    }
    if (el.getAttribute?.("role") === "textbox") {
      const inner = el.querySelector?.(
        '[contenteditable="true"], [contenteditable="plaintext-only"], textarea, input[type="text"], input:not([type])'
      );
      if (inner && inner !== el) return resolveField(inner);
    }
    return null;
  }

  function editableFromNode(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    while (el && el !== document.documentElement) {
      const field = resolveField(el);
      if (field) return field;
      el = el.parentElement;
    }
    return null;
  }

  function editableFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    for (let depth = 0; depth < 8 && el; depth++) {
      const field = editableFromNode(el);
      if (field) return field;
      const root = el.shadowRoot;
      if (!root || typeof root.elementFromPoint !== "function") break;
      const next = root.elementFromPoint(x, y);
      if (!next || next === el) break;
      el = next;
    }
    const pos = document.caretPositionFromPoint?.(x, y);
    if (pos?.offsetNode) {
      const field = editableFromNode(pos.offsetNode);
      if (field) return field;
    }
    const range = document.caretRangeFromPoint?.(x, y);
    if (range?.startContainer) return editableFromNode(range.startContainer);
    return null;
  }

  function targetForInsert() {
    if (lastPointer) {
      const atPoint = editableFromPoint(lastPointer.x, lastPointer.y);
      if (atPoint) return atPoint;
    }
    if (caretBookmark?.field && document.contains(caretBookmark.field)) return caretBookmark.field;
    return bestEditableInFrame();
  }

  function placeCaret(el) {
    if (typeof el.selectionStart === "number" && caretBookmark?.kind === "input" && caretBookmark.field === el) {
      try {
        el.setSelectionRange(caretBookmark.start, caretBookmark.end);
      } catch {
        /* ignore */
      }
      return;
    }
    const sel = window.getSelection();
    if (!sel) return;
    if (
      caretBookmark?.kind === "range" &&
      caretBookmark.field === el &&
      caretBookmark.range?.startContainer &&
      el.contains(caretBookmark.range.startContainer)
    ) {
      sel.removeAllRanges();
      sel.addRange(caretBookmark.range);
      return;
    }
    if (!lastPointer) return;
    const pos = document.caretPositionFromPoint?.(lastPointer.x, lastPointer.y);
    if (pos?.offsetNode && (el.contains(pos.offsetNode) || el === pos.offsetNode)) {
      try {
        const range = document.createRange();
        range.setStart(pos.offsetNode, Math.min(pos.offset, pos.offsetNode.textContent?.length || pos.offset));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      } catch {
        /* ignore */
      }
    }
    const legacy = document.caretRangeFromPoint?.(lastPointer.x, lastPointer.y);
    if (legacy?.startContainer && el.contains(legacy.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(legacy);
    }
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
    if (h.includes("teams.microsoft.com")) return "teams";
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
    const el = targetForInsert();
    if (!el) return false;
    el.focus();
    placeCaret(el);
    if (el.isContentEditable || el.getAttribute("contenteditable") != null) {
      return insertIntoContentEditable(el, value);
    }
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
