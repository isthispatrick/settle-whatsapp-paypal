// iMessage adapter (macOS only). Reads new messages from the Messages database and replies through
// the Messages app with AppleScript, using the Apple ID signed in on this Mac.
// Needs: Full Disk Access for the app running this (to read ~/Library/Messages/chat.db), and
// permission to control Messages (macOS asks on the first reply).
// Names: phone numbers/emails are shown as names via IMESSAGE_NAMES="+447700900001=Tom,+447700900002=Shrey".
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { handleMessage, checkPayment, isAddressed, noteMessage } from "./agent.js";
import { newChat } from "./ledger.js";
import { paypalMode } from "./paypal.js";

const STATE_FILE = "data/imessage-state.json";
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
const ME = process.env.IMESSAGE_ME_NAME || "Me";
const NAMES = Object.fromEntries(
  (process.env.IMESSAGE_NAMES || "").split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2 && p[0]),
);

fs.mkdirSync("data", { recursive: true });
const chats = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(chats));

const DB_PATH = `${os.homedir()}/Library/Messages/chat.db`;
const SQL = `
  SELECT m.ROWID AS rowid, m.text, m.attributedBody AS body, m.is_from_me AS fromMe, h.id AS handle,
         c.guid AS chatGuid, c.style AS style
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  WHERE m.ROWID > ? ORDER BY m.ROWID`;
// Open a fresh connection for every poll so we never sit on a stale snapshot of the live database.
function readRows(sql, ...args) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}
let lastRow = readRows("SELECT MAX(ROWID) AS r FROM message")[0].r ?? 0;

// Newer macOS stores most message text only in attributedBody (an NSArchiver typedstream).
function bodyText(buf) {
  if (!buf) return "";
  const b = Buffer.from(buf);
  const i = b.indexOf("NSString");
  if (i < 0) return "";
  let p = i + "NSString".length + 5;
  let len = b[p];
  if (len === 0x81) { len = b.readUInt16LE(p + 1); p += 3; } else if (len === 0x82) { len = b.readUInt32LE(p + 1); p += 5; } else p += 1;
  return b.subarray(p, p + len).toString("utf8");
}

const sentTexts = []; // our own replies show up in the database as is_from_me; skip them
function send(chatGuid, text) {
  sentTexts.push(text.trim());
  if (sentTexts.length > 50) sentTexts.shift();
  return new Promise((resolve) =>
    execFile("osascript", ["-e", "on run argv", "-e", 'tell application "Messages" to send (item 1 of argv) to chat id (item 2 of argv)', "-e", "end run", text, chatGuid],
      (err) => { if (err) console.error("send failed:", err.message); resolve(); }));
}

const watching = new Set();
function watchPayment(guid, orderId) {
  if (watching.has(orderId)) return;
  watching.add(orderId);
  const timer = setInterval(async () => {
    try {
      const { done, message } = await checkPayment(chats[guid], orderId);
      if (!done) return;
      clearInterval(timer);
      watching.delete(orderId);
      save();
      if (message) await send(guid, message);
    } catch (e) {
      console.error("payment check failed:", e.message);
    }
  }, 4000);
}

async function onMessage(row) {
  const text = (row.text || bodyText(row.body) || "").replace(/￼/g, "").trim();
  if (!text) return;
  if (row.fromMe) {
    const k = sentTexts.indexOf(text);
    if (k >= 0) { sentTexts.splice(k, 1); return; }
  }
  const guid = row.chatGuid;
  const isGroup = row.style === 43;
  const senderId = row.fromMe ? "me" : row.handle || "unknown";
  const sender = { id: senderId, name: row.fromMe ? ME : NAMES[senderId] || senderId };
  // The owner's own messages need an explicit "@settle"; others follow the usual rule.
  // This is a personal Apple ID, so ordinary DMs from real contacts must be left alone: every message,
  // DM or group, has to mention "settle" (unless IMESSAGE_DEDICATED=1).
  // Texting your own number shows each message twice (sent + received); handle only the received copy
  // unless the owner explicitly writes "@settle".
  const addressed = row.fromMe ? /@settle\b/i.test(text) : /\bsettle\b/i.test(text) || (process.env.IMESSAGE_DEDICATED === "1" && !isGroup);
  console.log(`seen #${row.rowid} ${row.fromMe ? "from me" : "incoming"} ${isGroup ? "group" : "dm"} -> ${addressed ? "handling" : "ignored"}`);
  if (!addressed) {
    if (chats[guid]) { noteMessage(chats[guid], sender, text); save(); }
    return;
  }
  const chat = (chats[guid] ??= newChat(guid, isGroup));
  console.log(`[${isGroup ? "group" : "dm"}] ${sender.name}: ${text}`);
  const { replies, newPayments } = await handleMessage({ chat, sender, text, image: null, publicUrl: PUBLIC_URL });
  save();
  for (const r of replies) await send(guid, r);
  for (const id of newPayments) watchPayment(guid, id);
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const rows = readRows(SQL, lastRow);
    if (process.env.IMESSAGE_DEBUG) console.log(`poll: ${rows.length} new (after #${lastRow})`);
    for (const row of rows) {
      lastRow = row.rowid;
      await onMessage(row).catch((e) => console.error("message failed:", e));
    }
  } finally {
    busy = false;
  }
}, 1500);

for (const [guid, chat] of Object.entries(chats))
  for (const [id, p] of Object.entries(chat.payments || {})) if (p.status === "AWAITING_APPROVAL") watchPayment(guid, id);
console.log(`✅ Settle is live on iMessage (PayPal: ${paypalMode}). Watching from message #${lastRow}.`);
