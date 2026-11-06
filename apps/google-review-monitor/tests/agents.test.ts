import { describe, expect, it } from "vitest";
import { type Agent, matchAgent, reviewsByAgent } from "../src/notify/agents";
import { buildRemovalMessage } from "../src/notify/message";
import { SlackDmNotifier } from "../src/notify/slack";
import type { ReviewRow } from "../src/types";

const jessica: Agent = { userId: "U08EADMUCRJ", names: ["Jessica Kabemba", "jessica.kabemba"], email: "jessica.kabemba@zawadie.com", username: "jessica.kabemba" };
const papy: Agent = { userId: "U0746D7PGJX", names: ["Papy Kapend", "papy.kapend"], email: "papy.kapend@zawadie.com", username: "papy.kapend" };
const manasse: Agent = { userId: "U07MY3K3CCA", names: ["Manasse Tshitende"], email: "manasse.tshitende@zawadie.com", username: "manasse.tshitende" };
const agents = [jessica, papy, manasse];

let nextId = 1;
const row = (over: Partial<ReviewRow> = {}) =>
  ({
    id: nextId++,
    location: "Location A",
    reviewer_name: "Susan Gaynor",
    assignee_name: null,
    assignee_email: null,
    location_assignee_name: null,
    location_assignee_email: null,
    asana_task_url: "https://app.asana.com/0/1/2",
    google_review_url: "https://maps.app.goo.gl/x",
    ...over,
  }) as ReviewRow;

describe("which agent a removed review belongs to", () => {
  it("matches the Asana name, ignoring case, accents and extra spaces", () => {
    expect(matchAgent(agents, row({ assignee_name: "Jessica Kabemba" }))).toBe(jessica);
    expect(matchAgent(agents, row({ assignee_name: "  manassé   TSHITENDE " }))).toBe(manasse);
  });

  it("falls back to the Asana email when the name does not match anyone", () => {
    expect(matchAgent(agents, row({ assignee_name: "Pastor Papy", assignee_email: "Papy.Kapend@zawadie.com" }))).toBe(papy);
    expect(matchAgent(agents, row({ assignee_name: null, assignee_email: "jessica.kabemba@zawadie.com" }))).toBe(jessica);
  });

  it("without Slack emails (no users:read.email scope), matches the Asana email to the Slack username", () => {
    const noEmails = agents.map((a) => ({ ...a, email: null }));
    expect(matchAgent(noEmails, row({ assignee_name: "Pastor Papy", assignee_email: "papy.kapend@zawadie.com" }))?.userId).toBe(papy.userId);
    expect(matchAgent(noEmails, row({ assignee_name: "Pastor Papy", assignee_email: "pastor@zawadie.com" }))).toBeNull();
  });

  it("treats an Asana name that is really an email (someone who never set a name) as the email", () => {
    expect(matchAgent(agents, row({ assignee_name: "manasse.tshitende@zawadie.com" }))).toBe(manasse);
    expect(matchAgent(agents.map((a) => ({ ...a, email: null })), row({ location_assignee_name: "manasse.tshitende@zawadie.com" }))?.userId).toBe(manasse.userId);
  });

  it("matches the names Asana really uses for the three agents", () => {
    expect(matchAgent(agents, row({ assignee_name: "Jessica Kabemba" }))).toBe(jessica);
    expect(matchAgent(agents, row({ assignee_name: "Papy kapend" }))).toBe(papy);
    expect(matchAgent(agents, row({ assignee_name: "Vanessa Mango" }))).toBeNull();
  });

  it("uses the location's assignee when the dispute has none, the same person as Worked on by", () => {
    expect(matchAgent(agents, row({ location_assignee_name: "Papy Kapend" }))).toBe(papy);
    // The dispute's own assignee wins, even when the location belongs to an agent.
    expect(matchAgent(agents, row({ assignee_name: "Joseph Mukele", location_assignee_name: "Papy Kapend" }))).toBeNull();
  });

  it("is nobody's when neither name nor email matches, or nobody is assigned", () => {
    expect(matchAgent(agents, row({ assignee_name: "Joseph Mukele", assignee_email: "joseph@zawadie.com" }))).toBeNull();
    expect(matchAgent(agents, row())).toBeNull();
  });

  it("groups each agent's reviews and leaves out agents with none", () => {
    const rows = [row({ assignee_name: "Jessica Kabemba" }), row({ assignee_name: "Joseph Mukele" }), row({ assignee_email: "jessica.kabemba@zawadie.com" })];
    const grouped = reviewsByAgent(agents, rows);
    expect([...grouped.keys()]).toEqual([jessica]);
    expect(grouped.get(jessica)?.map((r) => r.id)).toEqual([rows[0].id, rows[2].id]);
  });
});

describe("SlackDmNotifier.notifyAgents", () => {
  const slack = (users: Record<string, object>, failDmTo: string[] = []) => {
    const dms: { channel: string; text: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname.endsWith("users.info")) {
        const user = users[u.searchParams.get("user") ?? ""];
        return new Response(JSON.stringify(user ? { ok: true, user } : { ok: false, error: "user_not_found" }));
      }
      const body = JSON.parse(String(init?.body));
      if (failDmTo.includes(body.channel)) return new Response(JSON.stringify({ ok: false, error: "channel_not_found" }));
      dms.push(body);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    return { dms, fetchImpl };
  };
  const users = {
    U08EADMUCRJ: { name: "jessica.kabemba", real_name: "Jessica Kabemba", profile: { email: "jessica.kabemba@zawadie.com" } },
    U0746D7PGJX: { name: "papy.kapend", real_name: "Papy Kapend", profile: {} },
    U07MY3K3CCA: { name: "manasse.tshitende", real_name: "Manasse Tshitende", profile: { email: "manasse.tshitende@zawadie.com" } },
  };
  const ids = Object.keys(users);

  it("sends each agent one message with only their reviews, and nobody else anything", async () => {
    const { dms, fetchImpl } = slack(users);
    const n = new SlackDmNotifier({ botToken: "xoxb", recipientUserIds: ["U07TGUZ7563"], agentUserIds: ids }, fetchImpl);
    const rows = [
      row({ reviewer_name: "R1", assignee_name: "Jessica Kabemba" }),
      row({ reviewer_name: "R2", assignee_name: "Pastor Papy", assignee_email: "papy.kapend@zawadie.com" }),
      row({ reviewer_name: "R3", assignee_name: "Joseph Mukele" }),
      row({ reviewer_name: "R4", location_assignee_name: "Jessica Kabemba" }),
    ];
    const notices = await n.notifyAgents(rows, buildRemovalMessage);

    expect(dms.map((d) => d.channel).sort()).toEqual(["U0746D7PGJX", "U08EADMUCRJ"]);
    const toJessica = dms.find((d) => d.channel === "U08EADMUCRJ")!.text;
    expect(toJessica).toContain("Google Reviews Removed (2)");
    expect(toJessica).toContain("Reviewer: R1");
    expect(toJessica).toContain("Reviewer: R4");
    expect(toJessica).not.toContain("Reviewer: R2");
    expect(toJessica).not.toContain("Reviewer: R3");
    const toPapy = dms.find((d) => d.channel === "U0746D7PGJX")!.text;
    expect(toPapy).toContain("Reviewer: R2");
    expect(toPapy).not.toContain("Reviewer: R1");
    expect(notices).toEqual([
      { userId: "U08EADMUCRJ", name: "Jessica Kabemba", reviews: 2 },
      { userId: "U0746D7PGJX", name: "Papy Kapend", reviews: 1 },
    ]);
  });

  it("does not send a lead a second copy, and reports agents it could not reach instead of throwing", async () => {
    const { dms, fetchImpl } = slack(users, ["U07MY3K3CCA"]);
    const n = new SlackDmNotifier({ botToken: "xoxb", recipientUserIds: ["U08EADMUCRJ"], agentUserIds: [...ids, "UGONE"] }, fetchImpl);
    const notices = await n.notifyAgents(
      [row({ assignee_name: "Jessica Kabemba" }), row({ assignee_name: "Manasse Tshitende" })],
      buildRemovalMessage,
    );
    expect(dms).toEqual([]);
    expect(notices).toEqual([
      { userId: "UGONE", name: "UGONE", reviews: 0, error: "could not look them up in Slack: user_not_found" },
      { userId: "U07MY3K3CCA", name: "Manasse Tshitende", reviews: 1, error: "channel_not_found" },
    ]);
  });

  it("does nothing when no agents are set", async () => {
    const { dms, fetchImpl } = slack(users);
    const n = new SlackDmNotifier({ botToken: "xoxb", recipientUserIds: ["U07TGUZ7563"] }, fetchImpl);
    expect(await n.notifyAgents([row({ assignee_name: "Jessica Kabemba" })], buildRemovalMessage)).toEqual([]);
    expect(dms).toEqual([]);
  });
});
