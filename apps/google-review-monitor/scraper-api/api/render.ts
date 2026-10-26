// POST /api/render  { "url": "<Google review link>" }  with  Authorization: Bearer <SCRAPER_API_SECRET>
//   200 { finalUrl, text }  — the rendered page's visible text; the monitor decides what it means
//   400 bad link · 401 wrong/missing secret · 405 not POST · 502 the page could not be rendered
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderReviewPage } from "../lib/render.js";
import { allowedReviewUrl, authorized } from "../lib/validate.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!authorized(req.headers.authorization, process.env.SCRAPER_API_SECRET)) return res.status(401).json({ error: "Not authorized" });

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const url = allowedReviewUrl(body?.url);
  if (!url) return res.status(400).json({ error: "url must be a Google review link (maps.app.goo.gl or google.<tld>/maps)" });

  try {
    return res.status(200).json(await renderReviewPage(url.toString()));
  } catch (e) {
    console.error("render failed", url.hostname, (e as Error).message);
    return res.status(502).json({ error: `Could not render the page: ${(e as Error).message}` });
  }
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
