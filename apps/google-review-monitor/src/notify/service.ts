import type { ReviewRepo } from "../db/repo";
import { logger } from "../logger";
import type { Notifier } from "../types";
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
  return { pending: ids.length, sent: ids.length, failed: 0 };
}
