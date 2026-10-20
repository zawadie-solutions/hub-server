/**
 * Source classification and verification statuses.
 *
 * Every piece of evidence is weighted by where it was found (the source hierarchy). The scores
 * come from Settings so they can be tuned without touching code.
 */
import type { Thresholds } from "../config";
import { LIKELY, NOT_FOUND, UNCERTAIN, VERIFIED } from "../models";
import { hostOf, registeredDomain } from "../utils/normalization";

export const BLOCKED = "blocked";

// People-search sites and contact-data brokers: personal/private or pattern-guessed data.
// Nothing is ever extracted from these.
export const BLOCKED_DOMAINS = new Set([
  "whitepages.com", "spokeo.com", "truepeoplesearch.com", "beenverified.com",
  "fastpeoplesearch.com", "peoplefinders.com", "intelius.com", "radaris.com", "mylife.com",
  "instantcheckmate.com", "truthfinder.com", "usphonebook.com", "thatsthem.com",
  "clustrmaps.com", "nuwber.com", "peekyou.com", "rocketreach.co", "zoominfo.com",
  "contactout.com", "signalhire.com", "lusha.com", "apollo.io", "hunter.io", "anymailfinder.com",
]);
const REGISTRY_DOMAINS = new Set(["opencorporates.com", "cipc.co.za", "demo-gov.example"]);
const REGISTRY_SUFFIXES = [".gov", ".gov.uk", ".gov.za", ".gov.au", ".gc.ca"];
const BUSINESS_PROFILE_DOMAINS = new Set(["facebook.com", "g.page", "business.site", "nextdoor.com"]);
const PROFESSIONAL_PROFILE_DOMAINS = new Set(["demo-profiles.example"]);
const DIRECTORY_DOMAINS = new Set([
  "yelp.com", "bbb.org", "yellowpages.com", "angi.com", "angieslist.com", "homeadvisor.com",
  "houzz.com", "thumbtack.com", "manta.com", "dnb.com", "crunchbase.com",
  "chamberofcommerce.com", "mapquest.com", "superpages.com", "buildzoom.com", "porch.com",
  "bizapedia.com", "yellowpages.co.za", "brabys.com", "hotfrog.com", "cylex.us.com",
  "trustpilot.com", "demo-directory.example",
]);
const NEWS_DOMAINS = new Set([
  "nytimes.com", "wsj.com", "reuters.com", "apnews.com", "bloomberg.com", "forbes.com",
  "bizjournals.com", "businesswire.com", "prnewswire.com", "globenewswire.com", "news24.com",
  "cnn.com", "bbc.com", "bbc.co.uk", "patch.com", "inc.com", "demo-news.example",
]);
// Well-known sites that are never a small company's own website.
const NEVER_OFFICIAL_DOMAINS = new Set([
  "twitter.com", "x.com", "youtube.com", "tiktok.com", "pinterest.com", "reddit.com",
  "instagram.com", "wikipedia.org", "amazon.com", "ebay.com", "indeed.com", "glassdoor.com",
  "linkedin.com", "google.com", "bing.com", "apple.com", "medium.com", "quora.com",
]);

function pathOf(url: string): string {
  try {
    return decodeURI(new URL(url.includes("://") ? url : `http://${url}`).pathname).toLowerCase();
  } catch {
    return "";
  }
}

export function classifySource(url: string | null | undefined, officialDomain?: string | null): string {
  const domain = registeredDomain(url);
  const host = hostOf(url);
  if (!domain) return "unknown";
  if (BLOCKED_DOMAINS.has(domain)) return BLOCKED;
  if (officialDomain && domain === officialDomain) return "official_website";
  const path = pathOf(url ?? "");
  if (REGISTRY_DOMAINS.has(domain) || REGISTRY_SUFFIXES.some((s) => host.endsWith(s)) || host.startsWith("sos.")) return "government_registry";
  if (domain === "linkedin.com") {
    if (path.startsWith("/in/") || path.startsWith("/pub/")) return "professional_profile";
    return path.startsWith("/company/") ? "official_business_profile" : "unknown";
  }
  if (domain === "google.com") {
    return path.startsWith("/maps") || host.startsWith("maps.") || host.startsWith("business.") ? "official_business_profile" : "unknown";
  }
  if (BUSINESS_PROFILE_DOMAINS.has(domain)) return "official_business_profile";
  if (PROFESSIONAL_PROFILE_DOMAINS.has(domain)) return "professional_profile";
  if (DIRECTORY_DOMAINS.has(domain)) return "reputable_directory";
  if (NEWS_DOMAINS.has(domain) || host.startsWith("news.") || path.includes("/news/") || path.includes("/press")) return "news";
  if (NEVER_OFFICIAL_DOMAINS.has(domain)) return "unknown";
  return "search_snippet";
}

/** Only uncategorised, ordinary websites can be a company's own site. */
export const couldBeOfficial = (url: string | null | undefined) => classifySource(url) === "search_snippet";

export function sourceScore(sourceType: string, scores: Record<string, number>): number {
  if (sourceType === BLOCKED) return 0;
  return Math.trunc(scores[sourceType] ?? scores.unknown ?? 30);
}

export function statusFor(confidence: number | null | undefined, thresholds: Thresholds): string {
  if (confidence === null || confidence === undefined) return NOT_FOUND;
  if (confidence >= thresholds.verified) return VERIFIED;
  if (confidence >= thresholds.likely) return LIKELY;
  if (confidence >= thresholds.uncertain) return UNCERTAIN;
  return NOT_FOUND;
}
