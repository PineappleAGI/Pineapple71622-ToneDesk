# ToneDesk (Project71622)

A downloadable **Chrome extension** for people who write a lot of business messages. You answer a few chip questions (or browse a phrase bank); ToneDesk builds a tactful draft with fill-in blanks — then you copy it or insert it straight into the page.

> Open Gmail, LinkedIn, Slack, or WhatsApp Web. ToneDesk helps you say the hard thing professionally — follow-ups, soft pushback, apologies, closers — without sounding cold or abrupt.

**No account. No API key. No internet required.** Everything runs on-device in Chrome.

This is a sibling project to [Skill71717 Pineapple Research Materials](https://github.com/KingHenryZ/Skill71717-Dossier): same “download → set up once → use” idea, different job (business writing instead of research dossiers).

---

## Get It From GitHub

You only do this once.

### Step 1 — Make sure you have Chrome

ToneDesk is a Chrome extension (Manifest V3). Use Google Chrome (or another Chromium browser that supports unpacked extensions and, optionally, Chrome’s Built-in AI).

**No other tools to install.** No `npm install`, no build step, no backend. The extension is plain HTML/CSS/JS plus two JSON data files.

### Step 2 — Get the extension folder

**If you already have this repo locally** (e.g. `~/Project71622` or a clone of `tonedesk`), skip the ZIP steps and use that folder.

**Otherwise, from GitHub:**

1. Open <https://github.com/KingHenryZ/ToneDesk>
2. Click the green **Code** button → **Download ZIP** (or clone with git)
3. Unzip / clone it somewhere you'll remember

That folder is the extension. It must contain `manifest.json` at the top level.

### Step 3 — Load it into Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select **this folder** (the one with `manifest.json` — not a parent directory)

ToneDesk should appear in your extensions list with its icon.

**Pin it (recommended):** click the puzzle-piece icon in Chrome’s toolbar → pin ToneDesk so it’s always one click away.

---

## Use It

### First: open the panel once

1. After installing (or after any update): click **Reload** on the extension card, then hard-refresh the site you’re on (**Cmd+Shift+R** / **Ctrl+Shift+R**)
2. Click the **ToneDesk** icon in the Chrome toolbar — the **side panel** opens directly
3. Prefer a floating window? tap **Pop out** in the panel header

You’ll see four tabs: **Rewrite**, **Write**, **Phrases**, and **Find**.

### Then: write on a real page

1. Open **Gmail**, **LinkedIn**, **Slack (web)**, or **WhatsApp Web**
2. Focus a message / compose field — a small ToneDesk button appears near the field (optional shortcut)
3. Or open ToneDesk from the Chrome toolbar (side panel)
4. Use **Rewrite** / **Write** / **Phrases** / **Find**, then **Copy** or **Insert** into the page

### Rewrite

Highlight text on the page → **Use selection**, or paste a draft. Pick Softer / More formal / Shorter / Warmer, then **Copy**, **Insert**, or **Replace selection**.

### Write flow

1. **What are you writing?** — reply / new email / LinkedIn / Slack·WhatsApp
2. **What's the situation?** — chips adapt to step 1
3. **Who are you talking to?** — boss / peer / junior / client / stranger

Then you get a full draft. Tap highlighted `[slots]` to fill them in. Switch tone with **More formal** / **Shorter** / **Warmer**. Copy or insert into the page.

### Phrases

Browse categories as accordions. **Copy**, **Insert**, or ★ favorite phrases. Favorites stay on your machine via `chrome.storage.local`.

### Find

Type in the top bar (e.g. `follow up`, `say no`, `apologize`) for fuzzy top-5 matches from the phrase bank.

---

## What's In The Extension

| Piece | What you'll find |
|---|---|
| **Rewrite** | Polish selected or pasted text (softer / formal / shorter / warmer) |
| **Write** | 3-question chip flow → template draft with `[slots]` and tone variants |
| **Phrases** | Searchable bank of openers, acknowledgments, soft pushback, closers, and more |
| **Find** | Fuzzy match over the phrase bank (intent hints for queries like “say no”) |
| **Insert / Copy** | Put the draft into the focused field on the page, or copy to clipboard |
| **Optional AI polish** | If Chrome Built-in AI (`window.ai.languageModel`) is available, drafts can be polished on-device |

---

## How It Works (three layers)

```text
Open ToneDesk (toolbar / side panel / 💼 on page)
  → Layer 1: browse or search phrases.json
  → Layer 2: answer 3 chips → templates.json draft + slots + tone variants
  → Layer 3 (optional): Chrome Built-in AI polishes the draft if available
  → Copy or Insert into Gmail / LinkedIn / Slack / WhatsApp
```

```text
Page (content script)  ←→  background service worker  ←→  panel UI
                              (open UI, tab context, insert relay)
```

- **Phrase dictionary** — always available; no model
- **Template engine** — pure logic over `data/templates.json`; works fully offline
- **Chrome Built-in AI** — optional; when unavailable you still get **📝 Template** drafts

---

## Privacy & Limits

- Everything runs **locally**. No account, no login, no analytics backend.
- Host access is limited to Gmail, LinkedIn, Slack, and WhatsApp Web.
- Favorites and preferences live in `chrome.storage.local` on your machine.
- Optional AI uses Chrome’s on-device Prompt API when present — drafts are not sent to a ToneDesk server.
- This is a writing aid, not a guarantee that a message is appropriate for every workplace. Review before you send.

---

## Project layout

```
tonedesk/                  # this folder (manifest.json at the root)
  manifest.json
  data/phrases.json        # Layer 1
  data/templates.json      # Layer 2
  content/                 # FAB + insert into page fields
  panel/                   # Rewrite / Write / Phrases / Find UI
  shared/                  # storage, fuzzy search, AI, templates
  background/              # message relay + open UI
  popup/                   # toolbar launcher
  icons/
```

---

## Updating after you change code

1. Go to `chrome://extensions`
2. Click **Reload** on ToneDesk
3. Hard-refresh the host site (**Cmd+Shift+R** / **Ctrl+Shift+R**)

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> ToneDesk helps people send the message they mean — clear, warm, and professional — so workplace writing can move faster without losing tact.
