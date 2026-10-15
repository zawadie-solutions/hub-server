import type { Notifier } from "../types";

/**
 * Sends a removal notice as a Slack DM to each recipient via chat.postMessage
 * (channel = a user id opens/uses the DM — there's no multi-recipient DM call, so this is
 * one request per person). All recipients are attempted even if an earlier one fails; if any
 * fail, the whole send throws so the cycle retries next run (a retry may re-DM someone who
 * already got it, but that's preferable to silently dropping a teammate's notification).
 */
export class SlackDmNotifier implements Notifier {
  constructor(
    private c: { botToken: string; recipientUserIds: string[] },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(m: { subject: string; text: string }): Promise<void> {
    const text = `*${m.subject}*\n\n${m.text}`;
    const failures: string[] = [];
    for (const recipientUserId of this.c.recipientUserIds) {
      try {
        const res = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.c.botToken}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: recipientUserId, text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) throw new Error(j.error);
      } catch (e) {
        failures.push(`${recipientUserId}: ${(e as Error).message}`);
      }
    }
    if (failures.length) throw new Error(`Slack DM failed for ${failures.join("; ")}`);
  }
}
