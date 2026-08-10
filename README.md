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

## License

MIT — see [LICENSE](LICENSE).

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> In the coming era of AGI, building solutions becomes a collective process akin to a pineapple, where technical and non-technical contributors fuse like individual berries into a unified, organic whole. This partnership mirrors the 8 & 13 dual spirals of the Fibonacci sequence, intertwining creative human intent with AI-driven structural analysis to assemble a perfect, high-resolution context for building at the speed of thought.
