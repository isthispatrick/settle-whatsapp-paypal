# Settle 💸

**Pay friends and split bills inside WhatsApp, powered by PayPal and Claude.**

In India you can send money in a WhatsApp chat with UPI. Almost everywhere else you can't: you leave the chat, open a banking app, ask for details, and somebody keeps a spreadsheet of who owes what. Settle is an AI agent you message (or add to a group) that closes that gap using the PayPal accounts people already have.

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
WhatsApp (Baileys)  ─┐
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
npm run whatsapp          # scan the QR with WhatsApp → Linked devices
```

Without PayPal credentials it runs in **mock mode** (fake payments with a local approve link).

**PayPal sandbox:** create a REST app at <https://developer.paypal.com/dashboard/applications/sandbox>, put its client ID and secret in `.env`, and use the sandbox *personal* account to approve payments and sandbox account emails as recipients.

**WhatsApp:** `npm run whatsapp` links to a WhatsApp account as a companion device. Mention `@settle` (or start a message with "Settle, …") in any DM or group that account is in. Set `DEDICATED_NUMBER=1` if the number is used only for the bot so every DM is answered. This uses the unofficial WhatsApp Web protocol, which is right for a prototype (the official Business API has no group support); use a spare number.

**Deploy the web demo:** `vercel --prod`, with the same environment variables set on the project.

## Limits and what's next

- The payer approves each payment in PayPal (one tap). Vaulted PayPal payment tokens would allow "reply YES to pay" with no redirect.
- The web demo keeps chat state in the browser; the WhatsApp bot keeps it in `data/state.json`. A real deployment needs a database.
- Production WhatsApp would use the official Business Platform for 1:1 chats.

MIT licensed.
