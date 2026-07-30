const statusEl = document.getElementById("status");

document.getElementById("btn-panel").addEventListener("click", async () => {
  statusEl.textContent = "Opening…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "panel/panel.html",
      enabled: true
    });
    await chrome.sidePanel.open({ tabId: tab.id });
    statusEl.textContent = "Side panel opened";
    setTimeout(() => window.close(), 150);
  } catch (err) {
    console.warn(err);
    statusEl.textContent = "Side panel unavailable — try “Open in window”";
  }
});

document.getElementById("btn-window").addEventListener("click", async () => {
  statusEl.textContent = "Opening…";
  try {
    // Open directly from the popup (does not depend on the service worker)
    await chrome.windows.create({
      url: chrome.runtime.getURL("panel/panel.html"),
      type: "popup",
      width: 380,
      height: 680,
      focused: true
    });
    window.close();
  } catch (err) {
    statusEl.textContent = err?.message || "Failed to open";
  }
});
