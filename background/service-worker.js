import { buildUserPrompt, buildSummarizePrompt, parseSummaryResponse, isWeakContext } from "../shared/prompts.js";
import { generateMessage, summarizeContext, normalizeProvider, PROVIDER_LABELS, isQuotaError } from "../shared/ai.js";
import { buildHeuristicSummary, generateOfflineDraft, pickRichestContext } from "../shared/offline.js";
import { getSettings, saveSettings, detectPlatform, getActiveApiKey } from "../shared/storage.js";

const SUMMARIZE_TIMEOUT_MS = 9000;

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

    case "SUMMARIZE_CONTEXT":
      return summarizeContextWithFallback(message);

    case "GENERATE_DRAFT": {
      const settings = await getSettings();
      const tabId = message.tabId || message.payload?.tabId || (await getActiveTabId());
      let pageContext = message.payload?.pageContext;

      if (!pageContext && tabId) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      return generateDraftWithFallback(settings, buildUserPrompt({
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference
      }), { ...message.payload, pageContext, tonePreference: settings.tonePreference });
    }

    case "GENERATE_VARIANT": {
      const settings = await getSettings();
      const tabId = message.tabId || (await getActiveTabId());
      let pageContext = message.payload?.pageContext;

      if (!pageContext && tabId) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      return generateDraftWithFallback(settings, buildUserPrompt({
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference,
        variant: message.payload.variant
      }), {
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference,
        variant: message.payload.variant
      });
    }

    case "GENERATE_OFFLINE_DRAFT": {
      const settings = await getSettings();
      const tabId = message.tabId || message.payload?.tabId || (await getActiveTabId());
      let pageContext = message.payload?.pageContext;

      if (!pageContext && tabId) {
        const stored = await chrome.storage.session.get(`pageContext:${tabId}`);
        pageContext = stored[`pageContext:${tabId}`] || null;
      }

      const draft = generateOfflineDraft({
        ...message.payload,
        pageContext,
        tonePreference: settings.tonePreference
      });

      if (message.payload?.relationshipId || message.payload?.relationship) {
        await saveSettings({
          lastRelationship: message.payload.relationshipId || message.payload.relationship
        });
      }

      return { ok: true, draft, offlineFallback: true };
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

async function summarizeContextWithFallback(message) {
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

  const weak = isWeakContext(pageContext);
  const settings = await getSettings();
  const apiKey = getActiveApiKey(settings);

  if (apiKey) {
    try {
      const rawSummary = await withTimeout(
        summarizeContext({
          provider: normalizeProvider(settings.provider),
          apiKey,
          userPrompt: buildSummarizePrompt(pageContext)
        }),
        SUMMARIZE_TIMEOUT_MS
      );

      const parsed = parseSummaryResponse(rawSummary);

      return {
        ok: true,
        pageContext,
        summary: parsed.summary,
        intent: parsed.intent,
        relationship: parsed.relationship,
        rawSummary,
        isWeak: weak,
        offlineFallback: false
      };
    } catch (error) {
      return buildFallbackSummaryResponse(pageContext, weak, error);
    }
  }

  return buildFallbackSummaryResponse(pageContext, weak, new Error("No API key"));
}

function buildFallbackSummaryResponse(pageContext, weak, error) {
  const heuristic = buildHeuristicSummary(pageContext);
  const quotaError = isQuotaError(error?.message);
  const noApiKey = /no api key/i.test(error?.message || "");

  let notice;
  if (quotaError) {
    notice =
      "AI quota reached — showing page capture instead. You can edit and still draft. " +
      '<a href="https://ai.dev/rate-limit" target="_blank" rel="noopener noreferrer">Check rate limits</a>';
  } else if (noApiKey) {
    notice = "No API key — showing page capture. Add a key in settings for AI drafts, or draft offline.";
  } else {
    notice = "AI summary unavailable — showing page capture instead. You can edit and still draft.";
  }

  const hasContent = !heuristic.isEmpty;

  return {
    ok: true,
    pageContext,
    summary: heuristic.summary,
    intent: heuristic.intent,
    relationship: heuristic.relationship,
    isWeak: weak || heuristic.isEmpty,
    offlineFallback: true,
    quotaError,
    noApiKey,
    notice: hasContent || weak ? notice : undefined
  };
}

async function generateDraftWithFallback(settings, userPrompt, payload) {
  const provider = normalizeProvider(settings.provider);
  const apiKey = getActiveApiKey(settings);

  if (!apiKey) {
    const draft = generateOfflineDraft(payload);
    if (payload?.relationshipId || payload?.relationship) {
      await saveSettings({
        lastRelationship: payload.relationshipId || payload.relationship
      });
    }
    return {
      ok: true,
      draft,
      offlineFallback: true,
      noApiKey: true,
      notice: "Drafted offline — add an API key in settings for AI-powered drafts."
    };
  }

  try {
    const draft = await generateMessage({ provider, apiKey, userPrompt });
    if (payload?.relationshipId || payload?.relationship) {
      await saveSettings({
        lastRelationship: payload.relationshipId || payload.relationship
      });
    }
    return { ok: true, draft, offlineFallback: false };
  } catch (error) {
    if (isQuotaError(error.message)) {
      const draft = generateOfflineDraft(payload);
      if (payload?.relationshipId || payload?.relationship) {
        await saveSettings({
          lastRelationship: payload.relationshipId || payload.relationship
        });
      }
      return {
        ok: true,
        draft,
        offlineFallback: true,
        quotaError: true,
        notice:
          "Drafted offline — AI quota reached. Edit as needed or check " +
          '<a href="https://ai.dev/rate-limit" target="_blank" rel="noopener noreferrer">rate limits</a>.'
      };
    }
    throw error;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI summary timed out")), ms)
    )
  ]);
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function fetchPageContextFromTab(tabId) {
  if (!tabId) return null;

  const stored = await chrome.storage.session.get(`panelContext:${tabId}`);
  const preferredFrameId = stored[`panelContext:${tabId}`]?.frameId;
  const candidates = [];

  const frameIds = [];
  if (typeof preferredFrameId === "number") frameIds.push(preferredFrameId);
  if (!frameIds.includes(0)) frameIds.push(0);

  for (const frameId of frameIds) {
    const ctx = await extractFromFrame(tabId, frameId);
    if (ctx) candidates.push(ctx);
  }

  const fallback = await extractFromFrame(tabId);
  if (fallback) candidates.push(fallback);

  return pickRichestContext(...candidates);
}

async function extractFromFrame(tabId, frameId) {
  try {
    const response =
      typeof frameId === "number"
        ? await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTEXT" }, { frameId })
        : await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTEXT" });
    return response?.pageContext || null;
  } catch {
    return null;
  }
}
