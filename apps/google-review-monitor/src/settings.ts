import { config } from "./config";

/**
 * Settings that can be changed while the app is running, from the dashboard's Configure page.
 * They start from .env; a value saved from the dashboard (app_settings table) overrides it.
 * Credentials are not here on purpose: those stay in .env.
 */
export interface RuntimeSettings {
  /** Which service checks reviews. */
  reviewChecker: string;
  /** Asked only when the first service fails outright; "" = none. */
  reviewCheckerFallback: string;
  /**
   * How many of the newest Google reviews to look through per location, whichever service is
   * used (0 = as many as it allows). One value, edited from Run options and from Configure.
   */
  reviewsPerLocation: number;
  /** Run now skips the Asana sync when the month was synced within this many minutes (0 = always sync first). */
  syncFreshMinutes: number;
  /** Use DataForSEO's priority queue for full runs too. */
  dataforseoPriority: boolean;
  /** Whether the scheduler runs the automatic daily check. */
  dailyCheckEnabled: boolean;
}

export const SOURCES = ["dataforseo", "apify", "places", "business-profile", "scrape"] as const;
export const SOURCE_LABELS: Record<string, string> = {
  dataforseo: "DataForSEO",
  apify: "Apify",
  places: "Google Places API",
  "business-profile": "Google Business Profile API",
  scrape: "Scrape mode (reads each review link in a browser; testing)",
};

/** Used until someone changes it on the dashboard. Not read from .env. */
export const DEFAULT_REVIEWS_PER_LOCATION = 700;
const REVIEWS_PER_LOCATION_LIMIT = 20000;

const LABELS: Record<keyof RuntimeSettings, string> = {
  reviewChecker: "Review source",
  reviewCheckerFallback: "Fallback source",
  reviewsPerLocation: "Google reviews per location",
  syncFreshMinutes: "Minutes an Asana sync stays fresh",
  dataforseoPriority: "DataForSEO fast queue for full runs",
  dailyCheckEnabled: "Automatic daily check",
};

export function envDefaults(): RuntimeSettings {
  return {
    reviewChecker: config.reviewChecker,
    reviewCheckerFallback: config.reviewCheckerFallback ?? "",
    reviewsPerLocation: DEFAULT_REVIEWS_PER_LOCATION,
    syncFreshMinutes: 60,
    dataforseoPriority: config.dataforseoPriority,
    dailyCheckEnabled: true,
  };
}

/** The live values. Read this wherever a setting is used, so a change applies to the next check. */
export const settings: RuntimeSettings = envDefaults();

const isSource = (v: string) => (SOURCES as readonly string[]).includes(v);

function wholeNumber(v: unknown, label: string, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max) throw new Error(`${label} must be a whole number from 0 to ${max.toLocaleString("en-US")}`);
  return n;
}

function onOff(v: unknown, label: string): boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  throw new Error(`${label} must be on or off`);
}

/**
 * Checks a set of values (from the dashboard or the database) and returns the valid ones as
 * typed settings. Unknown keys are ignored; a bad value throws with a message fit to show.
 */
export function parseSettings(input: Record<string, unknown>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};
  if (input.reviewChecker !== undefined) {
    if (typeof input.reviewChecker !== "string" || !isSource(input.reviewChecker)) throw new Error("Review source is not one of the supported services");
    out.reviewChecker = input.reviewChecker;
  }
  if (input.reviewCheckerFallback !== undefined) {
    const v = input.reviewCheckerFallback;
    if (typeof v !== "string" || (v !== "" && !isSource(v))) throw new Error("Fallback source is not one of the supported services");
    out.reviewCheckerFallback = v;
  }
  if (input.reviewsPerLocation !== undefined) out.reviewsPerLocation = wholeNumber(input.reviewsPerLocation, LABELS.reviewsPerLocation, REVIEWS_PER_LOCATION_LIMIT);
  if (input.syncFreshMinutes !== undefined) out.syncFreshMinutes = wholeNumber(input.syncFreshMinutes, LABELS.syncFreshMinutes, 7 * 24 * 60);
  if (input.dataforseoPriority !== undefined) out.dataforseoPriority = onOff(input.dataforseoPriority, LABELS.dataforseoPriority);
  if (input.dailyCheckEnabled !== undefined) out.dailyCheckEnabled = onOff(input.dailyCheckEnabled, LABELS.dailyCheckEnabled);
  return out;
}

/** Resets to .env, then applies what was saved from the dashboard. A stored value that is no longer valid is skipped. */
export function applyStored(stored: Record<string, string>): void {
  Object.assign(settings, envDefaults());
  // A value saved before the two per-service numbers became one setting still counts.
  const old = stored[`${settings.reviewChecker === "apify" ? "apify" : "dataforseo"}MaxReviews`];
  const all = old !== undefined && stored.reviewsPerLocation === undefined ? { ...stored, reviewsPerLocation: old } : stored;
  for (const [key, value] of Object.entries(all)) {
    try {
      Object.assign(settings, parseSettings({ [key]: value }));
    } catch {
      // left at its .env value
    }
  }
}

function show(key: keyof RuntimeSettings, v: RuntimeSettings[keyof RuntimeSettings]): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (key === "reviewChecker" || key === "reviewCheckerFallback") return v === "" ? "none" : (SOURCE_LABELS[v as string] ?? String(v));
  if (key === "syncFreshMinutes") return v === 0 ? "0 (always sync first)" : String(v);
  if (v === 0) return "no limit";
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

/** One plain sentence per setting that actually changes, for the audit log. */
export function describeChanges(from: RuntimeSettings, patch: Partial<RuntimeSettings>): string[] {
  return (Object.keys(patch) as (keyof RuntimeSettings)[])
    .filter((k) => patch[k] !== undefined && patch[k] !== from[k])
    .map((k) => `${LABELS[k]} changed from ${show(k, from[k])} to ${show(k, patch[k] as RuntimeSettings[typeof k])}`);
}
