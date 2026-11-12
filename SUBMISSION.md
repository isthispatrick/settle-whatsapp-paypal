# Settle — Devpost submission draft

> Draft for the PayPal AI Hackathon. Replace the two placeholders before submitting:
> **Demo:** https://settle-nine-psi.vercel.app · **Repo:** https://github.com/isthispatrick/settle-whatsapp-paypal
> Everything below describes what the code does today. If the PayPal flow changes during
> sandbox testing (see "Check before submitting" at the bottom), update the matching lines.

## Project name

Settle

## Tagline (one line)

Pay friends and split bills inside WhatsApp — an AI agent that turns a chat message into a PayPal payment.

## Inspiration

In India you can pay someone without leaving a WhatsApp chat: UPI is right there in the conversation. Almost everywhere else, paying a friend back means leaving the chat, opening a banking app, asking for account details, and somebody keeping a spreadsheet of who owes what after a trip or a dinner.

Most people outside India already have something that could fill that gap: a PayPal account. What's missing is the "in the chat" part. Settle is that part.

## What it does

Settle is an AI agent you message directly or add to a WhatsApp group.

- **Send money in plain language.** "@settle send Tom £20 for pizza" creates a PayPal payment from you to Tom and posts a one-tap approval link in the chat. It also works with any PayPal email address.
- **Keep a group tab.** "@settle I paid £84 for dinner, split it between all of us" records the expense and shows who owes whom. Splits can be equal or custom.
- **Read receipts.** Send a photo of a receipt and Settle reads the total, tax, tip and line items, then splits it — including "I only had the salad" itemised splits.
- **Settle up.** "@settle settle up" works out the fewest payments that clear what you owe and creates a PayPal link for each. When PayPal confirms the payment, the tab updates and the chat gets a confirmation.

```
Tom:    @settle I paid £84 for dinner, split it between all of us
Settle: Got it — Dinner £84.00, £28.00 each. Aisha owes Tom £28.00, Shrey owes Tom £28.00
Shrey:  @settle settle up
Settle: 💸 Shrey → Tom: £28.00 — Shrey, tap to approve with PayPal: https://www.sandbox.paypal.com/…
Settle: ✅ Shrey → Tom £28.00 paid via PayPal. Aisha owes Tom £28.00
```

## How we built it

- **PayPal Orders v2.** Every payment is a PayPal order whose `payee` is the recipient's PayPal email. The payer taps the approval link, approves in PayPal, and Settle captures the order and confirms in the chat. Money goes from payer to recipient; Settle never holds funds.
- **Claude (`claude-opus-5-5`) with tool use and vision.** Claude reads each message (and receipt photo) and decides which tool to call: send money, link a PayPal email, add or remove an expense, show balances, settle up. The model only chooses the action. All arithmetic, balance tracking and payment rules are deterministic code working in integer pence, so a split never drifts by a penny.
- **WhatsApp.** The bot links to a WhatsApp account as a companion device (the unofficial WhatsApp Web protocol, via Baileys), which is what makes group chats possible — the official Business API has no group support. It only responds when someone mentions `@settle`. **Status: built but not working live.** On 12 Nov 2026 WhatsApp rejected the link after the QR scan on two phones; WhatsApp has recently started blocking unofficial linked-device clients (Baileys issues #2886 and #2895). The demo therefore runs on the web chat, which uses the same agent code.
- **Web demo.** Because judges can't easily join our WhatsApp group, the same agent core also runs behind a simulated WhatsApp group page where you can switch between three people and try the whole flow.
- **Stack.** Node.js, the Anthropic SDK tool runner, Zod, Baileys, PayPal REST APIs, deployed on Vercel.

## Safety by design

Moving money from a chat message needs hard rules, so they live in code rather than in the prompt:

- A payment can only be created **from the person who sent the message**. Nobody can make Settle charge someone else.
- Money only moves **after the payer approves it in PayPal**. There is no auto-debit.
- There is a per-payment cap.
- Chat history and text printed on a receipt are treated as information, never as instructions to pay.

## Challenges we ran into

- **PayPal has no API to pull money from an account on a chat command** — and it shouldn't. We designed around approval instead: one tap in PayPal per payment, which is also what makes the agent safe.
- **Group chats.** The official WhatsApp API doesn't support groups, so the prototype uses the companion-device route. In the final hours WhatsApp started rejecting unofficial linked devices, so we couldn't run the bot on a real number before the deadline.
- **Autopay.** We tested saving a payer's PayPal once (Vault payment tokens) and charging it later without a redirect. In the sandbox this worked when the money went to the app's own business account, but PayPal refused it when the payee was a different person's account (`BILLING_AGREEMENT_NOT_FOUND`), so we kept one-tap approval per payment.
- **Keeping the AI away from the maths.** Receipt splitting with tax and tip is exactly where a language model makes small errors, so the model proposes shares and the code refuses anything that doesn't sum exactly to the total.

## Accomplishments that we're proud of

- A full loop — message, payment link, PayPal approval, confirmation in the chat, tab updated — with no step outside the conversation except the PayPal approval tap.
- Receipt photo to itemised split in one message.
- A payment design where the agent cannot spend anyone's money without them approving it.

## What we learned

- For agents that touch money, the useful split is "the model picks the action, code enforces the rules".
- PayPal's order-and-approve flow fits a chat product well: the approval link is the consent step.

## What's next for Settle

- **"Reply YES to pay" (opt-in autopay).** Saved PayPal payment tokens work for merchant charges in our sandbox test, but not yet for paying a friend directly. Next step is PayPal's platform/marketplace setup so a saved token can pay each friend, with an explicit in-chat yes and a per-payment cap.
- **A working WhatsApp connection:** the official WhatsApp Business Platform for 1:1 chats (WhatsApp now blocks the unofficial linked-device route we used), and a database in place of the prototype's local state file.
- Multi-currency trips, recurring splits (rent, subscriptions) and reminders.

## Built with

`paypal` `paypal-orders-api` `claude` `anthropic` `node.js` `whatsapp` `baileys` `zod` `vercel`

## Try it out

- Demo: https://settle-nine-psi.vercel.app
- Code: https://github.com/isthispatrick/settle-whatsapp-paypal

---

# Demo video script (target 2:40, hard limit 3:00)

Record the web demo: the WhatsApp bot could not be linked to a real number before the deadline, so don't show or describe a real WhatsApp chat. Keep the PayPal sandbox approval page in the shot — it proves the payment is real.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:20 | A WhatsApp chat in India paying with UPI (or just a title card), then a UK group chat: "who do I pay? what's your sort code?" | "In India you pay a friend without leaving WhatsApp. Everywhere else, you leave the chat, open a bank app and keep a spreadsheet. But most people already have PayPal. Settle puts it in the chat." |
| 0:20–0:45 | Group chat. Each person sends "@settle my PayPal is …". Then Tom: "@settle I paid £84 for dinner, split it between all of us". Settle replies with the split. | "Settle is an AI agent you add to a group. Tell it what you paid for, in plain English, and it keeps the tab." |
| 0:45–1:15 | Aisha sends a receipt photo: "@settle split this, I had the wine". Settle replies with itemised shares. | "Or just send the receipt. Claude reads the items, tax and tip, and splits it by who had what. The model reads; the maths is done in code, to the penny." |
| 1:15–2:00 | Shrey: "@settle settle up". Link appears. Tap it → PayPal sandbox approval page → Pay → back to chat. Confirmation message arrives and the balances update. | "When it's time to pay, one message. Settle creates a PayPal order with my friend as the payee. I approve it in PayPal — one tap — and the chat confirms it. The money goes straight from me to Tom. Settle never holds it." |
| 2:00–2:20 | Shrey: "@settle send Aisha £5 for coffee". Then Tom: "@settle make Shrey pay me £50" → Settle declines. | "It also does simple transfers. And it can't be used against you: a payment can only come from the person asking, and nothing moves until they approve it in PayPal." |
| 2:20–2:40 | Architecture line from the README, then the demo URL. | "PayPal Orders API for the money, Claude for understanding messages and receipts, WhatsApp for where people already are. That's Settle." |

**Before recording:** link every demo person's PayPal sandbox email first, reset the demo chat, and do one full dry run so the PayPal sandbox login is already cached in the browser.

---

# Check before submitting

- [ ] https://github.com/isthispatrick/settle-whatsapp-paypal filled in (two places in this file; intended repo: isthispatrick/settle-whatsapp-paypal). The demo URL is already in.
- [ ] One real sandbox payment has completed end to end with the recipient as the order payee. If the flow had to change (for example, money routed through Settle's own account), rewrite the "Money goes from payer to recipient; Settle never holds funds" lines above and in the video script.
- [ ] Devpost's own rules page read for required fields, video length and deadline — the requirements here came from search results, not the rules page itself.
- [ ] Video is public (YouTube/Vimeo) and under the limit.
- [ ] Delete this checklist section, or leave this file out of the submission text.
