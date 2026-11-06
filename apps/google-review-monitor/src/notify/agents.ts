import { type ReviewRow, workedOnByPerson } from "../types";

export type { AgentNotice } from "../types";

/** A teammate who gets their own removal alerts, as found in Slack. */
export interface Agent {
  userId: string;
  /** Every name Slack has for them (full name, display name, username), for matching Asana's "Worked on by". */
  names: string[];
  /** Null when the Slack app lacks the users:read.email scope. */
  email: string | null;
  /** Slack username, e.g. "jessica.kabemba": compared with the part of the Asana email before the @ when Slack gives no email. */
  username: string | null;
}

// Case, accents and extra spaces do not count: "Manassé  Tshitende" is "manasse tshitende".
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The agent a removed review belongs to: matched on the Asana name first, then, when the name
 * does not match anyone (or Asana has no name), on the Asana email. Null when it is nobody's.
 */
export function matchAgent(agents: Agent[], row: Parameters<typeof workedOnByPerson>[0]): Agent | null {
  const person = workedOnByPerson(row);
  if (!person) return null;
  if (person.name) {
    const name = norm(person.name);
    const byName = agents.find((a) => a.names.some((n) => norm(n) === name));
    if (byName) return byName;
  }
  // Asana shows the email as the name for someone who never set a name (e.g. "manasse.tshitende@zawadie.com").
  const email = (person.email ?? (person.name?.includes("@") ? person.name : null))?.trim().toLowerCase();
  if (email) {
    const byEmail = agents.find((a) => a.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
    const local = email.split("@")[0];
    const byUsername = agents.find((a) => !a.email && a.username?.trim().toLowerCase() === local);
    if (byUsername) return byUsername;
  }
  return null;
}

/** Each agent with the removed reviews they worked on. Agents with none are left out. */
export function reviewsByAgent(agents: Agent[], rows: ReviewRow[]): Map<Agent, ReviewRow[]> {
  const out = new Map<Agent, ReviewRow[]>();
  for (const row of rows) {
    const agent = matchAgent(agents, row);
    if (agent) out.set(agent, [...(out.get(agent) ?? []), row]);
  }
  return out;
}
