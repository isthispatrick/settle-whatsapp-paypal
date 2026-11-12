import { paymentApi } from "../src/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { status, json } = await paymentApi(req.body || {});
  res.status(status).json(json);
}
