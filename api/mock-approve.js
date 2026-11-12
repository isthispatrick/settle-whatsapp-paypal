import { mockApproveApi } from "../src/http.js";

export default function handler(req, res) {
  const { status, html } = mockApproveApi(req.query?.id);
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
}
