import { chatApi, publicUrlOf } from "../src/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { status, json } = await chatApi(req.body || {}, publicUrlOf(req));
  res.status(status).json(json);
}
