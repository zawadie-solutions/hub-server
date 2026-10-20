import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Exports go to a throwaway folder, never the hub's data/.
process.env.COMPANY_RESEARCH_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "crt-tests-"));
import { ConfigStore, defaultSettings, type Settings } from "../src/config";
import { type Db, migrate } from "../src/db/db";
import { insertCompany } from "../src/db/repo";
import { createScratchDb } from "../src/db/scratch";
import type { SearchProvider, SearchResult } from "../src/providers/base";
import { type MockProfile, MockProvider } from "../src/providers/mock";
import { ResearchEngine } from "../src/research/engine";

/**
 * Database tests run against a real MySQL server, each in its own empty database that is dropped
 * afterwards. TEST_DATABASE_URL names the server, e.g. mysql://root:secret@127.0.0.1:3306 (the
 * account needs CREATE and DROP rights; any database name in the URL is ignored).
 */
function testServerUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a MySQL server (mysql://user:password@host:3306) to run the database tests");
  return url;
}

const scratchDbs: { drop: () => Promise<void> }[] = [];
afterAll(async () => {
  for (const s of scratchDbs.splice(0)) await s.drop();
});

export async function makeDb(): Promise<{ db: Db; config: ConfigStore }> {
  const scratch = await createScratchDb(testServerUrl(), "crt_test");
  scratchDbs.push(scratch);
  await migrate(scratch.db);
  return { db: scratch.db, config: new ConfigStore(scratch.db) };
}

export const settings = (): Settings => defaultSettings();

export const makeCompany = (over: { company_name?: string; city?: string | null; state?: string | null; address?: string | null } = {}) => ({
  company_name: "ABC Roofing",
  city: "Portland",
  state: "Oregon",
  ...over,
});

export const result = (title: string, url: string, snippet: string, source = "test", query = "q"): SearchResult => ({ title, url, snippet, source, displayUrl: "", query });

/** research(profile) -> the researched company, via the demo web built from that one profile. */
export async function research(db: Db, profile: MockProfile | null, opts: { name?: string; city?: string; state?: string; provider?: SearchProvider; settings?: Settings } = {}) {
  const city = opts.city ?? "Portland";
  const state = opts.state ?? "Oregon";
  const profiles = profile ? [{ ...profile, city: profile.city ?? city, state: profile.state ?? state }] : [];
  const provider = opts.provider ?? new MockProvider(profiles, false);
  const company = await insertCompany(db, { company_name: opts.name ?? profile?.name ?? "Nowhere Co", city, state });
  return new ResearchEngine(db, provider, opts.settings ?? settings()).researchCompany(company.id);
}

/** A search provider driven by a function (the Python tests' ad-hoc SearchProvider subclasses). */
export function scriptedProvider(name: string, search: (query: string) => SearchResult[] | Promise<SearchResult[]>): SearchProvider {
  return { name, label: name, isDemo: false, requiredEnv: [], isConfigured: () => true, search: async (q) => search(q) };
}
