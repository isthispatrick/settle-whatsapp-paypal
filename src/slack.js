// Slack adapter. Runs as a Socket Mode app (no public URL needed): answers DMs, and in
// channels it has been invited to it answers when someone mentions @Settle.
import "dotenv/config";
import fs from "node:fs";
import bolt from "@slack/bolt";
import { handleMessage, checkPayment, isAddressed, noteMessage } from "./agent.js";
import { newChat, touchMember } from "./ledger.js";
import { paypalMode } from "./paypal.js";
import { plainText } from "./slack-text.js";

const STATE_FILE = "data/slack-state.json";
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
const IMAGE_STASH_MS = 10 * 60 * 1000;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

for (const k of ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}. See "Slack" in README.md for the two-minute setup.`);
    process.exit(1);
  }
}

fs.mkdirSync("data", { recursive: true });
const chats = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(chats));

const app = new bolt.App({ token: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN, socketMode: true, tokenVerificationEnabled: false }); // we verify the token ourselves below, with a readable error
const names = new Map(); // Slack user id -> display name
const stashedImages = new Map(); // channel -> last image posted without addressing the bot
const queues = new Map(); // channel -> promise chain, so one channel's messages are handled in order
const watching = new Set();
let botUserId;

async function profileOf(userId) {
  if (names.has(userId)) return names.get(userId);
  let profile = { name: userId, human: true };
  try {
    const { user } = await app.client.users.info({ user: userId });
    profile = { name: user.profile?.display_name || user.real_name || user.name || userId, human: !user.is_bot && !user.deleted && userId !== "USLACKBOT" };
  } catch (e) {
    console.error("users.info failed:", e.data?.error || e.message);
  }
  names.set(userId, profile);
  return profile;
}
const nameOf = async (userId) => (await profileOf(userId)).name;

/** The first time Settle is used in a channel, learn who is in it, so "split between all of us" works straight away. */
async function loadMembers(chat, channel) {
  if (chat.membersLoaded) return;
  chat.membersLoaded = true;
  try {
    const { members = [] } = await app.client.conversations.members({ channel, limit: 40 });
    for (const id of members) {
      const p = await profileOf(id);
      if (p.human) touchMember(chat, id, p.name);
    }
  } catch (e) {
    console.error("could not list channel members:", e.data?.error || e.message);
  }
}

async function downloadImage(file) {
  // Prefer Slack's 1024px rendition: plenty for a receipt and well under the model's size limit.
  const res = await fetch(file.thumb_1024 || file.url_private, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  const mediaType = (res.headers.get("content-type") || "").split(";")[0];
  if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType))
    throw new Error(`could not download image (${res.status} ${mediaType}); check the files:read scope`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("image is too large");
  return { data: buf.toString("base64"), mediaType };
}

const post = (channel, text, thread_ts) => app.client.chat.postMessage({ channel, text, thread_ts, unfurl_links: false, unfurl_media: false });

function watchPayment(channel, orderId) {
  if (watching.has(orderId)) return;
  watching.add(orderId);
  const timer = setInterval(async () => {
    try {
      const chat = chats[channel];
      const { done, message } = await checkPayment(chat, orderId);
      if (!done) return;
      clearInterval(timer);
      watching.delete(orderId);
      save();
      if (message) await post(channel, message, chat.payments[orderId]?.threadTs);
    } catch (e) {
      console.error("payment check failed:", e.message);
    }
  }, 4000);
}

async function onMessage(msg) {
  // Ignore edits, joins, bot posts (including our own) and anything without a human author.
  if ((msg.subtype && msg.subtype !== "file_share") || msg.bot_id || !msg.user) return;
  const channel = msg.channel;
  const isGroup = msg.channel_type !== "im";
  const imageFile = (msg.files || []).find((f) => f.mimetype?.startsWith("image/"));
  const text = await plainText(msg.text, nameOf, botUserId);
  if (!text && !imageFile) return;

  const sender = { id: msg.user, name: await nameOf(msg.user) };
  const chat = (chats[channel] ??= newChat(channel, isGroup));
  const threadTs = msg.thread_ts; // reply in the thread if the message was in one

  if (!isAddressed(chat, text)) {
    noteMessage(chat, sender, text || "(sent a photo)");
    if (imageFile) stashedImages.set(channel, { file: imageFile, at: Date.now() });
    save();
    return;
  }

  if (isGroup) await loadMembers(chat, channel);

  // A receipt posted just before "@Settle split this" counts as attached.
  const stash = stashedImages.get(channel);
  const file = imageFile || (stash && Date.now() - stash.at < IMAGE_STASH_MS ? stash.file : null);
  stashedImages.delete(channel);
  let image = null;
  if (file) {
    try {
      image = await downloadImage(file);
    } catch (e) {
      console.error("image download failed:", e.message);
      await post(channel, "I couldn't open that image. Could you send it again as a JPG or PNG?", threadTs);
      return;
    }
  }

  const { replies, newPayments } = await handleMessage({ chat, sender, text, image, publicUrl: PUBLIC_URL });
  for (const id of newPayments) chat.payments[id].threadTs = threadTs;
  save();
  for (const r of replies) await post(channel, r, threadTs);
  for (const id of newPayments) watchPayment(channel, id);
}

app.message(({ message }) => {
  const next = (queues.get(message.channel) || Promise.resolve()).then(() => onMessage(message)).catch((e) => console.error("message failed:", e));
  queues.set(message.channel, next);
});
app.error(async (e) => console.error("slack error:", e.message || e));

const auth = await app.client.auth.test().catch((e) => {
  console.error(`Slack rejected SLACK_BOT_TOKEN (${e.data?.error || e.message}). Check the xoxb- token in .env.`);
  process.exit(1);
});
botUserId = auth.user_id;
await app.start();
console.log(`✅ Settle is live in Slack workspace "${auth.team}" as @${auth.user} (PayPal: ${paypalMode})`);
for (const [channel, chat] of Object.entries(chats))
  for (const [id, p] of Object.entries(chat.payments || {})) if (p.status === "AWAITING_APPROVAL") watchPayment(channel, id);
