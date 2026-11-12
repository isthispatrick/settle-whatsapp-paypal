// Diagnostic: show the newest rows in the Messages database (no message text). Run from a Terminal with Full Disk Access.
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(`${os.homedir()}/Library/Messages/chat.db`, { readOnly: true });
const rows = db.prepare(`SELECT m.ROWID AS rowid, m.is_from_me AS fromMe, m.service, datetime(m.date/1000000000 + 978307200, 'unixepoch') AS utc,
  c.style, length(coalesce(m.text,'')) AS textLen, length(m.attributedBody) AS bodyLen
  FROM message m LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = cmj.chat_id
  ORDER BY m.ROWID DESC LIMIT 6`).all();
console.table(rows);
