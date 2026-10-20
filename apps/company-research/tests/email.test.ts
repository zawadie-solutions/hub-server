/** Email research orchestration and the email job manager. */
import { describe, expect, it } from "vitest";
import { insertCompany, insertRow } from "../src/db/repo";
import type { DiscoveredEmail, EmailJob } from "../src/models";
import { type EmailMatch, emailMatch } from "../src/providers/emailBase";
import { MockEmailDiscoveryProvider, MockEmailVerificationProvider } from "../src/providers/emailProviders";
import { EmailJobManager, type Item } from "../src/research/emailJobManager";
import { cleanDomain, dedupeEmails, looksLikeDomain, resolveDomain, runDomainSearch, runFindByCompany, runFindByName, verifyOne } from "../src/research/emailResearcher";
import { JobConflictError } from "../src/research/jobControl";
import { makeDb, settings } from "./helpers";

/** A discovery provider with a scripted, non-random response, for precise assertions. */
class FixedDiscovery extends MockEmailDiscoveryProvider {
  readonly name = "fixed";
  readonly isDemo = false;
  domainCalls: string[] = [];
  nameCalls: Record<string, unknown>[] = [];
  constructor(
    public domainMatches: EmailMatch[] = [],
    public nameMatches: EmailMatch[] = [],
  ) {
    super();
  }
  async searchDomain(domain: string) {
    this.domainCalls.push(domain);
    return this.domainMatches.map((m) => ({ ...m }));
  }
  async findByName(firstName: string, lastName: string, domain?: string | null, companyName?: string | null) {
    this.nameCalls.push({ first_name: firstName, last_name: lastName, domain: domain ?? null, company_name: companyName ?? null });
    return this.nameMatches.map((m) => ({ ...m }));
  }
}

describe("domain resolution", () => {
  it("cleans a domain", () => {
    expect(cleanDomain("https://www.Example.com/about")).toBe("example.com");
    expect(cleanDomain("example.com")).toBe("example.com");
  });

  it("prefers an explicit website", async () => {
    const { db } = await makeDb();
    const r = await resolveDomain(db, "ABC Roofing", "https://abcroofing.com/", null, settings());
    expect([r.domain, r.confidence]).toEqual(["abcroofing.com", 100]);
  });

  it("reuses an already researched company", async () => {
    const { db } = await makeDb();
    await insertCompany(db, { company_name: "ABC Roofing", website: "https://abcroofing.com/", confidence: 91 });
    const r = await resolveDomain(db, "abc roofing", null, null, settings());
    expect(r.domain).toBe("abcroofing.com");
    expect(r.company).not.toBeNull();
  });

  it("stays unresolved without a website or search provider", async () => {
    const { db } = await makeDb();
    expect((await resolveDomain(db, "Totally Unknown Co", null, null, settings())).domain).toBeNull();
  });

  it("recognises a URL or bare domain typed as the company name", async () => {
    const { db } = await makeDb();
    for (const value of ["https://zawadie.com/", "http://www.zawadie.com", "zawadie.com", "zawadie.com/about"]) {
      const r = await resolveDomain(db, value, null, null, settings());
      expect(r.domain, value).toBe("zawadie.com");
      expect(r.confidence).toBe(100);
    }
    // a real company name must still go through normal identification, not this shortcut
    expect(looksLikeDomain("Totally Unknown Co")).toBe(false);
    expect(looksLikeDomain("ABC Roofing LLC")).toBe(false);
  });
});

describe("email discovery", () => {
  it("never sends a raw URL as the company label", async () => {
    const { db } = await makeDb();
    const discovery = new FixedDiscovery([], [emailMatch({ email: "jimmy@zawadie.com", providerConfidence: 80 })]);
    const rows = await runFindByName(db, "Jimmy", "Minda", discovery, settings(), { companyName: "https://zawadie.com/" });
    expect(discovery.nameCalls).toEqual([{ first_name: "Jimmy", last_name: "Minda", domain: "zawadie.com", company_name: null }]);
    expect([rows[0].email, rows[0].domain]).toEqual(["jimmy@zawadie.com", "zawadie.com"]);
    expect(rows[0].company_name).toBeNull(); // the raw URL is never stored as if it were a company name
  });

  it("persists a domain search with its evidence", async () => {
    const { db } = await makeDb();
    const discovery = new FixedDiscovery([
      emailMatch({ email: "John@ABC.com", firstName: "John", lastName: "Smith", fullName: "John Smith", title: "Owner", emailType: "personal", providerConfidence: 91, sourceUrl: "https://abc.com/about" }),
    ]);
    const rows = await runDomainSearch(db, "ABC.com", discovery, settings(), { companyName: "ABC Roofing" });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.email).toBe("john@abc.com"); // normalised to lowercase
    expect([row.domain, row.status, row.confidence]).toEqual(["abc.com", "VERIFIED", 91]);
    expect([row.discovery_provider, row.is_demo]).toEqual(["fixed", false]);
  });

  it("updates a re-run instead of duplicating it", async () => {
    const { db } = await makeDb();
    const discovery = new FixedDiscovery([emailMatch({ email: "info@abc.com", providerConfidence: 60 })]);
    await runDomainSearch(db, "abc.com", discovery, settings());
    discovery.domainMatches = [emailMatch({ email: "info@abc.com", providerConfidence: 85 })];
    await runDomainSearch(db, "abc.com", discovery, settings());
    const rows = await db.query<DiscoveredEmail>("SELECT * FROM cr_discovered_emails WHERE email = 'info@abc.com'");
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(85); // updated, not duplicated
  });

  it("resolves the domain, then discovers", async () => {
    const { db } = await makeDb();
    const rows = await runFindByCompany(db, "ABC Roofing", new FixedDiscovery([emailMatch({ email: "sales@abc.com", providerConfidence: 70 })]), settings(), { website: "https://abc.com/" });
    expect([rows[0].email, rows[0].domain]).toEqual(["sales@abc.com", "abc.com"]);
  });

  it("needs review when the domain cannot be resolved", async () => {
    const { db } = await makeDb();
    const rows = await runFindByCompany(db, "Totally Unknown Co", new FixedDiscovery(), settings());
    expect(rows).toHaveLength(1);
    expect([rows[0].status, rows[0].email]).toEqual(["NEEDS_REVIEW", ""]);
  });

  it("returns a not-found marker when nothing matches", async () => {
    const { db } = await makeDb();
    const rows = await runFindByName(db, "John", "Smith", new FixedDiscovery(), settings(), { domain: "abc.com" });
    expect(rows).toHaveLength(1);
    expect([rows[0].status, rows[0].email]).toEqual(["NOT_FOUND", ""]);
  });

  it("fills in the searched-for name", async () => {
    const { db } = await makeDb();
    const rows = await runFindByName(db, "John", "Smith", new FixedDiscovery([], [emailMatch({ email: "john.smith@abc.com", providerConfidence: 88 })]), settings(), { domain: "abc.com" });
    expect([rows[0].email, rows[0].first_name, rows[0].last_name]).toEqual(["john.smith@abc.com", "John", "Smith"]);
  });
});

describe("email verification", () => {
  it("dedupes while keeping the row mapping", () => {
    const [unique, rowsByEmail] = dedupeEmails([{ email: "A@b.com" }, { email: "a@b.com" }, { email: "c@d.com" }, { email: "" }]);
    expect(unique.map((i) => i.email)).toEqual(["A@b.com", "c@d.com"]);
    expect(rowsByEmail.get("a@b.com")).toHaveLength(2); // both original rows kept for that address
  });

  it("persists a check and syncs discovered rows", async () => {
    const { db } = await makeDb();
    await runDomainSearch(db, "abc.com", new FixedDiscovery([emailMatch({ email: "john@abc.com", providerConfidence: 80 })]), settings());
    const row = await verifyOne(db, "JOHN@ABC.com", new MockEmailVerificationProvider());
    expect(row.email).toBe("john@abc.com");
    const [discovered] = await db.query<DiscoveredEmail>("SELECT * FROM cr_discovered_emails WHERE email = 'john@abc.com'");
    expect(discovered.verification_status).toBe(row.status);
    expect(discovered.verification_id).toBe(row.id);
  });

  it("turns a provider exception into a result", async () => {
    const { db } = await makeDb();
    const broken = {
      name: "broken",
      isDemo: false,
      verify: async (): Promise<never> => {
        throw new Error("boom");
      },
    };
    const row = await verifyOne(db, "a@b.com", broken);
    expect(row.status).toBe("Verification Failed");
    expect(row.error).toContain("boom");
  });
});

// ----------------------------------------------------------------- email job manager
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeWorker(delayMs = 50, failOn: string[] = []) {
  const calls: string[] = [];
  const factory = async (): Promise<[(item: Item) => Promise<void>, string, boolean]> => [
    async (item) => {
      await sleep(delayMs);
      if (failOn.includes(item.email)) throw new Error("simulated failure");
      calls.push(item.email);
    },
    "Test Provider",
    false,
  ];
  return { factory, calls };
}

const getJob = async (db: Awaited<ReturnType<typeof makeDb>>["db"], id: number) => (await db.query<EmailJob>("SELECT * FROM cr_email_jobs WHERE id = ?", [id]))[0];

describe("email job manager", () => {
  it("runs every item in order", async () => {
    const { db } = await makeDb();
    const manager = new EmailJobManager(db);
    const { factory, calls } = makeWorker(10);
    manager.register("verify", factory);
    const items = Array.from({ length: 5 }, (_, i) => ({ email: `user${i}@example.com` }));
    expect((await manager.start("verify", items)).total).toBe(5);
    await manager.wait();
    const final = manager.status();
    expect([final.completed, final.failed]).toEqual([5, 0]);
    expect(calls).toEqual(items.map((i) => i.email));
    const job = await getJob(db, final.job_id!);
    expect([job.status, job.pending_items]).toEqual(["COMPLETED", []]);
  });

  it("counts failed items without stopping", async () => {
    const { db } = await makeDb();
    const manager = new EmailJobManager(db);
    const { factory, calls } = makeWorker(10, ["bad@example.com"]);
    manager.register("verify", factory);
    await manager.start("verify", [{ email: "good@example.com" }, { email: "bad@example.com" }, { email: "good2@example.com" }]);
    await manager.wait();
    expect([manager.status().completed, manager.status().failed]).toEqual([3, 1]);
    expect(calls).toEqual(["good@example.com", "good2@example.com"]);
  });

  it("pauses, resumes and stops", async () => {
    const { db } = await makeDb();
    const manager = new EmailJobManager(db);
    const { factory } = makeWorker(150);
    manager.register("verify", factory);
    await manager.start("verify", Array.from({ length: 10 }, (_, i) => ({ email: `u${i}@example.com` })));
    expect((await manager.pause()).state).toBe("paused");
    await sleep(400);
    const frozen = manager.status().completed;
    await sleep(300);
    expect(manager.status().completed).toBe(frozen); // nothing moves while paused
    expect(frozen).toBeLessThan(10);
    expect((await manager.resume()).state).toBe("running");
    await sleep(300);
    await manager.stop();
    await manager.wait();
    const final = manager.status();
    expect(final.state).toBe("idle");
    expect(final.completed).toBeLessThan(10);
    const job = await getJob(db, final.job_id!);
    expect([job.status, job.pending_items]).toEqual(["STOPPED", []]); // remainder abandoned, not lost
  });

  it("restores an unfinished job after a restart", async () => {
    const { db } = await makeDb();
    const all = Array.from({ length: 8 }, (_, i) => ({ email: `u${i}@example.com` }));
    const [done, remaining] = [all.slice(0, 3), all.slice(3)];
    const now = new Date();
    await insertRow(db, "cr_email_jobs", { kind: "verify", status: "RUNNING", total: 8, completed: 3, failed: 0, pending_items: remaining, is_demo: false, created_at: now, updated_at: now });

    const restarted = new EmailJobManager(db);
    const { factory, calls } = makeWorker(20);
    restarted.register("verify", factory);
    await restarted.recover();
    const status = restarted.status();
    expect([status.state, status.restored, status.total, status.completed]).toEqual(["paused", true, 8, 3]);
    await restarted.resume();
    await restarted.wait();
    expect(restarted.status().completed).toBe(8);
    const job = await getJob(db, restarted.status().job_id!);
    expect([job.status, job.pending_items]).toEqual(["COMPLETED", []]);
    // only the items that survived the "crash" unprocessed get (re)run — nothing done twice
    expect([...calls].sort()).toEqual(remaining.map((i) => i.email).sort());
    expect(done.some((i) => calls.includes(i.email))).toBe(false);
  });

  it("refuses to start two jobs at once", async () => {
    const { db } = await makeDb();
    const manager = new EmailJobManager(db);
    const { factory } = makeWorker(200);
    manager.register("verify", factory);
    await manager.start("verify", [{ email: "a@example.com" }, { email: "b@example.com" }]);
    await expect(manager.start("verify", [{ email: "c@example.com" }])).rejects.toBeInstanceOf(JobConflictError);
    await manager.stop();
    await manager.wait();
  });
});
