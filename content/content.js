/* ToneDesk — page launcher buttons. UI opens via side panel / window (not iframe). */

(() => {
  if (window.__tonedeskLoaded) return;
  window.__tonedeskLoaded = true;

  const BLUR_DELAY_MS = 300;
  const IS_TOP = (() => {
    try {
      return window === window.top;
    } catch {
      return false;
    }
  })();

  let fab = null;
  let cornerBtn = null;
  let activeField = null;
  let blurTimer = null;

  init();

  function init() {
    createFab();
    if (IS_TOP) createCornerLauncher();
    bindFocusListeners();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "INSERT_INTO_FIELD") {
        sendResponse({ ok: insertText(message.text) });
        return true;
      }
      return false;
    });
  }

  function createFab() {
    if (fab) return;
    fab = document.createElement("button");
    fab.id = "tonedesk-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Open ToneDesk");
    fab.title = "ToneDesk";
    fab.textContent = "💼";
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

  function createCornerLauncher() {
    if (cornerBtn || document.getElementById("tonedesk-corner")) return;
    cornerBtn = document.createElement("button");
    cornerBtn.id = "tonedesk-corner";
    cornerBtn.type = "button";
    cornerBtn.setAttribute("aria-label", "Open ToneDesk");
    cornerBtn.title = "Open ToneDesk";
    cornerBtn.textContent = "💼";
    cornerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestOpen();
    });
    document.documentElement.appendChild(cornerBtn);
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
    if (el.closest("#tonedesk-fab, #tonedesk-corner")) return;
    clearTimeout(blurTimer);
    activeField = el;
    showFabNear(el);
  }

  function onFocusOut() {
    blurTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (focused && isEditable(focused)) {
        activeField = focused;
        showFabNear(focused);
        return;
      }
      hideFab();
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

  function insertText(text) {
    const el =
      activeField && document.contains(activeField) ? activeField : findLikelyEditable();
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) return insertIntoContentEditable(el, text);
    return insertIntoInput(el, text);
  }

  function findLikelyEditable() {
    const focused = document.activeElement;
    if (isEditable(focused)) return focused;
    return (
      [...document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')].find(
        (el) => {
          if (isSensitiveField(el)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 40 && rect.height > 20 && isEditable(el);
        }
      ) || null
    );
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
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      if (document.execCommand("insertText", false, text)) {
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
        );
        return true;
      }
    }
    el.textContent =
      el.textContent.trim() === "" ? text : `${el.textContent.trim()}\n\n${text}`;
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    );
    return true;
  }
})();
