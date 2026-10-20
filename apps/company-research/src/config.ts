/**
 * Application configuration: data paths, Settings, the search-provider selection and API keys.
 *
 * Settings and provider choices live in the cr_config table (not files) so they survive a
 * redeploy. API keys come from the environment (the hub's .env / hosting panel); a key entered on
 * the Settings page is stored in cr_config and takes precedence. Key values are never logged or
 * sent to the browser.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import type { Db } from "./db/db";

/** apps/company-research/ */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HUB_ROOT = path.resolve(ROOT, "..", "..");

export function dataDir(): string {
  const dir = process.env.COMPANY_RESEARCH_DATA_DIR || path.join(HUB_ROOT, "data", "company-research");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportDir(): string {
  const dir = path.join(dataDir(), "exports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Source hierarchy scores (configurable from Settings).
export const DEFAULT_SOURCE_SCORES: Record<string, number> = {
  official_website: 100,
  government_registry: 95,
  official_business_profile: 90,
  professional_profile: 85,
  reputable_directory: 80,
  news: 75,
  search_snippet: 60,
  unknown: 30,
};

export const SOURCE_LABELS: Record<string, string> = {
  official_website: "Official Company Website",
  government_registry: "Government/Business Registry",
  official_business_profile: "Official Business Profile",
  professional_profile: "Professional Profile",
  reputable_directory: "Reputable Directory",
  news: "News/Publication",
  search_snippet: "Search Snippet",
  unknown: "Unknown",
};

const int = (def: number, min: number, max: number) => z.number().int().min(min).max(max).default(def);

export const ThresholdsSchema = z.object({
  verified: int(85, 1, 100),
  likely: int(65, 1, 100),
  uncertain: int(40, 1, 100),
  // A second, different owner backed by a source at or above this score is a CONFLICT.
  conflict_min_score: int(75, 1, 100),
});

export const SettingsSchema = z.object({
  max_queries_per_company: int(20, 1, 100),
  max_results_per_query: int(10, 1, 20),
  request_delay_seconds: z.number().min(0).max(60).default(1.0),
  max_retries: int(3, 0, 10),
  max_concurrent_searches: int(3, 1, 10),
  // Read the identified official website's own home/about/contact pages (robots.txt respected).
  fetch_official_pages: z.boolean().default(true),
  source_scores: z.record(z.string(), z.number().int()).default(() => ({ ...DEFAULT_SOURCE_SCORES })),
  thresholds: ThresholdsSchema.default(() => ThresholdsSchema.parse({})),
});

export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

export interface ProvidersConfig {
  default_provider: string;
  secondary_provider: string | null;
  providers: Record<string, { enabled: boolean }>;
}

export const defaultProvidersConfig = (): ProvidersConfig => ({ default_provider: "google", secondary_provider: "bing", providers: {} });

// ------------------------------------------------------------------------- API keys
/** Keys entered on the Settings page ("" = deliberately cleared). Loaded from cr_config at start. */
const keyOverrides = new Map<string, string>();

/** The value of an API-key setting: a key saved from the Settings page wins over the environment. */
export function envValue(name: string): string {
  return keyOverrides.has(name) ? keyOverrides.get(name)! : (process.env[name] ?? "");
}

export const envSet = (name: string) => Boolean(envValue(name).trim());

// --------------------------------------------------------------------- the store
const KEY_PREFIX = "key:";

export class ConfigStore {
  constructor(private db: Db) {}

  private async read(name: string): Promise<unknown> {
    const rows = await this.db.query<{ value: string }>("SELECT value FROM cr_config WHERE name = ?", [name]);
    if (!rows.length) return undefined;
    try {
      return JSON.parse(rows[0].value);
    } catch {
      return undefined;
    }
  }

  private async write(name: string, value: unknown): Promise<void> {
    await this.db.execute(
      "INSERT INTO cr_config (name, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)",
      [name, JSON.stringify(value), new Date()],
    );
  }

  async loadSettings(): Promise<Settings> {
    const raw = await this.read("settings");
    const parsed = SettingsSchema.safeParse(raw ?? {});
    const settings = parsed.success ? parsed.data : defaultSettings();
    // Make sure newly introduced source types always have a score.
    for (const [key, value] of Object.entries(DEFAULT_SOURCE_SCORES)) if (!(key in settings.source_scores)) settings.source_scores[key] = value;
    return settings;
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.write("settings", settings);
  }

  async loadProvidersConfig(): Promise<ProvidersConfig> {
    const raw = (await this.read("providers")) as Partial<ProvidersConfig> | undefined;
    const base = defaultProvidersConfig();
    if (!raw || typeof raw !== "object") return base;
    return {
      default_provider: typeof raw.default_provider === "string" ? raw.default_provider : base.default_provider,
      secondary_provider: raw.secondary_provider === undefined ? base.secondary_provider : (raw.secondary_provider ?? null),
      providers: Object.fromEntries(Object.entries(raw.providers ?? {}).map(([k, v]) => [k, { enabled: Boolean(v?.enabled) }])),
    };
  }

  saveProvidersConfig(cfg: ProvidersConfig): Promise<void> {
    return this.write("providers", cfg);
  }

  /** Loads the keys saved from the Settings page into memory (called once at start). */
  async loadKeys(): Promise<void> {
    const rows = await this.db.query<{ name: string; value: string }>("SELECT name, value FROM cr_config WHERE name LIKE ?", [`${KEY_PREFIX}%`]);
    keyOverrides.clear();
    for (const row of rows) keyOverrides.set(row.name.slice(KEY_PREFIX.length), JSON.parse(row.value));
  }

  /** Persists an API key and applies it to the running app. Never logged or returned. */
  async saveKey(name: string, value: string): Promise<void> {
    await this.write(KEY_PREFIX + name, value);
    keyOverrides.set(name, value);
  }
}
