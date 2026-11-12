// WhatsApp adapter. Links to a WhatsApp account as a companion device (scan the QR once),
// then answers DMs and any group it is added to when someone mentions "settle".
import "dotenv/config";
import fs from "node:fs";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, Browsers } from "baileys";
import { handleMessage, checkPayment, isAddressed, noteMessage } from "./agent.js";
import { newChat } from "./ledger.js";
import { paypalMode } from "./paypal.js";

const STATE_FILE = "data/state.json";
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
const IMAGE_STASH_MS = 10 * 60 * 1000;
const DEDICATED = process.env.DEDICATED_NUMBER === "1";

fs.mkdirSync("data", { recursive: true });
const chats = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(chats));

const sentIds = new Set(); // ids of messages the bot sent, so it never answers itself
const stashedImages = new Map(); // chatId -> last receipt photo posted without addressing the bot
const queues = new Map(); // chatId -> promise chain, so one chat's messages are handled in order
const watching = new Set();
const userPart = (jid) => (jid || "").split("@")[0].split(":")[0];

let sock;

async function send(jid, text, quoted) {
  const sent = await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
  if (sent?.key?.id) sentIds.add(sent.key.id);
}

function watchPayment(jid, orderId) {
  if (watching.has(orderId)) return;
  watching.add(orderId);
  const timer = setInterval(async () => {
    try {
      const { done, message } = await checkPayment(chats[jid], orderId);
      if (!done) return;
      clearInterval(timer);
      watching.delete(orderId);
      save();
      if (message) await send(jid, message);
    } catch (e) {
      console.error("payment check failed:", e.message);
    }
  }, 4000);
}

async function onMessage(m) {
  const jid = m.key.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter") || sentIds.has(m.key.id)) return;
  const msg = m.message?.ephemeralMessage?.message || m.message;
  if (!msg) return;
  const isGroup = jid.endsWith("@g.us");
  const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || "";
  const hasImage = !!msg.imageMessage;
  if (!text && !hasImage) return;

  const me = [userPart(sock.user?.id), userPart(sock.user?.lid)].filter(Boolean);
  const senderJid = m.key.fromMe ? sock.user.id : isGroup ? m.key.participant : jid;
  const sender = { id: userPart(senderJid), name: m.pushName || (m.key.fromMe ? sock.user?.name : null) || userPart(senderJid) };
  const info = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo;
  const mentioned = (info?.mentionedJid || []).some((j) => me.includes(userPart(j))) || me.includes(userPart(info?.participant));

  // Show "@4477..." mentions as names the agent knows.
  const known = chats[jid]?.members || {};
  let readable = text;
  for (const j of info?.mentionedJid || []) {
    const u = userPart(j);
    readable = readable.replaceAll(`@${u}`, me.includes(u) ? "@Settle" : `@${known[u]?.name ?? u}`);
  }

  // On a dedicated bot number every incoming DM is for the bot. On a personal number
  // (the default) it only reacts when addressed, so private chats are left alone.
  // The owner's own messages in private chats need an explicit "@settle" ("Settle down mate" is not for the bot).
  const addressed = m.key.fromMe && !isGroup
    ? mentioned || /@settle\b/i.test(readable)
    : (DEDICATED && !isGroup) || isAddressed({ isGroup: true }, readable, mentioned);

  let image = null;
  if (hasImage && (addressed || chats[jid])) {
    const buf = await downloadMediaMessage(m, "buffer", {});
    image = { data: buf.toString("base64"), mediaType: (msg.imageMessage.mimetype || "image/jpeg").split(";")[0], at: Date.now() };
  }

  if (!addressed) {
    // Only keep context for chats where Settle has already been used.
    if (chats[jid]) {
      noteMessage(chats[jid], sender, readable || "(sent a photo)");
      if (image) stashedImages.set(jid, image);
      save();
    }
    return;
  }
  const chat = (chats[jid] ??= newChat(jid, isGroup));
  if (!image) {
    const stash = stashedImages.get(jid);
    if (stash && Date.now() - stash.at < IMAGE_STASH_MS) image = stash;
  }
  stashedImages.delete(jid);

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});
  const { replies, newPayments } = await handleMessage({ chat, sender, text: readable, image, publicUrl: PUBLIC_URL });
  save();
  for (const [i, r] of replies.entries()) await send(jid, r, i === 0 ? m : undefined);
  for (const id of newPayments) watchPayment(jid, id);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("data/wa-auth");
  sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), browser: Browsers.macOS("Desktop"), markOnlineOnConnect: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\nScan with WhatsApp → Settings → Linked devices → Link a device:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log(`✅ Settle is live on WhatsApp as ${sock.user?.name || userPart(sock.user?.id)} (PayPal: ${paypalMode})`);
      for (const [jid, chat] of Object.entries(chats))
        for (const [id, p] of Object.entries(chat.payments || {})) if (p.status === "AWAITING_APPROVAL") watchPayment(jid, id);
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("Logged out. Delete data/wa-auth and run again to re-link.");
        process.exit(1);
      }
      console.log(`Connection closed (${code ?? "unknown"}), reconnecting…`);
      setTimeout(start, 2000);
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      const jid = m.key.remoteJid;
      const next = (queues.get(jid) || Promise.resolve()).then(() => onMessage(m)).catch((e) => console.error("message failed:", e));
      queues.set(jid, next);
    }
  });
}

start();
