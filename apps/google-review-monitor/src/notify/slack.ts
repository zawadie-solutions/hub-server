import type { Notifier, RemovalMessage, ReviewRow } from "../types";
import { type Agent, type AgentNotice, reviewsByAgent } from "./agents";

interface SlackUser {
  name?: string;
  real_name?: string;
  profile?: { real_name?: string; display_name?: string; email?: string };
}

/**
 * Sends a removal notice as a Slack DM to each recipient via chat.postMessage
 * (channel = a user id opens/uses the DM — there's no multi-recipient DM call, so this is
 * one request per person). All recipients are attempted even if an earlier one fails; if any
 * fail, the whole send throws so the cycle retries next run (a retry may re-DM someone who
 * already got it, but that's preferable to silently dropping a teammate's notification).
 *
 * The recipients are the leads, who get every removal. Agents (agentUserIds) are each sent
 * only the removals they worked on, after the leads' send went through: see notifyAgents.
 */
export class SlackDmNotifier implements Notifier {
  constructor(
    private c: { botToken: string; recipientUserIds: string[]; agentUserIds?: string[] },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async api<T>(method: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
    const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
    const res = await this.fetchImpl(`https://slack.com/api/${method}${qs}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.c.botToken}`, "Content-Type": "application/json; charset=utf-8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!j.ok) throw new Error(j.error);
    return j;
  }

  private async dm(userId: string, m: { subject: string; text: string }): Promise<void> {
    await this.api("chat.postMessage", { method: "POST", body: JSON.stringify({ channel: userId, text: `*${m.subject}*\n\n${m.text}` }) });
  }

  async send(m: { subject: string; text: string }): Promise<void> {
    const failures: string[] = [];
    for (const recipientUserId of this.c.recipientUserIds) {
      try {
        await this.dm(recipientUserId, m);
      } catch (e) {
        failures.push(`${recipientUserId}: ${(e as Error).message}`);
      }
    }
    if (failures.length) throw new Error(`Slack DM failed for ${failures.join("; ")}`);
  }

  /** Reads each agent's names and email from Slack. Agents Slack cannot find are reported, not thrown. */
  private async agents(): Promise<{ agents: Agent[]; notices: AgentNotice[] }> {
    const leads = new Set(this.c.recipientUserIds);
    const agents: Agent[] = [];
    const notices: AgentNotice[] = [];
    // A lead already gets every removal, so is never sent a second, shorter copy.
    for (const userId of (this.c.agentUserIds ?? []).filter((id) => !leads.has(id))) {
      try {
        const { user } = await this.api<{ user: SlackUser }>("users.info", { query: { user: userId } });
        const names = [user.real_name, user.profile?.real_name, user.profile?.display_name, user.name].filter((n): n is string => !!n?.trim());
        agents.push({ userId, names, email: user.profile?.email ?? null, username: user.name ?? null });
      } catch (e) {
        notices.push({ userId, name: userId, reviews: 0, error: `could not look them up in Slack: ${(e as Error).message}` });
      }
    }
    return { agents, notices };
  }

  /** Sends each agent one DM with only the removed reviews they worked on. Never throws. */
  async notifyAgents(rows: ReviewRow[], build: (rows: ReviewRow[]) => RemovalMessage): Promise<AgentNotice[]> {
    if (!this.c.agentUserIds?.length) return [];
    const { agents, notices } = await this.agents();
    for (const [agent, theirs] of reviewsByAgent(agents, rows)) {
      const notice: AgentNotice = { userId: agent.userId, name: agent.names[0] ?? agent.userId, reviews: theirs.length };
      try {
        await this.dm(agent.userId, build(theirs));
      } catch (e) {
        notice.error = (e as Error).message;
      }
      notices.push(notice);
    }
    return notices;
  }
}
