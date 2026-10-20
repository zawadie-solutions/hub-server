/** The live web-search APIs: Google Programmable Search, Bing, SerpAPI and Brave. */
import { envValue } from "../config";
import { hostOf } from "../utils/normalization";
import { HttpSearchProvider, ProviderError, QuotaExceededError, type SearchResult, searchResult } from "./base";

const keep = (items: any[] | undefined, map: (item: any) => SearchResult) => (items ?? []).map(map).filter((r) => r.url);

/** Google Programmable Search (Custom Search JSON API) — an official, permitted API. */
export class GoogleProvider extends HttpSearchProvider {
  readonly name = "google";
  readonly label = "Google Programmable Search";
  readonly requiredEnv = ["GOOGLE_API_KEY", "GOOGLE_SEARCH_ENGINE_ID"];

  async search(query: string, numResults = 10) {
    const data = await this.getJson("https://www.googleapis.com/customsearch/v1", {
      key: envValue("GOOGLE_API_KEY"),
      cx: envValue("GOOGLE_SEARCH_ENGINE_ID"),
      q: query,
      num: Math.max(1, Math.min(numResults, 10)), // the API allows at most 10 per request
    });
    return keep(data.items, (item) => searchResult({ title: item.title ?? "", url: item.link ?? "", snippet: item.snippet ?? "", displayUrl: item.displayLink ?? "", source: this.name }));
  }
}

/**
 * Bing Web Search API v7. Microsoft retired the public Bing Search APIs in August 2025; this is
 * kept for anyone with a still-working key or compatible endpoint (set BING_ENDPOINT), otherwise
 * it fails cleanly and the fallback chain moves on.
 */
export class BingProvider extends HttpSearchProvider {
  readonly name = "bing";
  readonly label = "Bing Search API";
  readonly requiredEnv = ["BING_API_KEY"];

  async search(query: string, numResults = 10) {
    const endpoint = envValue("BING_ENDPOINT").trim() || "https://api.bing.microsoft.com/v7.0/search";
    const data = await this.getJson(endpoint, { q: query, count: Math.max(1, Math.min(numResults, 50)) }, { "Ocp-Apim-Subscription-Key": envValue("BING_API_KEY") });
    return keep(data.webPages?.value, (item) => searchResult({ title: item.name ?? "", url: item.url ?? "", snippet: item.snippet ?? "", displayUrl: item.displayUrl ?? "", source: this.name }));
  }
}

/** SerpAPI (serpapi.com) — a paid search-results API. */
export class SerpApiProvider extends HttpSearchProvider {
  readonly name = "serpapi";
  readonly label = "SerpAPI";
  readonly requiredEnv = ["SERPAPI_KEY"];
  // SerpAPI runs a live Google fetch per request rather than serving a cached index, so it is
  // noticeably slower than a typical JSON API; 20s times out often. A client-side timeout does
  // not stop the search server-side, so a short timeout just wastes a billed search.
  protected timeoutSeconds = 45;

  async search(query: string, numResults = 10) {
    const data = await this.getJson("https://serpapi.com/search.json", { engine: "google", q: query, num: Math.max(1, Math.min(numResults, 20)), api_key: envValue("SERPAPI_KEY") });
    const error: string | undefined = data.error;
    if (error && !data.organic_results?.length) {
      if (error.includes("hasn't returned any results")) return [];
      if (error.includes("run out of searches") || error.toLowerCase().includes("limit")) throw new QuotaExceededError(`${this.label}: ${error}`);
      throw new ProviderError(`${this.label}: ${error}`);
    }
    return keep(data.organic_results, (item) => searchResult({ title: item.title ?? "", url: item.link ?? "", snippet: item.snippet ?? "", displayUrl: item.displayed_link ?? "", source: this.name }));
  }
}

const stripTags = (value: string | undefined) => (value ?? "").replace(/<[^>]+>/g, "");

/** Brave Search API (api.search.brave.com) — an official web search API. */
export class BraveProvider extends HttpSearchProvider {
  readonly name = "brave";
  readonly label = "Brave Search API";
  readonly requiredEnv = ["BRAVE_API_KEY"];

  async search(query: string, numResults = 10) {
    const data = await this.getJson(
      "https://api.search.brave.com/res/v1/web/search",
      { q: query, count: Math.max(1, Math.min(numResults, 20)) },
      { "X-Subscription-Token": envValue("BRAVE_API_KEY"), Accept: "application/json" },
    );
    return keep(data.web?.results, (item) => searchResult({ title: stripTags(item.title), url: item.url ?? "", snippet: stripTags(item.description), displayUrl: hostOf(item.url ?? ""), source: this.name }));
  }
}
