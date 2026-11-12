# Settle — instructions for Claude

You are picking up a hackathon project mid-flight from another person and another Claude session. **Read [`HANDOFF.md`](HANDOFF.md) in full before doing anything**: it has the deadline, what is verified, what is not, and the one open problem (no PayPal sandbox payment has been captured yet). Then tell the person you are working with, in a few lines, where things stand and what the next step is.

## What this is

A Slack (and web demo) agent that sends money and splits bills through PayPal. It began as a WhatsApp bot; WhatsApp blocked the unofficial client, so that adapter was removed on 13 Nov 2026. Plain Node.js ESM, no build step.

- `src/agent.js` — Claude tool-use agent (tools, system prompt, payment polling). Channel-agnostic.
- `src/ledger.js` — expense ledger in integer minor units, debt simplification.
- `src/paypal.js` — PayPal Orders v2 (create, check, capture) and mock mode.
- `src/http.js`, `api/*.js`, `src/server.js` — web demo API (Vercel functions and local server share the handlers).
- `src/slack.js`, `src/slack-text.js` — Slack adapter (Bolt, Socket Mode) and its text helpers. Not yet run against a real workspace. Setup is in the README; the app manifest is `slack-manifest.yml`.
- `src/imessage.js` — experimental macOS iMessage adapter, unverified.
- `public/index.html` — the simulated group chat judges use.
- `test/ledger.test.js` — offline tests. Run `npm test` after any change.

## Commands

```bash
npm install
npm test            # must pass before committing
npm run web         # http://localhost:3000
npm run slack       # needs SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env
```

## Rules for this repo

- **Never commit secrets.** `.env` and `data/` are gitignored; keep API keys, PayPal client secrets and sandbox passwords out of every tracked file, commit message and doc. The repo is public.
- **PayPal sandbox only.** Do not set `PAYPAL_ENV=live`.
- Keep the safety properties intact: a payment is only ever created from the sender of the current message, money moves only after that person approves on PayPal, amounts are capped by `MAX_PAYMENT`, and all arithmetic stays in code, not in the model.
- The model is `claude-opus-5-5` through the Anthropic SDK tool runner (`src/agent.js`). Don't swap models or SDK call shapes without re-running a real conversation through `/api/chat`.
- Don't claim in `README.md` or `SUBMISSION.md` anything that hasn't been observed working. If the payment flow changes (for example routing money through the app's own account), update both files in the same commit.
- Deploying (`vercel deploy --prod`) and changing Vercel environment variables affect the link judges use. Confirm with the person you're working with first.

## Likely first tasks

1. Get the keys from the person you're working with into a local `.env` (see `.env.example`), run `npm test`, then `npm run web`.
2. Work the open PayPal problem using the test log and the three dashboard questions in `HANDOFF.md`. Don't repeat combinations already listed there as failed.
3. Once a capture succeeds, or the cut-off passes, bring `SUBMISSION.md` in line with reality and help with the Devpost form.
