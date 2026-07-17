import { buildUserPrompt, buildSummarizePrompt, parseSummaryResponse, isWeakContext } from "../shared/prompts.js";
import { generateMessage, summarizeContext, normalizeProvider, PROVIDER_LABELS } from "../shared/ai.js";
import { getSettings, saveSettings, detectPlatform, getActiveApiKey } from "../shared/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
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
      return { ok: true };

    case "OPEN_PANEL": {
      const tabId = sender.tab?.id;
      if (!tabId) throw new Error("No active tab");

      const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
      const panelContext = {
        platform: message.platform || detectPlatform(sender.tab?.url || ""),
        tabId,
        frameId,
        openedAt: Date.now()
      };

      await chrome.storage.session.set({
        [`panelContext:${tabId}`]: panelContext,
        [`pageContext:${tabId}`]: message.pageContext || null
      });

      try {
        await chrome.sidePanel.setOptions({
          tabId,
          path: "panel/panel.html",
          enabled: true
        });
        await chrome.sidePanel.open({ tabId });
        return { ok: true, mode: "sidePanel" };
      } catch {
        return { ok: true, mode: "overlay" };
      }
    }

    case "GET_PANEL_CONTEXT": {
      const tabId = message.tabId || (await getActiveTabId());
      const panelKey = `panelContext:${tabId}`;
      const pageKey = `pageContext:${tabId}`;
      const data = await chrome.storage.session.get([panelKey, pageKey]);
      let context = data[panelKey] || null;
      const pageContext = data[pageKey] || null;

      if (!context && tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          context = {
            platform: detectPlatform(tab?.url || ""),
            tabId,
            frameId: 0
          };
        } catch {
          /* ignore */
        }
      }

      return { ok: true, context, pageContext, tabId };
    }

    case "RESCAN_PAGE_CONTEXT": {
      const tabId = message.tabId || (await getActiveTabId());
      const pageContext = await fetchPageContextFromTab(tabId);
      await chrome.storage.session.set({ [`pageContext:${tabId}`]: pageContext });
      return { ok: true, pageContext };
    }

    case "SUMMARIZE_CONTEXT": {
      const tabId = message.tabId || (await getActiveTabId());
      let pageContext = message.pageContext;

      if (!pageContext) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      if (!pageContext) {
        pageContext = await fetchPageContextFromTab(tabId);
        await chrome.storage.session.set({ [`pageContext:${tabId}`]: pageContext });
      }

      const settings = await getSettings();
      const provider = normalizeProvider(settings.provider);
      const apiKey = getActiveApiKey(settings);

      if (!apiKey) {
        const label = PROVIDER_LABELS[provider] || provider;
        throw new Error(`Add your ${label} API key in ToneDesk settings first.`);
      }

      const rawSummary = await summarizeContext({
        provider,
        apiKey,
        userPrompt: buildSummarizePrompt(pageContext)
      });

      const parsed = parseSummaryResponse(rawSummary);

      return {
        ok: true,
        pageContext,
        summary: parsed.summary,
        intent: parsed.intent,
        relationship: parsed.relationship,
        rawSummary,
        isWeak: isWeakContext(pageContext)
      };
    }

    case "GENERATE_DRAFT": {
      const settings = await getSettings();
      const tabId = message.tabId || message.payload?.tabId || (await getActiveTabId());
      let pageContext = message.payload?.pageContext;

      if (!pageContext && tabId) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      const draft = await generateDraft(settings, buildUserPrompt({
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference
      }));

      if (message.payload?.relationshipId || message.payload?.relationship) {
        await saveSettings({
          lastRelationship: message.payload.relationshipId || message.payload.relationship
        });
      }

      return { ok: true, draft };
    }

    case "GENERATE_VARIANT": {
      const settings = await getSettings();
      const tabId = message.tabId || (await getActiveTabId());
      let pageContext = message.payload?.pageContext;

      if (!pageContext && tabId) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      const draft = await generateDraft(settings, buildUserPrompt({
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference,
        variant: message.payload.variant
      }));

      return { ok: true, draft };
    }

    case "INSERT_TEXT": {
      const tabId = message.tabId || (await getActiveTabId());
      if (!tabId) throw new Error("No active tab to insert into");

      const key = `panelContext:${tabId}`;
      const stored = await chrome.storage.session.get(key);
      const frameId = stored[key]?.frameId;
      const payload = { type: "INSERT_INTO_FIELD", text: message.text };

      try {
        if (typeof frameId === "number") {
          await chrome.tabs.sendMessage(tabId, payload, { frameId });
        } else {
          await chrome.tabs.sendMessage(tabId, payload);
        }
      } catch {
        await chrome.tabs.sendMessage(tabId, payload);
      }
      return { ok: true };
    }

    case "COPY_TEXT":
      return { ok: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function fetchPageContextFromTab(tabId) {
  if (!tabId) return null;

  const stored = await chrome.storage.session.get(`panelContext:${tabId}`);
  const frameId = stored[`panelContext:${tabId}`]?.frameId;

  try {
    const response =
      typeof frameId === "number"
        ? await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTEXT" }, { frameId })
        : await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTEXT" });
    if (response?.pageContext) return response.pageContext;
  } catch {
    /* fall through */
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTEXT" });
    return response?.pageContext || null;
  } catch {
    return null;
  }
}

async function generateDraft(settings, userPrompt) {
  const provider = normalizeProvider(settings.provider);
  const apiKey = getActiveApiKey(settings);

  if (!apiKey) {
    const label = PROVIDER_LABELS[provider] || provider;
    throw new Error(`Add your ${label} API key in ToneDesk settings first.`);
  }

  return generateMessage({ provider, apiKey, userPrompt });
}
