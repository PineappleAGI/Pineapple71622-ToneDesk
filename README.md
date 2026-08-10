# ToneDesk

A **Chrome extension** for people who write a lot of business messages. Highlight something you already wrote and ToneDesk makes it softer, more formal, shorter, or warmer — or answer three quick questions and get a full draft with fill-in blanks.

> Open Gmail, LinkedIn, Slack, or WhatsApp Web. ToneDesk helps you say the hard thing professionally — follow-ups, soft pushback, apologies, closers — without sounding cold or abrupt.

**No account. No API key. No internet required.** Everything runs on your own machine.

---

## Get It From GitHub

You only do this once.

### Step 1 — Make sure you have Chrome

ToneDesk is a Manifest V3 extension. Use Google Chrome, or another Chromium browser that supports unpacked extensions (Edge, Brave, Arc).

**Nothing else to install.** No `npm install`, no build step, no backend. The extension is plain HTML, CSS, and JavaScript plus two JSON data files.

### Step 2 — Download the extension folder

1. Open <https://github.com/KingHenryZ/ToneDesk>
2. Click the green **Code** button → **Download ZIP** (or clone with git)
3. Unzip it somewhere you'll remember (e.g. your Desktop or `~/Documents/`)

That folder is the extension. It must contain `manifest.json` at the top level.

### Step 3 — Load it into Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the folder you just unzipped — the one **containing `manifest.json`**, not its parent

ToneDesk appears in your extensions list with a speech-bubble icon.

**Pin it (recommended):** click the puzzle-piece icon in Chrome's toolbar → pin ToneDesk so it's always one click away.

---

## Use It

### First: open the panel

1. Open **Gmail**, **LinkedIn**, **Slack (web)**, or **WhatsApp Web**
2. Click the **ToneDesk** icon in the Chrome toolbar — the **side panel** opens
3. Prefer a floating window? Tap **Pop out** in the panel header

You'll see four tabs: **Rewrite**, **Write**, **Phrases**, and **Find**.

There's also a shortcut on the page itself: focus any compose box and a small ToneDesk button appears beside it.

### Rewrite — fix something you already wrote

1. Highlight the text on the page, then tap **Use selection** (or paste a draft into the box)
2. Pick a tone: **Softer**, **More formal**, **Shorter**, **Warmer**, or **Original tone**
3. **Copy** it, or **Insert** it straight into the compose box

Tap **← New rewrite** to start over with a fresh selection.

### Write — build a draft from scratch

Answer three questions:

1. **What are you writing?** — reply / new email / LinkedIn / Slack·WhatsApp
2. **What's the situation?** — options adapt to your first answer
3. **Who are you talking to?** — boss / peer / junior / client / stranger

You get a full draft. Tap the highlighted `[slots]` to fill in names and details, switch tone with **More formal** / **Shorter** / **Warmer**, then copy or insert.

### Phrases — a bank of proven lines

Browse categories like Openers, Soft Disagreements, Delivering Bad News, and Closers. **Copy**, **Insert**, or ★ favorite any line. Favorites are saved on your machine.

### Find — search the phrase bank

Type in the top bar (`follow up`, `say no`, `apologize`, `request`) for the five closest matches.

---

## What's In The Extension

| Piece | What it does |
|---|---|
| **Rewrite** | Retones selected or pasted text — softer, formal, shorter, or warmer |
| **Write** | Three-question flow → template draft with `[slots]` and tone variants |
| **Phrases** | Browsable bank of professional openers, acknowledgments, pushback, and closers |
| **Find** | Fuzzy search across the phrase bank, with intent hints for queries like "say no" |
| **Copy / Insert** | Copy to clipboard, or drop the text into the compose box you were using |
| **Optional AI polish** | If Chrome's built-in on-device AI is available, drafts get an extra polish pass |

---

## How It Works

Three layers, each usable on its own:

```text
Open ToneDesk (toolbar side panel, Pop out window, or the button by your compose box)
  → Layer 1: browse or search phrases.json
  → Layer 2: answer 3 questions → templates.json draft + slots + tone variants
  → Layer 3 (optional): Chrome's built-in AI polishes the result, on-device
  → Copy, or Insert into Gmail / LinkedIn / Slack / WhatsApp
```

```text
Page (content script)  ←→  background service worker  ←→  panel UI
                            (opens the panel, tracks which
                             compose box you were in, relays Insert)
```

- **Phrase dictionary** — always available, no model needed
- **Template engine** — plain logic over `data/templates.json`, works fully offline
- **Chrome Built-in AI** — optional; without it you still get **📝 Template** results

---

## Privacy

ToneDesk has no servers, so there is nowhere for your text to go.

- **No network requests.** The extension never calls a remote API. The only files it loads are the two JSON files bundled inside it.
- **No account, no telemetry, no analytics.**
- **Your message text is never written to disk.** Selected text is held in Chrome's session storage while you work and is discarded when you close the tab or quit Chrome.
- **Only your settings persist** — favorite phrases, preferred tone, and remembered slot values like your name.
- **Optional AI runs on-device** via Chrome's built-in Prompt API. Nothing is uploaded.

### Permissions and why they're needed

| Permission | Why |
|---|---|
| Access to Gmail, LinkedIn, Slack, WhatsApp Web | Read the text you highlight and insert results into the compose box. No other site is touched. |
| `scripting` | Find your compose box, including inside Gmail's nested frames |
| `storage` | Save your settings and favorites |
| `sidePanel` | Show the ToneDesk panel beside the page |

Password, OTP, CVV, and similar sensitive fields are explicitly excluded — ToneDesk will not read from or write to them.

### Limits

ToneDesk is a writing aid, not a judge of what's appropriate for your workplace. **Read every draft before you send it.**

---

## Project layout

```
ToneDesk/                  # this folder (manifest.json at the root)
  manifest.json
  data/phrases.json        # Layer 1 — the phrase bank
  data/templates.json      # Layer 2 — draft templates and tone variants
  content/                 # on-page button + insert into compose fields
  panel/                   # Rewrite / Write / Phrases / Find UI
  shared/                  # storage, fuzzy search, AI, template engine
  background/              # service worker: opens the panel, relays Insert
  popup/                   # toolbar fallback launcher
  icons/
```

---

## Developing

There's no build step — edit the files and reload.

1. Go to `chrome://extensions`
2. Click **Reload** on ToneDesk
3. Hard-refresh the site you're testing (**Cmd+Shift+R** / **Ctrl+Shift+R**)

---

## License

MIT — see [LICENSE](LICENSE).

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> ToneDesk helps people send the message they mean — clear, warm, and professional — so workplace writing can move faster without losing tact.
