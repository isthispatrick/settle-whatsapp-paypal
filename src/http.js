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

function loadState(body) {
  const s = body.state && typeof body.state === "object" ? body.state : newChat("web-demo", true);
  for (const k of ["members", "payments"]) if (!s[k] || typeof s[k] !== "object") s[k] = {};
  for (const k of ["expenses", "settlements", "transcript"]) if (!Array.isArray(s[k])) s[k] = [];
  s.isGroup = true;
  s.seq = Number(s.seq) || 0;
  return s;
}

export async function chatApi(body, publicUrl) {
  const text = String(body.text || "").slice(0, 2000);
  const sender = { id: String(body.sender?.id || "").slice(0, 40), name: String(body.sender?.name || "").slice(0, 40) };
  if (!sender.id || !sender.name) return { status: 400, json: { error: "sender required" } };
  const image = body.image?.data && /^image\/(jpeg|png|webp|gif)$/.test(body.image.mediaType) ? body.image : null;
  const chat = loadState(body);
  for (const m of (body.members || []).slice(0, 12)) if (m?.id && m?.name) touchMember(chat, String(m.id), String(m.name).slice(0, 40));

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
    }</body>`,
  };
}
