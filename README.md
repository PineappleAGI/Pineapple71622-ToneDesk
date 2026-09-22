# ToneDesk

A **Chrome extension** for people who write a lot of business messages. Highlight something you already wrote and ToneDesk makes it softer, more formal, shorter, or warmer — or answer three quick questions and get a full draft with fill-in blanks.

> Use it in any page’s compose box. ToneDesk helps you say the hard thing professionally — follow-ups, soft pushback, apologies, closers — without sounding cold or abrupt.

**No account. No API key. No internet required.** Everything runs on your own machine. Recent rewrites, favorites, and filled-in names stay on this device. The text you highlight is session-only and clears when Chrome closes.

<img width="689" height="674" alt="Screenshot 2026-09-22 at 11 14 14" src="https://github.com/user-attachments/assets/4b38f0ca-42da-4a01-9574-6d2b25d7d9e4" />
<img width="689" height="583" alt="Screenshot 2026-09-22 at 11 14 05" src="https://github.com/user-attachments/assets/be8eb708-bb78-410f-8916-8adc76bbcabb" />

---

## Get It From GitHub

You only do this once.

### Step 1 — Make sure you have Chrome

ToneDesk is a Manifest V3 extension. Use Google Chrome, or another Chromium browser that supports unpacked extensions (Edge, Brave, Arc).

**Nothing else to install.** No `npm install`, no build step, no backend. The extension is plain HTML, CSS, and JavaScript plus two JSON data files.

### Step 2 — Download the extension folder

1. Open <https://github.com/PineappleAGI/Pineapple71622-ToneDesk>
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

1. Open any page with a text box — Gmail, LinkedIn, Slack, WhatsApp Web, and Teams work especially well
2. Click the **ToneDesk** icon in the Chrome toolbar — the **side panel** opens
3. Prefer a floating window? Tap **Pop out** in the panel header

You'll see three tabs: **Rewrite**, **Write**, and **Phrases**. The search bar filters whichever tab you're on.

There's also a shortcut on the page itself: focus any compose box and a small ToneDesk button appears beside it.

### Rewrite — match the tone to the reader

1. Pick a tone (Formal, Warm, Direct, Concise, Confident, Diplomatic) and an audience
2. Highlight text on the page, or paste a draft
3. Read the before/after diff and **Why this edit**, then **Copy** or **Insert**

The search bar filters tones. Tone and audience are remembered per site (Gmail starts on Client/External, Teams on Peer/Colleague). Alt+Shift+R rewrites the current selection.

### Write — build a draft from scratch

Answer three questions:

1. **What are you writing?** — reply / new email / LinkedIn / Slack·WhatsApp / **Job Search**
2. **What's the situation?** — options adapt to your first answer. Job Search includes outreach, thank-yous, referrals, and offers
3. **Who are you talking to?** — Job Search defaults to Recruiter/Hiring Manager

You get a full draft. Tap the highlighted `[slots]` to fill in names and details, switch tone with **More formal** / **Shorter** / **Warmer**, then copy or insert.

### Phrases — a bank of proven lines

Browse categories like Openers, Job Search & Networking, Following Up, and Requests. Openers, Following Up, and Requests start expanded. **Copy**, **Insert**, or ★ favorite any line. Favorites are saved on your machine.

### Search

The bar at the top filters the tab you're on:

- **Rewrite** — tones such as softer, formal, shorter, or warmer
- **Write** — situations (`follow up`, `say no`) and who you're writing to
- **Phrases** — the phrase bank (`apologize`, `request`, `follow up`)

---

## What's In The Extension

| Piece | What it does |
|---|---|
| **Rewrite** | Retones selected or pasted text — softer, formal, shorter, or warmer |
| **Write** | Three-question flow → template draft with `[slots]` and tone variants |
| **Phrases** | Browsable bank of professional openers, acknowledgments, pushback, and closers |
| **Search** | Filters the active tab — rewrite tones, write situations, or phrases |
| **Copy / Insert** | Copy to clipboard, or drop the text into the compose box you were using |
| **Optional AI polish** | If Chrome's built-in on-device AI is available, drafts get an extra polish pass. Text stays on this device — it is not sent to a server. |

### What's stored on this device

- **Recent rewrites** — the last 10 source/result pairs, so you can reopen them
- **Favorites and slot defaults** — starred phrases, and names or details you typed into `[slots]`
- **Tone and audience** — remembered per site
- **Live selection** — the text you highlight right now is session-only and goes away when Chrome closes

Nothing is uploaded. There is no account and no remote backend.

---

## License

MIT — see [LICENSE](LICENSE).

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> Packaging weekend creations into serialized Pineapples🍍 Delivering with thought berries from a collective of blossoming builders.
