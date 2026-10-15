import { AsanaClient } from "../asana/client";
import { config } from "../config";
import type { ReviewRepo } from "../db/repo";
import { apifyAccount, dataForSeoAccount } from "../google/accounts";
import { ApifyChecker } from "../google/apifyChecker";
import { DataForSeoChecker } from "../google/dataForSeoChecker";
import { PlacesChecker } from "../google/placesChecker";
import { logger } from "../logger";
import { applyStored, describeChanges, parseSettings, settings, SOURCE_LABELS, SOURCES } from "../settings";
import { buildChecker, buildNotifier, sourceConfigured } from "../wiring";
import { type ConfigStore, createApp, type MonthRunnerOpts } from "./app";
import { nextScheduledRun } from "./schedule";

/** Asana is needed for the month picker / "Run now" button; Google/Slack creds are optional
 *  and only checked when a run actually happens (see MonthRunnerOpts in app.ts). */
function buildMonthRunner(): MonthRunnerOpts | undefined {
  try {
    const a = config.asana();
    return {
      client: new AsanaClient(a.token),
      asanaSettings: a,
      buildChecker,
      buildNotifier,
      checkDelayMs: config.checkDelayMs,
      removalRecheckDelayMs: config.removalRecheckDelayMs,
      syncFreshMinutes: () => settings.syncFreshMinutes,
    };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "Asana not configured; dashboard will run without the month picker / Run now button");
    return undefined;
  }
}

/** "Load Google reviews" uses the current review source; built per use so a source change applies at once. */
async function loadPlaceReviews(location: string, reviewUrls: string[]) {
  const source =
    settings.reviewChecker === "dataforseo"
      ? new DataForSeoChecker({ ...config.dataforseo(), maxReviews: settings.reviewsPerLocation, priority: true })
      : settings.reviewChecker === "apify"
        ? new ApifyChecker({ ...config.apify(), maxReviews: settings.reviewsPerLocation })
        : new PlacesChecker(config.places());
  return source.placeReviews(location, reviewUrls);
}

const has = (fn: () => unknown) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

/** Backs the Configure page: what is set now, what can be chosen, and saving changes. */
function buildConfigStore(repo: ReviewRepo): ConfigStore {
  const view = async () => ({
    settings: { ...settings },
    /** True when something was saved from the dashboard, so .env is being overridden. */
    overridden: Object.keys(await repo.getSettings()).length > 0,
    sources: SOURCES.map((id) => ({ id, label: SOURCE_LABELS[id], configured: sourceConfigured(id) })),
    schedule: {
      cron: config.scheduleCron,
      timezone: config.timezone,
      nextCheckAt: settings.dailyCheckEnabled ? (nextScheduledRun(config.scheduleCron, config.timezone)?.toISOString() ?? null) : null,
    },
    connections: [
      { label: "Asana", ok: has(config.asana), detail: has(config.asana) ? "Connected" : "ASANA_TOKEN / ASANA_PROJECT_GID not set in .env" },
      config.slackEnabled
        ? { label: "Removal alerts", ok: has(config.slack), detail: has(config.slack) ? "Slack direct message" : "SLACK_RECIPIENT_USER_ID not set in .env" }
        : { label: "Removal alerts", ok: has(config.email), detail: has(config.email) ? "Email" : "Neither Slack nor email is set up in .env" },
    ],
  });

  return {
    view,
    dailyCheckEnabled: () => settings.dailyCheckEnabled,
    accounts: () => Promise.all([dataForSeoAccount(), apifyAccount()]),
    async update(input, actor) {
      const patch = parseSettings(input);
      const next = { ...settings, ...patch };
      if (!sourceConfigured(next.reviewChecker)) throw new Error(`${SOURCE_LABELS[next.reviewChecker]} is not set up in .env, so it cannot be the review source`);
      if (next.reviewCheckerFallback) {
        if (next.reviewCheckerFallback === next.reviewChecker) throw new Error("The fallback must be a different service from the review source");
        if (!sourceConfigured(next.reviewCheckerFallback)) throw new Error(`${SOURCE_LABELS[next.reviewCheckerFallback]} is not set up in .env, so it cannot be the fallback`);
      }
      const changes = describeChanges(settings, patch);
      if (changes.length) {
        const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== settings[k as keyof typeof settings]));
        await repo.saveSettings(Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, String(v)])), actor);
        Object.assign(settings, changed);
        for (const summary of changes) await repo.addAudit({ actor, action: "settings.changed", summary });
      }
      return { changes };
    },
    async reset(actor) {
      await repo.clearSettings();
      applyStored({});
      await repo.addAudit({ actor, action: "settings.reset", summary: "Settings reset to the values in .env" });
    },
  };
}

/** The dashboard app, ready to listen on its own or be mounted inside the hub. */
export async function buildDashboard(repo: ReviewRepo, hub?: Parameters<typeof createApp>[0]["hub"]) {
  applyStored(await repo.getSettings());
  const cleared = await repo.clearInterruptedRuns();
  if (cleared) {
    logger.warn({ cleared }, "cleared runs left marked as running by a previous shutdown");
    await repo.addAudit({ actor: "system", action: "system.interrupted", summary: `App started and released ${cleared} check${cleared === 1 ? "" : "s"} that a restart had interrupted` });
  }
  return createApp({
    repo,
    user: config.dashboardUser,
    password: config.dashboardPassword,
    scheduleCron: config.scheduleCron,
    timezone: config.timezone,
    monthRunner: buildMonthRunner(),
    loadPlaceReviews,
    config: buildConfigStore(repo),
    hub,
  });
}

export async function startDashboard(repo: ReviewRepo) {
  const app = await buildDashboard(repo);
  app.listen(config.port, () => logger.info({ port: config.port }, "dashboard listening"));
}
