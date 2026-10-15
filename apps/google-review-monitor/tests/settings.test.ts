import { describe, expect, it } from "vitest";
import { applyStored, describeChanges, envDefaults, parseSettings, settings } from "../src/settings";
import { makeRepo } from "./helpers";

describe("runtime settings", () => {
  it("accepts valid values from the dashboard form or the database", () => {
    expect(parseSettings({ reviewChecker: "apify", reviewCheckerFallback: "", reviewsPerLocation: "500", dataforseoPriority: "true", dailyCheckEnabled: false })).toEqual({
      reviewChecker: "apify",
      reviewCheckerFallback: "",
      reviewsPerLocation: 500,
      dataforseoPriority: true,
      dailyCheckEnabled: false,
    });
    expect(parseSettings({ somethingElse: 1 })).toEqual({});
  });

  it("rejects bad values with a message a person can act on", () => {
    expect(() => parseSettings({ reviewChecker: "bing" })).toThrow("Review source");
    expect(() => parseSettings({ reviewsPerLocation: 50000 })).toThrow("from 0 to 20,000");
    expect(() => parseSettings({ reviewsPerLocation: 12.5 })).toThrow("whole number");
    expect(() => parseSettings({ reviewsPerLocation: -1 })).toThrow("whole number");
    expect(() => parseSettings({ dailyCheckEnabled: "maybe" })).toThrow("on or off");
  });

  it("stored values override .env, invalid ones are skipped, and clearing them restores .env", () => {
    const env = envDefaults();
    applyStored({ reviewsPerLocation: "750", dailyCheckEnabled: "false", reviewChecker: "bing" });
    expect(settings).toMatchObject({ reviewsPerLocation: 750, dailyCheckEnabled: false, reviewChecker: env.reviewChecker });
    applyStored({});
    expect(settings).toEqual(env);
  });

  it("describes only what actually changes, in plain words", () => {
    const from = { ...envDefaults(), reviewChecker: "apify", reviewCheckerFallback: "", reviewsPerLocation: 200, dailyCheckEnabled: true };
    expect(describeChanges(from, { reviewChecker: "dataforseo", reviewCheckerFallback: "apify", reviewsPerLocation: 200, dailyCheckEnabled: false })).toEqual([
      "Review source changed from Apify to DataForSEO",
      "Fallback source changed from none to Apify",
      "Automatic daily check changed from on to off",
    ]);
    expect(describeChanges(from, { reviewsPerLocation: 0 })).toEqual(["Google reviews per location changed from 200 to no limit"]);
  });
});

describe("audit log and saved settings (repo)", () => {
  it("lists audit entries newest first, filtered by kind and paged", async () => {
    const { repo } = await makeRepo();
    await repo.addAudit({ actor: "admin", action: "run.started", summary: "Started a check of October" });
    await repo.addAudit({ actor: "admin", action: "settings.changed", summary: "Review source changed" });
    await repo.addAudit({ actor: "scheduler", action: "daily.finished", summary: "Daily check finished" });
    const all = await repo.listAudit();
    expect(all.map((e) => e.action)).toEqual(["daily.finished", "settings.changed", "run.started"]);
    expect(all[0]).toMatchObject({ actor: "scheduler", summary: "Daily check finished" });
    expect((await repo.listAudit({ prefixes: ["run.", "daily."] })).map((e) => e.action)).toEqual(["daily.finished", "run.started"]);
    expect((await repo.listAudit({ limit: 1 })).length).toBe(1);
    expect((await repo.listAudit({ beforeId: all[1].id })).map((e) => e.action)).toEqual(["run.started"]);
  });

  it("saves settings, overwrites on a second save, and clears them", async () => {
    const { repo } = await makeRepo();
    expect(await repo.getSettings()).toEqual({});
    await repo.saveSettings({ reviewsPerLocation: "500", dailyCheckEnabled: "false" }, "admin");
    await repo.saveSettings({ reviewsPerLocation: "800" }, "admin");
    expect(await repo.getSettings()).toEqual({ reviewsPerLocation: "800", dailyCheckEnabled: "false" });
    await repo.clearSettings();
    expect(await repo.getSettings()).toEqual({});
  });
});
