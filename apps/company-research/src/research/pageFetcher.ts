/**
 * Reads a few pages of a company's own public website (home / about / contact / team).
 *
 * Search-API snippets are short, so the owner and contact details are often only on the site
 * itself. This fetcher is deliberately polite: it obeys robots.txt, identifies itself, fetches a
 * handful of pages per company, never logs in and never retries around a block.
 */
import { Parser } from "htmlparser2";
import type { SearchResult } from "../providers/base";
import { getLogger } from "../utils/logger";
import { BLOCK_SEP } from "./extraction";

const log = getLogger("fetch");

export const USER_AGENT = "CompanyResearchTool/1.0 (business research; respects robots.txt)";
const PATHS = ["/", "/about", "/about-us", "/contact", "/contact-us", "/team", "/our-team"];
const MAX_PAGES = 4;
const MAX_BYTES = 600_000;
const MAX_TEXT = 6000;
const PROVIDER_NAME = "page-fetch";
const TIMEOUT_MS = 15_000;

const BLOCK_TAGS = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr", "section", "article", "footer", "header", "a", "address"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template"]);

/** [page title, visible text with block separators]. */
export function htmlToText(html: string): [string, string] {
  const parts: string[] = [];
  let title = "";
  let skip = 0;
  let inTitle = false;
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (SKIP_TAGS.has(tag)) skip++;
        else if (tag === "title") inTitle = true;
        else if (tag === "a") {
          const href = attrs.href ?? "";
          if (/^(mailto|tel):/i.test(href)) parts.push(href.slice(href.indexOf(":") + 1).split("?")[0]);
        }
        if (BLOCK_TAGS.has(tag)) parts.push(BLOCK_SEP);
      },
      onclosetag(tag) {
        if (SKIP_TAGS.has(tag) && skip) skip--;
        else if (tag === "title") inTitle = false;
        if (BLOCK_TAGS.has(tag)) parts.push(BLOCK_SEP);
      },
      ontext(data) {
        if (inTitle) title += data;
        else if (!skip) parts.push(data);
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  try {
    parser.write(html);
    parser.end();
  } catch {
    // malformed markup: keep whatever was parsed
  }
  let text = parts.join(" ").replace(/\s+/g, " ");
  text = text.replace(/(?:\s*¦\s*)+/g, BLOCK_SEP).replace(/^[ ¦]+|[ ¦]+$/g, "");
  return [title.replace(/\s+/g, " ").trim(), text];
}

/** robots.txt rules for one site: first matching rule wins, like Python's RobotFileParser. */
export class Robots {
  private groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  private disallowAll = false;

  static denyAll(): Robots {
    const r = new Robots("");
    r.disallowAll = true;
    return r;
  }

  constructor(text: string) {
    let current: { agents: string[]; rules: [boolean, string][] } | null = null;
    let lastWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (key === "user-agent") {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          this.groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
      } else if ((key === "allow" || key === "disallow") && current) {
        // an empty Disallow allows everything; it is simply not a rule
        if (value || key === "allow") current.rules.push([key === "allow", decodeURIComponentSafe(value)]);
        lastWasAgent = false;
      } else {
        lastWasAgent = false;
      }
    }
  }

  canFetch(userAgent: string, url: string): boolean {
    if (this.disallowAll) return false;
    const token = userAgent.split("/")[0].toLowerCase();
    const group = this.groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ?? this.groups.find((g) => g.agents.includes("*"));
    if (!group) return true;
    let path: string;
    try {
      const u = new URL(url);
      path = decodeURIComponentSafe(u.pathname + u.search) || "/";
    } catch {
      return true;
    }
    for (const [allow, prefix] of group.rules) if (prefix && path.startsWith(prefix)) return allow;
    return true;
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class PageFetcher {
  constructor(
    private wait: () => Promise<unknown> = async () => undefined,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private get(url: string) {
    return this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async fetchSite(website: string): Promise<SearchResult[]> {
    const robots = await this.robots(website);
    const pages: SearchResult[] = [];
    const seenText = new Set<string>();
    for (const path of PATHS) {
      if (pages.length >= MAX_PAGES) break;
      const url = new URL(path, website).toString();
      if (robots && !robots.canFetch(USER_AGENT, url)) {
        log.info({ url }, "robots.txt disallows");
        continue;
      }
      await this.wait();
      let response: Response;
      let body: string;
      try {
        response = await this.get(url);
        if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("html")) {
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        body = await response.text();
      } catch (e) {
        log.info({ url, err: (e as Error).name }, "fetch failed");
        continue;
      }
      const [title, text] = htmlToText(body.slice(0, MAX_BYTES));
      if (!text || seenText.has(text.slice(0, 300))) continue;
      seenText.add(text.slice(0, 300));
      pages.push({ title: title || url, url: response.url || url, snippet: text.slice(0, MAX_TEXT), source: PROVIDER_NAME, displayUrl: url });
    }
    return pages;
  }

  /** Parsed robots.txt, or null when the site has none (everything allowed). */
  private async robots(website: string): Promise<Robots | null> {
    let response: Response;
    try {
      response = await this.get(new URL("/robots.txt", website).toString());
    } catch {
      return null;
    }
    if (response.status === 401 || response.status === 403) return Robots.denyAll();
    if (response.status !== 200) return null;
    try {
      return new Robots(await response.text());
    } catch {
      return null;
    }
  }
}
