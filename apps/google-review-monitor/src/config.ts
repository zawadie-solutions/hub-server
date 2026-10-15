import "dotenv/config";

const env = process.env;

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : def;
}

/** Returns the value or throws a clear error naming the missing variable. */
export function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  databaseUrl: () => required("DATABASE_URL"),
  logLevel: env.LOG_LEVEL ?? "info",
  port: int(env.PORT, 3000),
  dashboardUser: env.DASHBOARD_USER ?? "admin",
  dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
  /** Daily at 07:00 Central Africa Time (UTC+2, no DST). */
  scheduleCron: env.SCHEDULE_CRON ?? "0 7 * * *",
  timezone: "Africa/Maputo",
  removalRecheckDelayMs: int(env.REMOVAL_RECHECK_DELAY_MS, 60_000),
  checkDelayMs: int(env.CHECK_DELAY_MS, 500),
  keepCheckingRemoved: bool(env.KEEP_CHECKING_REMOVED, false),
  asana: () => ({
    token: required("ASANA_TOKEN"),
    projectGid: required("ASANA_PROJECT_GID"),
    monthIndex: int(env.ASANA_MONTH_INDEX, 0),
    locationIndex: int(env.ASANA_LOCATION_INDEX, 1),
    maxDepth: int(env.ASANA_MAX_DEPTH, 3),
    includeCompleted: bool(env.ASANA_INCLUDE_COMPLETED, true),
    reviewerFromTitle: bool(env.ASANA_REVIEWER_FROM_TITLE, false),
  }),
  google: () => ({
    clientId: required("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_OAUTH_REFRESH_TOKEN"),
    locationsFile: env.GBP_LOCATIONS_FILE ?? "config/locations.json",
  }),
  /** "business-profile" (default, OAuth), "places" (Places API key), "apify" (Apify token) or "dataforseo". */
  reviewChecker: env.REVIEW_CHECKER ?? "business-profile",
  /** Optional second source, asked only when the first one fails (out of credit, refused, unreachable). */
  reviewCheckerFallback: env.REVIEW_CHECKER_FALLBACK || undefined,
  places: () => ({ apiKey: required("GOOGLE_PLACES_API_KEY") }),
  /** Apify bills per review scraped. How many are fetched per place is a dashboard setting (settings.ts). */
  apify: () => ({ token: required("APIFY_TOKEN") }),
  /**
   * priority: use the priority queue (about a minute, double the price) for every check.
   */
  dataforseoPriority: bool(env.DATAFORSEO_PRIORITY, false),
  dataforseo: () => ({
    login: required("DATAFORSEO_LOGIN"),
    password: required("DATAFORSEO_PASSWORD"),
    priority: config.dataforseoPriority,
  }),
  email: () => ({
    host: required("SMTP_HOST"),
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: required("MAIL_FROM"),
    to: required("NOTIFY_TO")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }),
  /** Slack DM is used instead of email when a bot token is configured. */
  slackEnabled: Boolean(env.SLACK_BOT_TOKEN),
  slack: () => ({
    botToken: required("SLACK_BOT_TOKEN"),
    recipientUserIds: required("SLACK_RECIPIENT_USER_ID")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }),
};

export type AsanaConfig = ReturnType<typeof config.asana>;
