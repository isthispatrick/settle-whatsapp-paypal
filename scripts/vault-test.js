// Autopay feasibility test: save a buyer's PayPal wallet once (Vault v3), then charge it with no buyer present.
// SANDBOX ONLY. Credentials come from .env; the saved token is written to data/ (both gitignored).
//
//   node scripts/vault-test.js setup                  # prints a one-time approval link for the buyer
//   node scripts/vault-test.js charge                 # (a) charge the app's own business account
//   node scripts/vault-test.js charge <payee email>   # (b) charge with purchase_units[0].payee = another business
//   node scripts/vault-test.js delete                 # delete the saved payment token
//
// Checked against PayPal's docs and OpenAPI specs (Nov 2026):
//   Guide: https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
//   Vault v3 spec 3.4:  https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/vault_payment_tokens_v3.json
//   Orders v2 spec 2.32: https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/checkout_orders_v2.json
// - Setup token: POST /v3/vault/setup-tokens, payment_source.paypal {usage_type MERCHANT|PLATFORM, usage_pattern,
//   customer_type, experience_context.return_url/cancel_url}. Payer approves at the "approve" link.
//   Status enum: CREATED, PAYER_ACTION_REQUIRED, APPROVED, VAULTED, TOKENIZED.
// - Payment token: POST /v3/vault/payment-tokens {payment_source: {token: {id, type: "SETUP_TOKEN"}}}.
// - Charge: POST /v2/checkout/orders with payment_source.paypal.vault_id. PayPal-Request-Id is mandatory for
//   single-step orders with a vault_id. stored_credential.payment_initiator (CUSTOMER|MERCHANT) is required
//   when stored_credential is sent; usage is FIRST|SUBSEQUENT|DERIVED. The guide's sample response is COMPLETED
//   on create, so /capture is called only if it isn't.
// - The docs do NOT say whether a token saved by merchant A may pay a different payee B. Test (b) is what decides it.
import "dotenv/config";
import fs from "node:fs";

if (process.env.PAYPAL_ENV === "live") throw new Error("sandbox only");
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error("set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env");
const BASE = "https://api-m.sandbox.paypal.com";
const TOKEN_FILE = "data/vault-token.json";
const [cmd, payee] = process.argv.slice(2);

const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
const tok = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
}).then((r) => r.json());
if (!tok.access_token) throw new Error(`auth failed: ${tok.error_description ?? tok.error}`);
console.log("app has vault scope:", /vault/.test(tok.scope ?? ""));

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : {} };
}
const fail = (what, r) => { console.log(`${what} FAILED (${r.status}):`, JSON.stringify(r.json, null, 2)); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = () => JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));

if (cmd === "setup") {
  const st = await call("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: "Settle autopay (sandbox test)",
        usage_type: "MERCHANT",
        usage_pattern: "IMMEDIATE",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: false,
        experience_context: { brand_name: "Settle", shipping_preference: "NO_SHIPPING",
          return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" },
      },
    },
  });
  if (!st.ok) fail("setup token", st);
  console.log("\nAPPROVE ONCE (private window, sandbox buyer):", st.json.links?.find((l) => l.rel === "approve")?.href, "\n");
  for (let i = 0; ; i++) {
    await sleep(4000);
    const s = await call("GET", `/v3/vault/setup-tokens/${st.json.id}`);
    process.stdout.write(`${s.json.status} `);
    if (s.json.status === "APPROVED") break;
    if (i > 150) { console.log("\ngave up after 10 min"); process.exit(1); }
  }
  const pt = await call("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: st.json.id, type: "SETUP_TOKEN" } } });
  if (!pt.ok) fail("payment token", pt);
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ vault_id: pt.json.id, customer_id: pt.json.customer?.id }));
  console.log("\nPayment token saved to", TOKEN_FILE);
} else if (cmd === "charge") {
  const { vault_id } = saved();
  const pu = { amount: { currency_code: process.env.DEFAULT_CURRENCY || "GBP", value: "1.00" }, description: "Settle autopay test" };
  if (payee) pu.payee = { email_address: payee };
  const o = await call("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [pu],
    payment_source: { paypal: { vault_id, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "IMMEDIATE" } } },
  });
  if (!o.ok) fail("order with vault_id", o);
  let order = o.json;
  console.log("order", order.id, "status on create:", order.status);
  if (order.status !== "COMPLETED") {
    const c = await call("POST", `/v2/checkout/orders/${order.id}/capture`, {});
    if (!c.ok) fail("capture", c);
    order = c.json;
  }
  const unit = (await call("GET", `/v2/checkout/orders/${order.id}`)).json.purchase_units[0];
  const capture = unit.payments?.captures?.[0]?.status;
  console.log("capture status:", capture, "| received by:", unit.payee?.email_address, unit.payee?.merchant_id);
  if (capture !== "COMPLETED") console.log("RESULT: not completed");
  else if (!payee) console.log("RESULT (a): merchant autopay works (charged the app's own business)");
  else console.log(unit.payee?.email_address === payee ? "RESULT (b): charged the different business" : "RESULT (b): payee MISMATCH, money did not go to the requested business");
} else if (cmd === "delete") {
  const d = await call("DELETE", `/v3/vault/payment-tokens/${saved().vault_id}`);
  if (!d.ok) fail("delete", d);
  fs.rmSync(TOKEN_FILE);
  console.log("payment token deleted");
} else console.log("usage: setup | charge [payeeEmail] | delete");
