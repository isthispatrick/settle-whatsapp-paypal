// Exercises the ledger and the payment flow in PayPal mock mode, without calling the model.
import assert from "node:assert/strict";
delete process.env.PAYPAL_CLIENT_ID;
const { newChat, touchMember, transfers, equalSplit } = await import("../src/ledger.js");
const { buildTools, checkPayment, isAddressed } = await import("../src/agent.js");
const { mockApprove } = await import("../src/paypal.js");

assert.deepEqual(equalSplit(1000, 3), [334, 333, 333]);

const chat = newChat("g", true);
for (const [id, n] of [["s", "Shrey"], ["a", "Aisha"], ["t", "Tom"]]) touchMember(chat, id, n);
const as = (id) => {
  const ctx = { sender: { id }, publicUrl: "http://x", outbox: [], newPayments: [] };
  const tools = Object.fromEntries(buildTools(chat, ctx).map((t) => [t.name, t.run]));
  return { ctx, tools };
};

// Shrey pays 84 split three ways; Tom pays 30 for Tom + Aisha.
let r = await as("s").tools.add_expense({ description: "Dinner", amount: 84 });
assert.match(r, /Recorded E1/);
await as("t").tools.add_expense({ description: "Taxi", amount: 30, split_among: ["tom", "Aisha"] });
assert.deepEqual(transfers(chat), [
  { from: "a", to: "s", amount: 4300, currency: "GBP" },
  { from: "t", to: "s", amount: 1300, currency: "GBP" },
]);

// Shares must sum to the total.
r = await as("s").tools.add_expense({ description: "Bad", amount: 10, shares: [{ member: "Tom", amount: 4 }, { member: "Aisha", amount: 5 }] });
assert.match(r, /^ERROR: Shares add up/);
assert.equal(chat.expenses.length, 2);

// Settling needs the recipient's PayPal email.
r = await as("a").tools.settle_up({});
assert.match(r, /hasn't linked a PayPal/);
await as("s").tools.link_paypal({ email: "Shrey@Example.com" });
const a = as("a");
r = await a.tools.settle_up({});
assert.match(r, /£43.00 to Shrey/);
assert.equal(a.ctx.outbox.length, 1);
const [orderId] = a.ctx.newPayments;

// Nothing moves until the payer approves.
assert.deepEqual(await checkPayment(chat, orderId), { done: false });
assert.equal(transfers(chat).length, 2);
mockApprove(orderId);
const done = await checkPayment(chat, orderId);
assert.equal(done.done, true);
assert.match(done.message, /✅/);
assert.deepEqual(transfers(chat), [{ from: "t", to: "s", amount: 1300, currency: "GBP" }]);
assert.deepEqual(await checkPayment(chat, orderId), { done: true }); // idempotent

// Guards: self-pay, limit, unknown member.
assert.match(await as("s").tools.send_money({ to: "Shrey", amount: 5 }), /can't pay yourself/);
assert.match(await as("t").tools.send_money({ to: "shrey", amount: 5000 }), /limit/);
assert.match(await as("t").tools.send_money({ to: "Bob", amount: 5 }), /No member called/);
assert.match(await as("t").tools.send_money({ to: "bob@example.com", amount: 5, currency: "EUR" }), /€5.00 to bob@example.com/);

assert.equal(isAddressed({ isGroup: true }, "hey @settle split this"), true);
assert.equal(isAddressed({ isGroup: true }, "Settle, who owes what?"), true);
assert.equal(isAddressed({ isGroup: true }, "let's settle this later"), false);
assert.equal(isAddressed({ isGroup: true }, "hey settle, send Tom £5"), true);
assert.equal(isAddressed({ isGroup: true }, "unsettled weather"), false);
assert.equal(isAddressed({ isGroup: false }, "hi"), true);
console.log("all tests passed");

// Regression: review findings.
{
  const { chatApi, paymentApi } = await import("../src/http.js");
  const bad = await chatApi({ sender: { id: "__proto__", name: "Mallory" }, text: "hello" }, "http://x");
  assert.equal(bad.status, 400);
  const polluted = await chatApi({ state: JSON.parse('{"members":{"__proto__":{"name":"M"},"ok":{"name":"Ok"}}}'), sender: { id: "ok", name: "Ok" }, text: "hello" }, "http://x");
  assert.equal(polluted.status, 200);
  assert.equal({}.name, undefined);
  assert.deepEqual(Object.keys(polluted.json.state.members), ["ok"]);

  // A second "settle up" before approving must not create a second link.
  const b = as("t");
  assert.match(await b.tools.settle_up({}), /£13.00 to Shrey/);
  const again = as("t");
  assert.match(await again.tools.settle_up({}), /already has payment links/);
  assert.equal(again.ctx.newPayments.length, 0);

  // Mock approval passed from the browser completes the payment on any instance.
  const [id] = b.ctx.newPayments;
  const out = await paymentApi({ state: JSON.parse(JSON.stringify(chat)), orderIds: [id], approvedMock: [id] });
  assert.equal(out.json.pending.length, 0);
  assert.match(out.json.messages[0], /✅/);
}
console.log("review regressions passed");
