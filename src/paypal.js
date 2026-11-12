// PayPal Orders v2. The payer approves each payment in PayPal, and the order's `payee`
// is the recipient's PayPal email, so money moves payer -> recipient directly.
// With no PAYPAL_CLIENT_ID set, runs in MOCK mode (fake orders, local approve link) for development.

const LIVE = process.env.PAYPAL_ENV === "live";
const BASE = LIVE ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
export const MOCK = !process.env.PAYPAL_CLIENT_ID;
export const paypalMode = MOCK ? "mock" : LIVE ? "live" : "sandbox";

const mockOrders = new Map();
let token = null;

async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const issue = json.details?.[0];
    const err = new Error(`PayPal ${json.name ?? res.status}: ${issue?.description ?? json.message ?? text}`);
    err.issue = issue?.issue;
    throw err;
  }
  return json;
}

/** Create an order paying `payeeEmail`. Returns { id, approveUrl }. */
export async function createOrder({ amountMinor, currency, payeeEmail, description, publicUrl }) {
  if (MOCK) {
    const id = `MOCK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
    mockOrders.set(id, "CREATED");
    return { id, approveUrl: `${publicUrl}/api/mock-approve?id=${id}` };
  }
  const order = await api(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: currency, value: (amountMinor / 100).toFixed(2) },
          payee: { email_address: payeeEmail },
          description: description?.slice(0, 127),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Settle",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${publicUrl}/paid.html`,
            cancel_url: `${publicUrl}/paid.html?cancelled=1`,
          },
        },
      },
    },
    { "PayPal-Request-Id": crypto.randomUUID() },
  );
  const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal returned no approval link");
  return { id: order.id, approveUrl };
}

/**
 * Check an order and capture it once the payer has approved.
 * Returns "WAITING" | "COMPLETED" | "PENDING" (captured, funds held for payee) | "FAILED".
 */
export async function settleOrder(id) {
  if (MOCK || id.startsWith("MOCK-")) {
    const s = mockOrders.get(id);
    return s === "APPROVED" ? (mockOrders.set(id, "COMPLETED"), "COMPLETED") : s === "COMPLETED" ? "COMPLETED" : "WAITING";
  }
  const order = await api("GET", `/v2/checkout/orders/${id}`);
  if (order.status === "COMPLETED") return captureStatus(order);
  if (order.status !== "APPROVED") return order.status === "VOIDED" ? "FAILED" : "WAITING";
  try {
    return captureStatus(await api("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Request-Id": `cap-${id}` }));
  } catch (e) {
    if (e.issue === "ORDER_ALREADY_CAPTURED") return "COMPLETED";
    throw e;
  }
}

function captureStatus(order) {
  const s = order.purchase_units?.[0]?.payments?.captures?.[0]?.status;
  return s === "COMPLETED" ? "COMPLETED" : s === "PENDING" ? "PENDING" : s ? "FAILED" : "WAITING";
}

export function mockApprove(id) {
  if (!mockOrders.has(id)) return false;
  mockOrders.set(id, "APPROVED");
  return true;
}
