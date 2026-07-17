import { SYSTEM_PROMPT, buildUserPrompt } from "../shared/prompts.js";
import { getSettings, saveSettings, detectPlatform } from "../shared/storage.js";

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

      await chrome.storage.session.set({
        [`panelContext:${tabId}`]: {
          platform: message.platform || detectPlatform(sender.tab?.url || ""),
          tabId,
          frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
          openedAt: Date.now()
        }
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
      const key = `panelContext:${tabId}`;
      const data = await chrome.storage.session.get(key);
      let context = data[key] || null;

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

      return { ok: true, context, tabId };
    }

    case "GENERATE_DRAFT": {
      const settings = await getSettings();
      if (!settings.apiKey) {
        throw new Error("Add your OpenAI API key in ToneDesk settings first.");
      }

      const draft = await callOpenAI({
        apiKey: settings.apiKey,
        userPrompt: buildUserPrompt({
          ...message.payload,
          tonePreference: settings.tonePreference
        })
      });

      if (message.payload?.relationship) {
        await saveSettings({ lastRelationship: message.payload.relationship });
      }

      return { ok: true, draft };
    }

    case "GENERATE_VARIANT": {
      const settings = await getSettings();
      if (!settings.apiKey) {
        throw new Error("Add your OpenAI API key in ToneDesk settings first.");
      }

      const draft = await callOpenAI({
        apiKey: settings.apiKey,
        userPrompt: buildUserPrompt({
          ...message.payload,
          tonePreference: settings.tonePreference,
          variant: message.payload.variant
        })
      });

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
        // Fallback: try top frame if the original compose iframe is gone
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

async function callOpenAI({ apiKey, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err?.error?.message || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `OpenAI request failed (${response.status})`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No draft returned from the model.");
  return text;
}
