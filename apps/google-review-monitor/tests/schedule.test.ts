import { describe, expect, it } from "vitest";
import { nextDailyRun, nextScheduledRun } from "../src/server/schedule";

describe("nextDailyRun", () => {
  it("returns today's run when it hasn't happened yet (fixed UTC+2 offset)", () => {
    const from = new Date("2026-03-05T03:00:00Z"); // 05:00 in Africa/Maputo
    const next = nextDailyRun(7, 0, "Africa/Maputo", from);
    expect(next.toISOString()).toBe("2026-03-05T05:00:00.000Z");
  });

  it("rolls over to tomorrow when today's run already passed", () => {
    const from = new Date("2026-03-05T06:00:00Z"); // 08:00 in Africa/Maputo, past 07:00
    const next = nextDailyRun(7, 0, "Africa/Maputo", from);
    expect(next.toISOString()).toBe("2026-03-06T05:00:00.000Z");
  });

  it("handles a DST-observing zone", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const next = nextDailyRun(7, 0, "America/New_York", from);
    expect(next.toISOString()).toBe("2026-01-15T12:00:00.000Z"); // EST = UTC-5
  });
});

describe("nextScheduledRun", () => {
  it("parses a simple daily cron expression", () => {
    const from = new Date("2026-03-05T03:00:00Z");
    expect(nextScheduledRun("0 7 * * *", "Africa/Maputo", from)?.toISOString()).toBe("2026-03-05T05:00:00.000Z");
  });

  it("returns null for anything beyond a plain daily schedule", () => {
    expect(nextScheduledRun("0 7 * * 1", "Africa/Maputo")).toBeNull();
    expect(nextScheduledRun("*/5 * * * *", "Africa/Maputo")).toBeNull();
  });
});
