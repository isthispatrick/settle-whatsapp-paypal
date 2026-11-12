# Handoff — read this first

Written 12 Nov 2026, 09:15 PST (22:45 IST), for whoever takes over from Shreyansh.

**Deadline:** Devpost lists **12 Nov 2026, 12:00pm PST** (13 Nov, 01:30 IST). Some third-party sites list later times; trust the Devpost page and re-read it yourself: <https://paypalaihackathon.devpost.com/rules>.

**One thing is unfinished: no PayPal sandbox payment has completed yet.** Everything else is built, tested and live. Details and the decision you need to make are in [The open problem](#the-open-problem).

## Where everything is

| Thing | Location |
|---|---|
| Code | this repo, branch `main` |
| Live demo | <https://settle-nine-psi.vercel.app> (Vercel project `settle`, on Shreyansh's Vercel account) |
| Devpost text + video script | [`SUBMISSION.md`](SUBMISSION.md) |
| What the project is, how it works | [`README.md`](README.md) |
| Secrets | **not in this repo.** Get them from Shreyansh directly (see below) |

## What you need from Shreyansh (ask him privately, never commit these)

1. `ANTHROPIC_API_KEY`
2. PayPal sandbox app **client ID and secret** (there are two apps, see below)
3. Logins for the PayPal sandbox **buyer** accounts (you type these on PayPal's approval page)
4. Access to the PayPal developer dashboard (developer.paypal.com), or have him check things in it for you
5. If you need to redeploy or change keys on the live demo: access to the Vercel project, and push access to this repo

Put the keys in a local `.env` (copy `.env.example`). `.env` and `data/` are gitignored.

## What works (verified)

- `npm test` passes: ledger maths, payment flow in mock mode, and regression tests from a code review.
- **Claude path, end to end:** linking a PayPal email, adding expenses, balances, settle-up, and refusing to make someone else pay. Replies take 2–4 seconds.
- **Receipt photos:** an itemised split ("I had the wine, Tom the pizza, we shared the salad") came out right to the penny, service charge included.
- **PayPal order creation:** real sandbox orders are created and return real approval links, both locally and from the live demo.
- **Live demo:** has `ANTHROPIC_API_KEY`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` set and runs in PayPal sandbox mode.
- **Failure handling:** when PayPal refuses a capture, the chat says so and nothing is recorded on the tab.

## Not tested at all

- **The WhatsApp bot** (`npm run whatsapp`). It has never been linked to a number or run against real messages. Treat it as unverified code. If there is no time, the video can be recorded on the web demo, which runs the same agent.

## The open problem

A payment has to be *approved by the payer* on PayPal's page and then *captured* by our code. Order creation works; **no order has been captured.** Every attempt was refused by PayPal:

| # | App that created the order | Buyer logged in | Recipient (payee) | Currency | Result |
|---|---|---|---|---|---|
| 1 | original app (owned by an **Indian** sandbox business) | `settle-buyer-20261112@personal.example.com` (country **IN**) | `tom-test@example.com` (made-up, not a sandbox account) | GBP | Buyer approved. Capture failed: `INSTRUMENT_DECLINED` |
| 2 | original app | Indian buyer | `sb-vlqbd14688751@business.example.com` (Indian sandbox business) | GBP | Checkout page: "This seller doesn't accept payments in your currency" |
| 3 | original app | Indian buyer | same Indian business | USD | Same currency error |
| 4 | original app | reported as `settle-uk-buyer-20261112@personal.example.com` | `settle-uk-tom-20261112@business.example.com` | GBP | Checkout page: "declined in order to comply with international regulations" |
| 5 | **new app "Settle UK"** (`APP-5KP33190P4233084V`) | reported as the UK buyer | `settle-uk-tom-20261112@business.example.com` | GBP | Same "international regulations" decline |

What the PayPal API says about the declined orders: nothing. They stay `PAYER_ACTION_REQUIRED` with no payer and no error object, because the decline happens on PayPal's checkout page before a payer is attached. So the cause can't be read from code.

**Working theory (not proven):** an Indian account is still involved somewhere. PayPal does not allow payments between two Indian accounts, and the developer account here is Indian, so sandbox accounts default to India. Three facts would settle it, all visible only in the PayPal developer dashboard:

1. In **Testing Tools → Sandbox Accounts**, the **Country** shown for `settle-uk-buyer-20261112` and `settle-uk-tom-20261112`. If either says India, that is the cause: recreate it with country United Kingdom.
2. Which buyer was actually logged in on attempts 4 and 5. One decline page showed an "SD" badge, which matches the Indian buyer's name. Use a private browser window so no old session carries over.
3. Under **Apps & Credentials**, which sandbox business account the "Settle UK" app is linked to.

Untested combinations worth one try each, if the dashboard doesn't explain it:
- Two sandbox accounts created with country **United States** and a USD order.
- The Indian buyer paying the UK business (cross-border from India is normally allowed).

### State of the keys right now

- **Shreyansh's laptop, `~/settle/.env`:** the new "Settle UK" app's client ID and secret.
- **Vercel (live demo):** still the **original Indian-owned app's** keys. If the UK app turns out to be the one that works, the two `PAYPAL_` variables on Vercel must be replaced and the project redeployed.
- The original keys are backed up on the laptop only, in `~/settle/data/env-backup-india-app`.

### How to run a capture test

There is no committed script for this; the ad-hoc ones are in the gitignored `data/` folder on Shreyansh's laptop. The simplest route needs no script:

1. `npm run web`, open <http://localhost:3000>.
2. As Tom: `@settle my PayPal is <recipient sandbox email>`.
3. As Shrey: `@settle send Tom £2 for a test`.
4. Open the approval link in a **private window**, log in as the sandbox buyer, click Pay.
5. Keep the demo tab open. It polls PayPal every 4 seconds and posts either `✅ … paid via PayPal` or `❌ … didn't go through — <PayPal's reason>`.

The default currency is GBP (`DEFAULT_CURRENCY` in `.env`); say "$2" in the message, or change that variable, to test USD.

### If it can't be fixed in time

Suggested cut-off: **10:00am PST**. After that, record the video with what works: the chat, the receipt split, real PayPal order creation and the approval link opening PayPal's page. Then **edit `SUBMISSION.md` before submitting**, because it currently describes a completed payment:

- "How we built it": the sentence ending "Settle captures the order and confirms in the chat. Money goes from payer to recipient; Settle never holds funds."
- "Accomplishments": the "full loop" bullet.
- Video script rows 1:15–2:00.

Say plainly that capture is implemented but was not completed in the sandbox because of account-region restrictions. Do not claim a payment that didn't happen.

A different fallback, if the problem is only "paying a third-party email": drop `payee` from the order in `src/paypal.js` so money goes to the app's own business account, then forward it with the Payouts API (the apps have the payouts scope). That is about 30 lines, but then Settle holds funds briefly and the README and submission text must say so. It does not help if the buyer account itself is what PayPal is declining.

## Submission checklist

- [x] Public repo with MIT licence
- [x] Live demo URL that judges can open
- [x] Description and video script drafted (`SUBMISSION.md`)
- [ ] A sandbox payment captured end to end (see above)
- [ ] Demo video recorded, under 3 minutes, uploaded publicly
- [ ] `SUBMISSION.md` adjusted to match what was actually achieved
- [ ] Devpost form filled in: description, demo URL, repo URL, video URL, and which AI tools were used (Claude `claude-opus-5-5` via the Anthropic SDK: tool use for actions, vision for receipts)
- [ ] Devpost rules page read for any field this list misses
- [ ] Judges need a way to approve a sandbox payment: put sandbox buyer login details in Devpost's private testing-instructions field, not in this repo
- [ ] Set a spend limit on the Anthropic key. The demo's `/api/chat` endpoint is public and its rate limit is weak on serverless

## Things that will trip you up

- Commands shown with a leading `!` in earlier notes are for the Claude Code prompt only. In a normal terminal, drop the `!`.
- On Vercel, leave `PUBLIC_URL` unset; the app works out its own URL. Locally, set it to wherever PayPal should send the payer back.
- Without `PAYPAL_CLIENT_ID` the app runs in **mock mode** (fake approve links). The badge at the top of the demo page shows which mode is active.
- The bot only reacts to `@settle` or a message that starts with "Settle". That is deliberate, so it stays quiet in normal chat.
- The WhatsApp side uses the unofficial WhatsApp Web protocol (Baileys). Use a spare number.
- Known gap accepted for the demo: in WhatsApp groups, @-mentions of other people may show as numbers instead of names; using plain names works.
