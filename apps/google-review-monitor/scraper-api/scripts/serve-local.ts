// Serves api/render.ts on a local port, to try the whole monitor -> API path without deploying:
//   LOCAL_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" SCRAPER_API_SECRET=dev-secret npx tsx scripts/serve-local.ts [port=3999]
// then in the hub's .env (temporarily): SCRAPE_API_URL=http://localhost:3999/api/render  SCRAPE_API_SECRET=dev-secret
import { createServer } from "node:http";
import handler from "../api/render.js";

const port = Number(process.argv[2]) || 3999;

createServer(async (req, res) => {
  if (req.url !== "/api/render") {
    res.statusCode = 404;
    return res.end("Not found");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  // the same small surface Vercel gives a function: parsed JSON body, res.status().json()
  const vReq = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined });
  const vRes = Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return vRes;
    },
    json(data: unknown) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return vRes;
    },
  });
  await handler(vReq as never, vRes as never);
}).listen(port, () => console.log(`scraper API on http://localhost:${port}/api/render`));
