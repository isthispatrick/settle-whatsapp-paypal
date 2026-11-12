// Local server for the web demo: serves public/ and the same /api routes Vercel runs.
import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatApi, paymentApi, mockApproveApi, publicUrlOf } from "./http.js";
import { paypalMode } from "./paypal.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    if ((size += c.length) > 8e6) throw new Error("body too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/chat" || url.pathname === "/api/payment") {
      if (req.method !== "POST") return res.writeHead(405).end();
      const body = await readJson(req);
      const { status, json } = url.pathname === "/api/chat" ? await chatApi(body, publicUrlOf(req)) : await paymentApi(body);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
      return;
    }
    if (url.pathname === "/api/mock-approve") {
      const { status, html } = mockApproveApi(url.searchParams.get("id"));
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      return;
    }
    const file = path.join(PUBLIC, path.normalize(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Server error" }));
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Settle web demo on http://localhost:${port}  (PayPal: ${paypalMode})`));
