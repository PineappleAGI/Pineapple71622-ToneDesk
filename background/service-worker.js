import { getSettings, saveSettings } from "../shared/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
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
      const context = await loadPanelContext(tabId);
      return { ok: true, context, tabId };
    }

    case "INSERT_INTO_FIELD": {
      const tabId = message.tabId || sender.tab?.id || (await getActiveTabId());
      if (!tabId) return { ok: false, error: "No active tab" };

      const payload = { type: "INSERT_INTO_FIELD", text: message.text };
      const frameId = typeof message.frameId === "number" ? message.frameId : undefined;

      if (frameId !== undefined) {
        try {
          const res = await chrome.tabs.sendMessage(tabId, payload, { frameId });
          if (res?.ok) return res;
        } catch {
          /* try all frames */
        }
      }

      try {
        const res = await chrome.tabs.sendMessage(tabId, payload);
        return res || { ok: false };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }

    default:
      return { ok: false, error: `Unknown message: ${message.type}` };
  }
}

async function openUi({ tabId, frameId, platform, mode } = {}) {
  const resolvedTabId = tabId || (await getActiveTabId());

  if (resolvedTabId) {
    await savePanelContext({
      platform: platform || "unknown",
      tabId: resolvedTabId,
      frameId: typeof frameId === "number" ? frameId : 0
    });
  }

  // Prefer a dedicated window — always works, no gesture / CSP issues
  if (mode === "window" || mode === "sidePanel") {
    if (mode === "sidePanel" && resolvedTabId) {
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

  // Default (from page FAB): try side panel, then window
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

async function savePanelContext(ctx) {
  const payload = { ...ctx, openedAt: Date.now() };
  try {
    await chrome.storage.session.set({ [`panelContext:${ctx.tabId}`]: payload });
  } catch {
    /* ignore */
  }
  await chrome.storage.local.set({ lastPanelContext: payload });
}

async function loadPanelContext(tabId) {
  try {
    const data = await chrome.storage.session.get(`panelContext:${tabId}`);
    if (data[`panelContext:${tabId}`]) return data[`panelContext:${tabId}`];
  } catch {
    /* ignore */
  }
  const local = await chrome.storage.local.get("lastPanelContext");
  return local.lastPanelContext || null;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || null;
}
