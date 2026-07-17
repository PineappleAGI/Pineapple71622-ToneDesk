# ToneDesk

Chrome extension that helps you write professional, tactful business messages in **Gmail**, **LinkedIn**, **Slack (web)**, and **WhatsApp Web**.

## Features

- Floating ✉ button when you focus a message field
- 3-step conversational intake (intent → situation → relationship)
- AI-powered drafts with formal / shorter / softer variants
- **Multiple AI providers** — Claude (default), Gemini, or OpenAI
- One-tap **Copy** or **Insert** into the active field
- Optional fine-tune without restarting the flow
- Options page for provider, API key, default tone, and per-site toggles

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `tonedesk` folder
5. Open **ToneDesk Settings**, choose your AI provider (Claude is default), and paste your API key

## AI providers

| Provider | Default model | API key from |
|----------|---------------|--------------|
| **Claude (Anthropic)** — default | claude-sonnet-4 | [console.anthropic.com](https://console.anthropic.com/) |
| Gemini (Google) | gemini-2.0-flash | [aistudio.google.com](https://aistudio.google.com/) |
| OpenAI | gpt-4o-mini | [platform.openai.com](https://platform.openai.com/) |

Each provider stores its own API key locally. If you previously saved an OpenAI key, it remains available when you select OpenAI.

## Use

1. Open Gmail (best first test)
2. Click into a compose / reply field
3. Click the navy ToneDesk button near the field
4. Answer up to 3 short questions
5. Copy or insert the draft

## Permissions

- `activeTab`, `scripting`, `storage`, `clipboardWrite`, `sidePanel`
- Host access for Gmail, LinkedIn, Slack, WhatsApp Web, and AI provider APIs (`api.anthropic.com`, `generativelanguage.googleapis.com`, `api.openai.com`)

API keys are stored only in `chrome.storage.local`. No accounts, history, or analytics.
