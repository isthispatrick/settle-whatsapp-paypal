// HTTP handlers for the web demo. The browser holds the chat state and sends it with each
// request, so these work unchanged on serverless (Vercel) and on the local server.
import { handleMessage, checkPayment, isAddressed, noteMessage } from "./agent.js";
import { newChat, touchMember } from "./ledger.js";
import { mockApprove, paypalMode } from "./paypal.js";

const hits = [];
function rateLimited() {
  const now = Date.now();
  while (hits.length && hits[0] < now - 60_000) hits.shift();
  if (hits.length >= 40) return true;
  hits.push(now);
  return false;
}

export const publicUrlOf = (req) =>
  process.env.PUBLIC_URL ||
  `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;

const ID = /^[a-z0-9][\w.-]{0,39}$/i;
const validId = (id) => typeof id === "string" && ID.test(id) && !["__proto__", "constructor", "prototype"].includes(id);

// The state comes back from the browser, so rebuild the keyed maps defensively.
function loadState(body) {
  const s = body.state && typeof body.state === "object" ? body.state : newChat("web-demo", true);
  const members = Object.create(null);
  for (const [id, m] of Object.entries(s.members && typeof s.members === "object" ? s.members : {}))
    if (validId(id) && m && typeof m === "object")
      members[id] = { name: String(m.name || id).slice(0, 40), paypalEmail: typeof m.paypalEmail === "string" ? m.paypalEmail.slice(0, 120) : null };
  s.members = members;
  const payments = Object.create(null);
  for (const [id, p] of Object.entries(s.payments && typeof s.payments === "object" ? s.payments : {}))
    if (/^[\w-]{1,40}$/.test(id) && id !== "__proto__" && p && typeof p === "object") payments[id] = p;
  s.payments = payments;
  for (const k of ["expenses", "settlements", "transcript"]) if (!Array.isArray(s[k])) s[k] = [];
  s.isGroup = true;
  s.seq = Number(s.seq) || 0;
  return s;
}

export async function chatApi(body, publicUrl) {
  const text = String(body.text || "").slice(0, 2000);
  const sender = { id: body.sender?.id, name: String(body.sender?.name || "").slice(0, 40) };
  if (!validId(sender.id) || !sender.name) return { status: 400, json: { error: "valid sender required" } };
  const image = body.image?.data && /^image\/(jpeg|png|webp|gif)$/.test(body.image.mediaType) ? body.image : null;
  const chat = loadState(body);
  for (const m of (body.members || []).slice(0, 12)) if (validId(m?.id) && m?.name) touchMember(chat, m.id, String(m.name).slice(0, 40));

  if (!isAddressed(chat, text)) {
    noteMessage(chat, sender, text || "(sent a photo)");
    return { status: 200, json: { state: chat, replies: [], responded: false, paypalMode } };
  }
  if (rateLimited()) return { status: 429, json: { error: "Demo is busy, try again in a minute." } };
  const { replies, newPayments } = await handleMessage({ chat, sender, text, image, publicUrl });
  return { status: 200, json: { state: chat, replies, newPayments, responded: true, paypalMode } };
}

export async function paymentApi(body) {
  const chat = loadState(body);
  const messages = [];
  const pending = [];
  // Mock approvals happen in the browser (see mockApproveApi), so they work across serverless instances.
  for (const id of (body.approvedMock || []).slice(0, 20)) mockApprove(String(id));
  for (const id of (body.orderIds || []).slice(0, 10)) {
    try {
      const r = await checkPayment(chat, String(id));
      if (r.message) messages.push(r.message);
      if (!r.done) pending.push(id);
    } catch (e) {
      console.error("payment check failed:", e.message);
      pending.push(id);
    }
  }
  return { status: 200, json: { state: chat, messages, pending } };
}

export function mockApproveApi(id) {
  const ok = mockApprove(String(id || ""));
  return {
    status: ok ? 200 : 404,
    html: `<meta name=viewport content="width=device-width"><body style="font:18px system-ui;text-align:center;padding:60px 20px">${
      ok ? "✅ Approved (mock PayPal).<br>Go back to the chat." : "Unknown payment."
    }</body>${ok ? `<script>try{const k="settle-mock-approved",a=JSON.parse(localStorage.getItem(k)||"[]");a.push(${JSON.stringify(String(id))});localStorage.setItem(k,JSON.stringify(a.slice(-50)))}catch{}</script>` : ""}`,
  };
}
