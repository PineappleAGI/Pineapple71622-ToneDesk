/* ToneDesk content script — floating action button, context capture, insert */

(() => {
  const HOST = location.hostname.toLowerCase();
  const PLATFORM = detectPlatform(HOST);
  const BLUR_DELAY_MS = 300;
  const MAX_THREAD_CHARS = 8000;
  const MAX_COMPOSE_CHARS = 4000;

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
      if (message.type === "EXTRACT_PAGE_CONTEXT") {
        sendResponse({ ok: true, pageContext: extractPageContext() });
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

  /* ── Page context extraction ── */

  function extractPageContext() {
    const platformData = extractPlatformContext(PLATFORM);
    const composeText = getComposeText();
    const selectedText = getSelectedText();

    return {
      platform: PLATFORM,
      url: safeUrl(),
      pageTitle: document.title || "",
      selectedText: truncate(cleanText(selectedText), 2000),
      subject: platformData.subject || "",
      composeText: truncate(cleanText(composeText), MAX_COMPOSE_CHARS),
      threadText: truncate(cleanText(platformData.threadText || ""), MAX_THREAD_CHARS),
      hints: {
        isReply: platformData.isReply ?? false,
        isCompose: platformData.isCompose ?? Boolean(composeText?.trim()),
        ...platformData.extraHints
      }
    };
  }

  function safeUrl() {
    try {
      const u = new URL(location.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return location.href || "";
    }
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function truncate(text, max) {
    if (!text || text.length <= max) return text || "";
    return `${text.slice(0, max)}\n… [truncated]`;
  }

  function getSelectedText() {
    try {
      const sel = window.getSelection();
      return sel ? sel.toString().trim() : "";
    } catch {
      return "";
    }
  }

  function getComposeText() {
    const el = activeField && document.contains(activeField) ? activeField : findLikelyEditable();
    if (!el || isSensitiveField(el)) return "";
    return readFieldText(el);
  }

  function readFieldText(el) {
    if (!el) return "";
    if (el.isContentEditable) return el.innerText || el.textContent || "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return "";
  }

  function isSensitiveField(el) {
    if (!el) return true;
    const type = (el.type || "").toLowerCase();
    if (["password", "hidden", "tel", "number"].includes(type)) return true;
    const name = (el.name || el.id || "").toLowerCase();
    if (/pass(word)?|secret|token|otp|cvv|ssn/.test(name)) return true;
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/password|cc-|one-time/.test(autocomplete)) return true;
    return false;
  }

  function extractPlatformContext(platform) {
    switch (platform) {
      case "gmail":
        return extractGmailContext();
      case "linkedin":
        return extractLinkedInContext();
      case "slack":
        return extractSlackContext();
      case "whatsapp":
        return extractWhatsAppContext();
      default:
        return extractGenericContext();
    }
  }

  function extractGmailContext() {
    const subject =
      readInputValue('input[name="subjectbox"]') ||
      readInputValue('[aria-label="Subject"]') ||
      readInputValue('[placeholder="Subject"]') ||
      textFromSelector("h2.hP") ||
      "";

    const threadParts = [];
    const messageBodies = document.querySelectorAll(".a3s.aiL, .a3s");
    messageBodies.forEach((node, i) => {
      if (node.closest('[role="dialog"]')) return;
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 20) threadParts.push(text);
    });

    if (threadParts.length === 0) {
      document.querySelectorAll(".gs .gE.iv.gt, .adn.ads").forEach((node) => {
        const text = cleanText(node.innerText || node.textContent);
        if (text.length > 30) threadParts.push(text);
      });
    }

    const quoted = document.querySelectorAll(".gmail_quote, blockquote");
    quoted.forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 40) threadParts.push(`[Quoted reply]\n${text}`);
    });

    const composeEl =
      activeField ||
      document.querySelector('[aria-label="Message Body"], [g_editable="true"][contenteditable="true"], div[role="textbox"][contenteditable="true"]');
    const composeText = readFieldText(composeEl);

    const subjectLower = subject.toLowerCase();
    const isReply =
      /^re:/i.test(subject) ||
      Boolean(document.querySelector('[aria-label*="Reply"], [data-tooltip*="Reply"]')) ||
      threadParts.length > 0;

    return {
      subject: cleanText(subject),
      threadText: threadParts.slice(-6).join("\n\n---\n\n"),
      isReply,
      isCompose: Boolean(composeEl),
      extraHints: {
        hasSubject: Boolean(subject),
        messageCount: threadParts.length
      }
    };
  }

  function extractLinkedInContext() {
    const subject = "";
    const threadParts = [];

    document.querySelectorAll(".msg-s-event-listitem, .msg-s-message-list__event").forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 5) threadParts.push(text);
    });

    if (threadParts.length === 0) {
      document.querySelectorAll(".feed-shared-update-v2, .update-components-text").forEach((node) => {
        const text = cleanText(node.innerText || node.textContent);
        if (text.length > 20) threadParts.push(text);
      });
    }

    const composeEl =
      activeField ||
      document.querySelector('.msg-form__contenteditable, [contenteditable="true"][role="textbox"], .ql-editor');
    const isMessaging = Boolean(document.querySelector(".msg-overlay-conversation-bubble, .msg-thread"));
    const isPost = Boolean(document.querySelector(".share-box, .share-creation-state"));

    return {
      subject,
      threadText: threadParts.slice(-8).join("\n\n---\n\n"),
      isReply: isMessaging && threadParts.length > 0,
      isCompose: Boolean(composeEl) || isPost,
      extraHints: { isMessaging, isPost }
    };
  }

  function extractSlackContext() {
    const threadParts = [];

    document.querySelectorAll('[data-qa="message_container"], .c-message_kit__blocks, .c-virtual_list__item').forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 5) threadParts.push(text);
    });

    const composeEl =
      activeField ||
      document.querySelector('[data-qa="message_input"], .ql-editor[contenteditable="true"], .c-wysiwyg_container [contenteditable="true"]');

    return {
      subject: "",
      threadText: threadParts.slice(-10).join("\n\n---\n\n"),
      isReply: threadParts.length > 0,
      isCompose: Boolean(composeEl),
      extraHints: {}
    };
  }

  function extractWhatsAppContext() {
    const threadParts = [];

    document.querySelectorAll('[data-pre-plain-text], .message-in, .message-out, .copyable-text').forEach((node) => {
      const pre = node.getAttribute?.("data-pre-plain-text") || "";
      const body = cleanText(node.innerText || node.textContent);
      const combined = pre ? `${pre} ${body}` : body;
      if (combined.length > 3) threadParts.push(combined);
    });

    const composeEl =
      activeField ||
      document.querySelector('footer [contenteditable="true"], div[title="Type a message"]');

    return {
      subject: "",
      threadText: threadParts.slice(-12).join("\n\n---\n\n"),
      isReply: threadParts.length > 0,
      isCompose: Boolean(composeEl),
      extraHints: {}
    };
  }

  function extractGenericContext() {
    const threadParts = [];
    document.querySelectorAll('[role="article"], [role="listitem"], .message, blockquote').forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 30) threadParts.push(text);
    });

    return {
      subject: readInputValue('[name="subject"], [aria-label*="Subject" i]') || "",
      threadText: threadParts.slice(-5).join("\n\n---\n\n"),
      isReply: threadParts.length > 0,
      isCompose: Boolean(activeField),
      extraHints: {}
    };
  }

  function readInputValue(selector) {
    const el = document.querySelector(selector);
    if (!el || isSensitiveField(el)) return "";
    return cleanText(el.value || el.textContent || "");
  }

  function textFromSelector(selector) {
    const el = document.querySelector(selector);
    if (!el) return "";
    return cleanText(el.innerText || el.textContent || "");
  }

  /* ── FAB & overlay ── */

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
    const pageContext = extractPageContext();

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "OPEN_PANEL", platform: PLATFORM, pageContext },
        (res) => resolve(res || { ok: false, mode: "overlay" })
      );
    });

    if (!response.ok || response.mode === "overlay") {
      openOverlay();
    }
  }

  function getOverlayHost() {
    try {
      return window.top?.document?.documentElement || document.documentElement;
    } catch {
      return document.documentElement;
    }
  }

  function openOverlay() {
    const host = getOverlayHost();
    const existing = host.querySelector("#tonedesk-overlay");
    if (existing) {
      existing.classList.add("tonedesk-open");
      overlayRoot = existing;
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
    host.appendChild(overlayRoot);
    requestAnimationFrame(() => overlayRoot.classList.add("tonedesk-open"));
  }

  function closeOverlay() {
    const host = getOverlayHost();
    const node = overlayRoot || host.querySelector("#tonedesk-overlay");
    if (!node) return;
    node.classList.remove("tonedesk-open");
    setTimeout(() => {
      node.remove();
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
      if (isSensitiveField(el)) return false;
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

    if (el.innerHTML.trim() === "" || el.textContent.trim() === "") {
      el.textContent = text;
    } else {
      el.textContent = `${el.textContent.trim()}\n\n${text}`;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  async function maybeShowFirstTooltip() {
    if (window !== window.top) return;

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
