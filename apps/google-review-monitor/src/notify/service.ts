import type { ReviewRepo } from "../db/repo";
import { logger } from "../logger";
import type { Notifier, ReviewRow } from "../types";
import { buildRemovalMessage } from "./message";

export interface NotifySummary {
  pending: number;
  sent: number;
  failed: number;
}

/**
 * Sends one digest for every REMOVED review not yet notified. This also retries earlier
 * failures, because a failed send never sets notification_sent.
 */
export async function notifyPending(
  repo: ReviewRepo,
  notifier: Notifier,
  opts: { stopCheckingAfterNotify: boolean },
): Promise<NotifySummary> {
  const pending = await repo.pendingNotifications();
  if (pending.length === 0) return { pending: 0, sent: 0, failed: 0 };
  const ids = pending.map((r) => r.id);
  try {
    await notifier.send(buildRemovalMessage(pending));
  } catch (e) {
    const msg = (e as Error).message;
    logger.error({ err: msg, count: ids.length }, "notification failed; will retry next run");
    await repo.markNotificationFailed(ids, msg);
    return { pending: ids.length, sent: 0, failed: ids.length };
  }
  await repo.markNotified(ids, opts.stopCheckingAfterNotify);
  logger.info({ count: ids.length }, "removal notification sent");
  await notifyAgents(repo, notifier, pending);
  return { pending: ids.length, sent: ids.length, failed: 0 };
}

/**
 * After the leads have the full alert, each agent gets the part they worked on. Not retried:
 * the alert already counts as sent, so a retry would send the leads a duplicate.
 * Each outcome goes to the audit log, so a missed agent can be seen there.
 */
async function notifyAgents(repo: ReviewRepo, notifier: Notifier, rows: ReviewRow[]): Promise<void> {
  if (!notifier.notifyAgents) return;
  try {
    for (const n of await notifier.notifyAgents(rows, buildRemovalMessage)) {
      const reviews = `${n.reviews} removed review${n.reviews === 1 ? "" : "s"}`;
      if (n.error) logger.warn({ agent: n.userId, err: n.error }, "agent removal alert failed");
      else logger.info({ agent: n.userId, count: n.reviews }, "agent removal alert sent");
      await repo.addAudit({
        actor: "system",
        action: n.error ? "notify.agent_failed" : "notify.agent",
        summary: n.error ? `Could not send ${n.name} their removal alert (${reviews}): ${n.error}` : `Sent ${n.name} their removal alert (${reviews})`,
      });
    }
  } catch (e) {
    logger.error({ err: (e as Error).message }, "agent removal alerts failed");
  }
}
