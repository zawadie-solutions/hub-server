import cron from "node-cron";
import { config } from "./config";
import { logger } from "./logger";
import { runCycle } from "./monitor/cycle";
import { settings } from "./settings";
import { buildChecker, type buildDeps } from "./wiring";

/** Schedules the automatic daily check. Reads the live settings each time, so Configure-page changes apply. */
export function startScheduler({ repo, deps }: Pick<ReturnType<typeof buildDeps>, "repo" | "deps">): void {
  if (!cron.validate(config.scheduleCron)) throw new Error(`Invalid SCHEDULE_CRON: ${config.scheduleCron}`);
  const audit = (action: string, summary: string) =>
    repo.addAudit({ actor: "scheduler", action, summary }).catch((e) => logger.error({ err: e.message }, "audit write failed"));

  async function dailyCheck() {
    if (!settings.dailyCheckEnabled) {
      logger.info("daily check skipped: turned off on the Configure page");
      await audit("daily.skipped", "Daily check skipped because the automatic daily check is turned off");
      return;
    }
    try {
      await audit("daily.started", "Daily check started");
      const r = await runCycle({ ...deps, checker: buildChecker() });
      await audit("daily.finished", r.skipped ? "Daily check skipped because another check was already running" : r.ok ? "Daily check finished" : "Daily check finished with errors (see the app log)");
    } catch (e) {
      logger.error({ err: (e as Error).message }, "cycle crashed");
      await audit("daily.failed", `Daily check failed: ${(e as Error).message}`);
    }
  }

  cron.schedule(config.scheduleCron, () => void dailyCheck(), { timezone: config.timezone });
  logger.info({ schedule: config.scheduleCron, timezone: config.timezone }, "review monitor scheduled");
}
