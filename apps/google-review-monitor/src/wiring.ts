import { AsanaClient } from "./asana/client";
import { syncAsana } from "./asana/sync";
import { config } from "./config";
import { createDb } from "./db/db";
import { ReviewRepo } from "./db/repo";
import { ApifyChecker } from "./google/apifyChecker";
import { BusinessProfileChecker, loadLocationMap, OAuthRefreshTokenProvider } from "./google/businessProfileChecker";
import { DataForSeoChecker } from "./google/dataForSeoChecker";
import { FallbackChecker } from "./google/fallbackChecker";
import { PlacesChecker } from "./google/placesChecker";
import type { CycleDeps } from "./monitor/cycle";
import { EmailNotifier } from "./notify/email";
import { SlackDmNotifier } from "./notify/slack";
import { settings } from "./settings";
import type { Notifier, ReviewChecker } from "./types";

export interface CheckerOptions {
  /** Someone is waiting on the answer (a single-location check), so prefer speed over price. */
  fast?: boolean;
  /** For this run only: how many of the newest Google reviews to look through per location, instead of the Configure value. */
  maxReviews?: number;
}

function checkerNamed(name: string, setting: string, opts: CheckerOptions): ReviewChecker {
  if (name === "places") return new PlacesChecker(config.places());
  if (name === "apify") return new ApifyChecker({ ...config.apify(), maxReviews: opts.maxReviews ?? settings.reviewsPerLocation });
  if (name === "dataforseo") {
    return new DataForSeoChecker({ ...config.dataforseo(), maxReviews: opts.maxReviews ?? settings.reviewsPerLocation, priority: settings.dataforseoPriority || !!opts.fast });
  }
  if (name !== "business-profile") throw new Error(`Invalid ${setting}: ${name}`);
  const g = config.google();
  return new BusinessProfileChecker({
    auth: new OAuthRefreshTokenProvider(g),
    locationMap: loadLocationMap(g.locationsFile),
  });
}

/** Whether a source's credentials are in place, i.e. it could be selected. */
export function sourceConfigured(name: string): boolean {
  try {
    checkerNamed(name, "source", {});
    return true;
  } catch {
    return false;
  }
}

/**
 * The current review source (see settings.ts), backed by the fallback source when one is set.
 * Built fresh for each run, so a change made on the Configure page applies to the next check.
 */
export function buildChecker(opts: CheckerOptions = {}): ReviewChecker {
  const primary = checkerNamed(settings.reviewChecker, "REVIEW_CHECKER", opts);
  const fallback = settings.reviewCheckerFallback;
  if (!fallback || fallback === settings.reviewChecker) return primary;
  return new FallbackChecker(primary, checkerNamed(fallback, "REVIEW_CHECKER_FALLBACK", opts), { primary: settings.reviewChecker, fallback });
}

export function buildNotifier(): Notifier {
  return config.slackEnabled ? new SlackDmNotifier(config.slack()) : new EmailNotifier(config.email());
}

export function buildDeps(): { db: ReturnType<typeof createDb>; repo: ReviewRepo; deps: CycleDeps } {
  const db = createDb();
  const repo = new ReviewRepo(db);
  const a = config.asana();
  const client = new AsanaClient(a.token);
  const deps: CycleDeps = {
    repo,
    checker: buildChecker(),
    notifier: buildNotifier(),
    sync: () => syncAsana(client, repo, a),
    removalRecheckDelayMs: config.removalRecheckDelayMs,
    checkDelayMs: config.checkDelayMs,
    keepCheckingRemoved: config.keepCheckingRemoved,
  };
  return { db, repo, deps };
}
