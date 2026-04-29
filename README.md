# Freelancer speed notification (fast + AI later)

This service monitors one or more Freelancer search URLs and sends **instant Telegram notifications** for new matching projects.

**Design goal:** speed first.

Flow:

- New project detected → instant basic filter → Telegram notification
- AI deep analysis runs after → edits the same Telegram message

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create `.env` from `.env.example` and fill values:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FREELANCER_SEARCH_URLS` (comma-separated)

3) Run:

```bash
npm run dev
```

## Notes

- **Fast layer** is meant to run every 2–5 seconds (`POLL_INTERVAL_MS`).
- **AI layer** is optional. If `OPENAI_API_KEY` is not set, the system still notifies instantly.

