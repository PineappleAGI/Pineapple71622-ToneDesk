/* ToneDesk content script — floating action button + insert */

(() => {
  const HOST = location.hostname.toLowerCase();
  const PLATFORM = detectPlatform(HOST);
  const BLUR_DELAY_MS = 300;

  let fab = null;
  let tooltip = null;
  let overlayRoot = null;
  let activeField = null;
  let blurTimer = null;
  let settingsCache = null;

  init();

  async function init() {
    settingsCache = await requestSettings();
    if (!isSiteEnabled(PLATFORM, settingsCache)) return;

    createFab();
    bindFocusListeners();
    maybeShowFirstTooltip();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "INSERT_INTO_FIELD") {
        const ok = insertText(message.text);
        sendResponse({ ok });
        return true;
      }
      if (message.type === "CLOSE_OVERLAY") {
        closeOverlay();
        sendResponse({ ok: true });
        return true;
      }
      return false;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.siteEnabled || changes.hasSeenTooltip) {
        requestSettings().then((s) => {
          settingsCache = s;
          if (!isSiteEnabled(PLATFORM, settingsCache)) {
            hideFab();
            closeOverlay();
          }
        });
      }
    });
  }

  function detectPlatform(host) {
    if (host.includes("mail.google.com")) return "gmail";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("slack.com")) return "slack";
    if (host.includes("whatsapp.com")) return "whatsapp";
    return "unknown";
  }

  function isSiteEnabled(platform, settings) {
    if (!settings?.siteEnabled) return true;
    return settings.siteEnabled[platform] !== false;
  }

  function requestSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => {
        resolve(res?.settings || null);
      });
    });
  }

  function createFab() {
    if (fab) return;
    fab = document.createElement("button");
    fab.id = "tonedesk-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Open ToneDesk");
    fab.title = "ToneDesk — craft a professional reply";
    fab.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v7c0 1.38-1.12 2.5-2.5 2.5H10l-4.2 3.15c-.45.34-1.1.02-1.1-.53V6.5z" fill="currentColor"/>
        <path d="M8.2 10.2h7.6M8.2 13h5.1" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    `;
    fab.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAssistant();
    });
    document.documentElement.appendChild(fab);
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
    if (el.closest("#tonedesk-fab, #tonedesk-overlay, #tonedesk-tooltip")) return;

    clearTimeout(blurTimer);
    activeField = el;
    showFabNear(el);
  }

  function onFocusOut(event) {
    const next = event.relatedTarget;
    if (next && (next === fab || fab?.contains(next) || next.closest?.("#tonedesk-overlay"))) {
      return;
    }
    blurTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (focused && isEditable(focused) && focused !== fab) {
        activeField = focused;
        showFabNear(focused);
        return;
      }
      if (document.activeElement === fab) return;
      hideFab();
    }, BLUR_DELAY_MS);
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
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
    if (!fab || !isSiteEnabled(PLATFORM, settingsCache)) return;
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

  async function openAssistant() {
    clearTimeout(blurTimer);
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "OPEN_PANEL", platform: PLATFORM },
        (res) => resolve(res || { ok: false, mode: "overlay" })
      );
    });

    if (!response.ok || response.mode === "overlay") {
      openOverlay();
    }
  }

  function openOverlay() {
    if (overlayRoot) {
      overlayRoot.classList.add("tonedesk-open");
      return;
    }

    overlayRoot = document.createElement("div");
    overlayRoot.id = "tonedesk-overlay";
    overlayRoot.innerHTML = `
      <div class="tonedesk-overlay-backdrop" data-close="1"></div>
      <div class="tonedesk-overlay-panel" role="dialog" aria-label="ToneDesk">
        <iframe src="${chrome.runtime.getURL("panel/panel.html")}?mode=overlay" title="ToneDesk"></iframe>
      </div>
    `;
    overlayRoot.querySelector("[data-close]").addEventListener("click", closeOverlay);
    document.documentElement.appendChild(overlayRoot);
    requestAnimationFrame(() => overlayRoot.classList.add("tonedesk-open"));
  }

  function closeOverlay() {
    if (!overlayRoot) return;
    overlayRoot.classList.remove("tonedesk-open");
    setTimeout(() => {
      overlayRoot?.remove();
      overlayRoot = null;
    }, 220);
  }

  function insertText(text) {
    const el = activeField && document.contains(activeField)
      ? activeField
      : findLikelyEditable();

    if (!el) return false;

    el.focus();

    if (el.isContentEditable) {
      return insertIntoContentEditable(el, text);
    }

    return insertIntoInput(el, text);
  }

  function findLikelyEditable() {
    const focused = document.activeElement;
    if (isEditable(focused)) return focused;

    const candidates = [
      ...document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')
    ];
    return candidates.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 40 && rect.height > 20 && isEditable(el);
    }) || null;
  }

  function insertIntoInput(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, next);
    else el.value = next;

    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* some inputs disallow selection */
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function insertIntoContentEditable(el, text) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      const ok = document.execCommand("insertText", false, text);
      if (ok) {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return true;
      }
    }

    // Fallback: append
    if (el.innerHTML.trim() === "" || el.textContent.trim() === "") {
      el.textContent = text;
    } else {
      el.textContent = `${el.textContent.trim()}\n\n${text}`;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  async function maybeShowFirstTooltip() {
    const settings = settingsCache || (await requestSettings());
    if (!settings || settings.hasSeenTooltip) return;

    tooltip = document.createElement("div");
    tooltip.id = "tonedesk-tooltip";
    tooltip.innerHTML = `
      <strong>ToneDesk is ready</strong>
      <span>Click into a message field, then tap the button to draft a professional reply.</span>
      <button type="button" id="tonedesk-tooltip-dismiss">Got it</button>
    `;
    document.documentElement.appendChild(tooltip);
    requestAnimationFrame(() => tooltip.classList.add("tonedesk-visible"));

    tooltip.querySelector("#tonedesk-tooltip-dismiss").addEventListener("click", () => {
      tooltip?.classList.remove("tonedesk-visible");
      setTimeout(() => tooltip?.remove(), 200);
      chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: { hasSeenTooltip: true } });
    });
  }
})();
