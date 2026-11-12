# Settle 💸

> **Taking over this project?** Start with [`HANDOFF.md`](HANDOFF.md): current status, the open problem and the submission checklist.

**Pay teammates and split bills inside Slack, powered by PayPal and Claude.**

In India you can send money inside a chat with UPI. Almost everywhere else you can't: you leave the chat, open a banking app, ask for details, and somebody keeps a spreadsheet of who owes what for the team lunch. Settle is an AI agent you DM (or invite to a channel) in Slack that closes that gap using the PayPal accounts people already have.

```
Tom:    @settle I paid £84 for dinner, split it between all of us
Settle: Got it — Dinner £84.00, £28.00 each. Aisha owes Tom £28.00, Shrey owes Tom £28.00
Aisha:  [photo of a receipt]  @settle split this, I had the wine
Settle: Recorded: Shrey £14.20, Tom £14.20, Aisha £31.60 …
Shrey:  @settle settle up
Settle: 💸 Shrey → Tom: £13.80 — tap to approve with PayPal: https://www.sandbox.paypal.com/checkoutnow?token=…
Settle: ✅ Shrey → Tom £13.80 paid via PayPal. All settled up.
```

## What it does

- **Send money in plain language** – "send Tom £20 for pizza", or to any PayPal email.
- **Group tab** – record shared expenses, equal or custom splits, simplified "who owes whom".
- **Receipt photos** – Claude reads the receipt (total, tax, tip, line items) and splits it, including "I only had the salad" style itemised splits.
- **Settle up** – one message creates PayPal payments for everything you owe; the tab updates when PayPal confirms.

## How it works

```
Slack (Socket Mode) ─┐
                     ├─►  agent core (src/agent.js)  ─►  Claude (tool use + vision)
Web demo (public/)  ─┘         │
                               ├─►  ledger (src/ledger.js)  integer-pence maths, debt simplification
                               └─►  PayPal Orders v2 (src/paypal.js)
```

- **AI:** Claude (`claude-opus-5-5`) via the Anthropic SDK tool runner. The model only decides *which tool to call*; all arithmetic, balance tracking and payment rules are deterministic code.
- **PayPal:** each payment is a [PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/) order with the recipient's PayPal email as `payee`. The payer taps the approval link, approves in PayPal, and Settle captures the order and posts the confirmation. Money goes payer → recipient; Settle never holds funds.
- **Safety:** a payment can only be created *from the person who sent the message*, it only moves after that person approves it in PayPal, there is a per-payment cap, and chat history / receipt text is treated as data, not instructions.

## Run it

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY and PayPal sandbox credentials
npm test                  # ledger + payment flow, offline
npm run web               # web demo at http://localhost:3000
npm run slack             # Slack bot (needs SLACK_BOT_TOKEN and SLACK_APP_TOKEN)
```

Without PayPal credentials it runs in **mock mode** (fake payments with a local approve link).

**PayPal sandbox:** create a REST app at <https://developer.paypal.com/dashboard/applications/sandbox>, put its client ID and secret in `.env`, and use the sandbox *personal* account to approve payments and sandbox account emails as recipients.

**Slack** (about two minutes):

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**, pick your workspace and paste [`slack-manifest.yml`](slack-manifest.yml).
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`) from *OAuth & Permissions* into `.env` as `SLACK_BOT_TOKEN`.
3. Under *Basic Information → App-Level Tokens*, generate a token with the `connections:write` scope and put it in `.env` as `SLACK_APP_TOKEN` (`xapp-…`).
4. `npm run slack`, then DM **Settle**, or `/invite @Settle` to a channel and mention it: `@Settle I paid £84 for lunch, split it between all of us`.

Settle answers every DM. In channels it only answers when mentioned (or when a message starts with "Settle, …"); it keeps the last few channel messages as context, and a receipt image posted just before "@Settle split this" is picked up. It uses Socket Mode, so no public URL is needed. **Not yet run against a real workspace:** the adapter is written and its text handling is unit-tested, but nobody has connected it with real tokens yet.

**Deploy the web demo:** `vercel --prod`, with the same environment variables set on the project.

## Limits and what's next

- The payer approves each payment in PayPal (one tap). Vaulted PayPal payment tokens would allow "reply YES to pay" with no redirect.

**iMessage (experimental, macOS):** `npm run imessage` reads new messages from the Messages app on a Mac and replies through it with the same agent. It needs Full Disk Access for Terminal and only answers messages that mention "settle". Observed working on 12 Nov 2026: an incoming iMessage got an agent reply, and `@settle send them £2` created a real PayPal sandbox order and posted its approval link in the chat. A payment approved from iMessage has not been completed yet.

- The web demo keeps chat state in the browser; the Slack bot keeps it in `data/slack-state.json`. A real deployment needs a database.
- The Slack bot runs in Socket Mode as one long-lived process for one workspace. A hosted, multi-workspace version would use the Events API with OAuth install and a database.
- Settle started as a WhatsApp bot; WhatsApp began blocking unofficial linked devices on 12 Nov 2026, so the chat side moved to Slack's official API.

MIT licensed.
