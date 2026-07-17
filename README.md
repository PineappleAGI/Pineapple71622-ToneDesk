# ToneDesk

Chrome extension that helps you write professional, tactful business messages in **Gmail**, **LinkedIn**, **Slack (web)**, and **WhatsApp Web**.

## Features

- Floating ✉ button when you focus a message field
- **Reads page context** from the active site (thread, subject, compose field, selected text)
- AI-generated **context summary** for you to verify before drafting
- **Offline fallback** when AI quota is exhausted or no API key — page capture + template drafts still work
- AI-powered drafts with formal / shorter / softer variants (offline variants use simple transforms)
- **Multiple AI providers** — Gemini (default), Claude, or OpenAI
- One-tap **Copy** or **Insert** into the active field
- Optional fine-tune without restarting the flow
- Options page for provider, API key, default tone, and per-site toggles

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `tonedesk` folder
5. Open **ToneDesk Settings**, keep **Gemini** selected (default), and paste your free API key from [Google AI Studio](https://aistudio.google.com/apikey)

## AI providers

| Provider | Default model | API key from | Cost |
|----------|---------------|--------------|------|
| **Gemini (Google)** — default | gemini-2.5-flash-lite | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | **Free tier** (rate limits apply) |
| Claude (Anthropic) | claude-sonnet-4 | [console.anthropic.com](https://console.anthropic.com/) | Paid API |
| OpenAI | gpt-4o-mini | [platform.openai.com](https://platform.openai.com/) | Paid API |

**Gemini is the recommended starting point.** Google AI Studio offers a free API key with usage limits — enough for everyday drafting. Claude and OpenAI remain available if you already have paid keys.

**Free tier varies by model.** Not every Gemini model is free for every project. If you see a quota error with `limit: 0`, that model has no free-tier allowance for your API key/project — try a current Flash-Lite model (ToneDesk defaults to `gemini-2.5-flash-lite`), wait for limits to reset, or enable billing. Check live limits at [ai.dev/rate-limit](https://ai.dev/rate-limit).

Each provider stores its own API key locally. If you previously saved an OpenAI key, it remains available when you select OpenAI.

## Use

1. Open Gmail (best first test)
2. Click into a compose / reply field
3. Click the navy ToneDesk button near the field
4. Review the **context summary** ToneDesk read from the page — edit if needed, then tap **Looks right — draft**
5. Copy or insert the draft

If the page has little context to read, ToneDesk asks one short free-text question instead of a multi-step quiz.

### When AI quota is exhausted

ToneDesk no longer gets stuck on "Reading…" when Gemini (or another provider) hits rate limits:

1. **Verify step** — Shows a local summary built from what was captured on the page (subject, thread snippets, compose field). You can edit it and continue.
2. **Draft step** — Falls back to a template-based offline draft (soft opener, acknowledgment, body, closer). Platform-aware length (Slack/WhatsApp shorter, email longer).
3. **Variants** — Formal / shorter / softer still work offline via simple string transforms.

Add or refresh your API key in settings when quota resets for AI-powered summaries and drafts.

## Permissions

- `activeTab`, `scripting`, `storage`, `clipboardWrite`, `sidePanel`
- Host access for Gmail, LinkedIn, Slack, WhatsApp Web, and AI provider APIs (`api.anthropic.com`, `generativelanguage.googleapis.com`, `api.openai.com`)

API keys are stored only in `chrome.storage.local`. No accounts, history, or analytics.
