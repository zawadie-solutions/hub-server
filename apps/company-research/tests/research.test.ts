/** Company identification, owner research, contact research and the full engine. */
import { describe, expect, it } from "vitest";
import { AllProvidersFailed, searchResult } from "../src/providers/base";
import { COMPLETED, CONFLICT, type Evidence, FAILED, NEEDS_REVIEW, NOT_FOUND, type ResearchLog, type ReviewItem, VERIFIED } from "../src/models";
import { identifyCompany, prepareDocs } from "../src/research/companyResearcher";
import { findBusinessPhone, findCompanyEmail, findPersonEmail, findPersonPhone } from "../src/research/contactResearcher";
import { ResearchEngine } from "../src/research/engine";
import { extractEmails, extractPeople, extractPhones } from "../src/research/extraction";
import { collectPeople, decideDecisionMaker, decideOwner } from "../src/research/ownerResearcher";
import * as qb from "../src/research/queryBuilder";
import { classifySource } from "../src/research/verification";
import { insertCompany } from "../src/db/repo";
import { makeCompany, makeDb, research, result, scriptedProvider, settings } from "./helpers";

const ABC = makeCompany();
const OFFICIAL = "abcroofing.com";
const docs = (results: ReturnType<typeof result>[], company = ABC, domain = OFFICIAL) => prepareDocs(results, company, domain);

// ---------------------------------------------------------------- query builder
describe("query builder", () => {
  it("generates multiple variations", () => {
    const companyQueries = qb.buildCompanyQueries(ABC);
    expect(companyQueries[0]).toBe('"ABC Roofing" Portland Oregon');
    expect(companyQueries.length).toBeGreaterThanOrEqual(5);
    const ownerQueries = qb.buildOwnerQueries(ABC, "https://www.abcroofing.com/");
    expect(ownerQueries).toContain('"ABC Roofing" owner');
    expect(ownerQueries).toContain("site:abcroofing.com about");
    expect(qb.buildOwnerPhoneQueries(ABC, "John Smith")[0]).toBe('"John Smith" "ABC Roofing" phone');
    expect(qb.buildOwnerEmailQueries(ABC, "John Smith")).toContain('"John Smith" "ABC Roofing" "@"');
    expect(qb.buildCompanyEmailQueries(ABC, "abcroofing.com")).toContain("site:abcroofing.com email");
    expect(qb.buildDecisionMakerQueries(ABC)).toContain('"ABC Roofing" general manager');
  });

  it("leads owner and decision-maker searches with one combined query", () => {
    expect(qb.buildOwnerQueries(ABC)[0]).toBe('"ABC Roofing" Portland Oregon owner title phone email');
    expect(qb.buildDecisionMakerQueries(ABC)[0]).toBe('"ABC Roofing" Portland Oregon manager title phone email');
    // a known street address narrows the search far better than city/state and takes priority
    const withAddress = makeCompany({ address: "123 Main St, Portland, OR 97201" });
    expect(qb.buildOwnerQueries(withAddress)[0]).toBe('"ABC Roofing" 123 Main St, Portland, OR 97201 owner title phone email');
  });
});

// ------------------------------------------------------- company identification
describe("company identification", () => {
  it("selects the correct company", () => {
    const results = [
      result("ABC Roofing | Portland, Oregon", "https://www.abcroofing.com/", "Roofing in Portland, OR.", "test", "q1"),
      result("Contact ABC Roofing", "https://www.abcroofing.com/contact", "Portland, Oregon office", "test", "q1"),
      result("ABC Roofing - Yelp", "https://www.yelp.com/biz/abc-roofing-portland", "ABC Roofing, Portland, OR", "test", "q1"),
      result("ABC Roofing of Texas", "https://abcroofingtx.com/", "ABC Roofing serves Houston, Texas.", "test", "q1"),
      result("ABC Roofing Portland", "https://www.abcroofing.com/", "Roofing in Portland, OR.", "test", "q2"),
    ];
    const ident = identifyCompany(ABC, results, settings());
    expect(ident.identified && ident.status === VERIFIED).toBe(true);
    expect(ident.website).toBe("https://www.abcroofing.com/");
    expect(ident.domain).toBe("abcroofing.com");
  });

  it("rejects a same-named company in another state", () => {
    const results = [0, 1, 2].map((i) => result("ABC Roofing of Texas", "https://abcroofingtx.com/", "ABC Roofing serves Houston, Texas.", "test", `q${i}`));
    const ident = identifyCompany(ABC, results, settings());
    expect(ident.identified).toBe(false);
    expect(ident.website).toBeNull();
  });

  it("never takes a directory or social site as the official website", () => {
    const results = [
      result("ABC Roofing | Facebook", "https://www.facebook.com/abcroofing", "ABC Roofing, Portland, Oregon"),
      result("ABC Roofing - BBB", "https://www.bbb.org/us/or/portland/abc-roofing", "ABC Roofing Portland, OR"),
    ];
    const ident = identifyCompany(ABC, results, settings());
    expect(ident.identified).toBe(true);
    expect(ident.website).toBeNull(); // known via listings, but no website claimed
  });

  it("flags two similar websites as ambiguous", () => {
    const company = makeCompany({ city: "", state: "" });
    const results = [result("ABC Roofing", "https://abcroofing.com/", "ABC Roofing"), result("ABC Roofing", "https://abcroofing.net/", "ABC Roofing")];
    expect(identifyCompany(company, results, settings()).ambiguous).toBe(true);
  });

  it("classifies sources", () => {
    expect(classifySource("https://www.abcroofing.com/about", OFFICIAL)).toBe("official_website");
    expect(classifySource("https://sos.oregon.gov/business/x")).toBe("government_registry");
    expect(classifySource("https://www.linkedin.com/in/john-smith")).toBe("professional_profile");
    expect(classifySource("https://www.yelp.com/biz/abc")).toBe("reputable_directory");
    expect(classifySource("https://www.bizjournals.com/portland/x")).toBe("news");
    expect(classifySource("https://randomblog.net/post")).toBe("search_snippet");
    expect(classifySource("https://www.spokeo.com/John-Smith")).toBe("blocked");
  });
});

// ------------------------------------------------------------------ extraction
describe("extraction", () => {
  const people = (text: string) => new Set(extractPeople(text, "ABC Roofing", ["Portland", "Oregon"]).map((p) => `${p.name}|${p.title}|${p.roleClass}`));

  it("recognises the person patterns", () => {
    expect(people("John Smith, Founder of ABC Roofing")).toContain("John Smith|Founder|owner");
    expect(people("Owner: John Smith")).toContain("John Smith|Owner|owner");
    expect(people("Mary O'Brien — Founder & CEO")).toContain("Mary O'Brien|Founder & CEO|owner");
    expect(people("ABC Roofing is owned by John Smith of Portland")).toContain("John Smith|Owner|owner");
    expect(people("Sarah Johnson is the General Manager")).toContain("Sarah Johnson|General Manager|decision_maker");
    expect(people("Vice President Tom Jones spoke").size).toBe(0);
    expect(people("ABC Roofing Portland - Owner operated since 1990").size).toBe(0);
    expect(people("Jane Doe, CEO of Totally Different Corp").size).toBe(0);
  });

  it("extracts phones and emails", () => {
    expect(extractPhones("Call (503) 555-0142 or +27 11 555 0142 or 011 555 0199. Est. 1999-2024").map((p) => p[0])).toEqual(["(503) 555-0142", "+27 11 555 0142", "011 555 0199"]);
    expect(extractEmails("Mail info@abcroofing.com. logo@2x.png you@example.com").map((e) => e[0])).toEqual(["info@abcroofing.com"]);
  });
});

// ---------------------------------------------------------------- owner research
describe("owner research", () => {
  it("finds the owner", () => {
    const found = collectPeople(
      docs([
        result("About - ABC Roofing", "https://abcroofing.com/about", "John Smith, Founder of ABC Roofing."),
        result("ABC Roofing - BBB", "https://www.bbb.org/abc", "ABC Roofing, Portland, OR. Owner: John A. Smith"),
      ]),
      ABC,
      settings(),
    );
    const decision = decideOwner(found, settings());
    expect(decision.status).toBe(VERIFIED);
    expect(decision.owner!.value).toBe("John Smith");
    expect(decision.owner!.detail).toBe("Founder");
    expect(decision.owner!.best!.sourceType).toBe("official_website");
    expect(decision.owner!.confidence).toBe(99); // official site + independent directory agree
  });

  it("reports no owner when none is named", () => {
    const decision = decideOwner(collectPeople(docs([result("ABC Roofing", "https://abcroofing.com/", "Quality roofing in Portland since 1990.")]), ABC, settings()), settings());
    expect(decision.status).toBe(NOT_FOUND);
    expect(decision.owner).toBeNull();
  });

  it("does not auto-resolve conflicting owners", () => {
    const found = collectPeople(
      docs([
        result("About - ABC Roofing", "https://abcroofing.com/about", "John Smith, Founder of ABC Roofing."),
        result("ABC Roofing - Yelp", "https://www.yelp.com/biz/abc", "ABC Roofing, Portland, OR. Owner: Michael Brown"),
      ]),
      ABC,
      settings(),
    );
    const decision = decideOwner(found, settings());
    expect(decision.status).toBe(CONFLICT);
    expect(decision.owner).toBeNull();
    expect(new Set(decision.candidates.map((c) => c.value))).toEqual(new Set(["John Smith", "Michael Brown"]));
  });

  it("does not accept a weak snippet alone as the owner", () => {
    const decision = decideOwner(collectPeople(docs([result("Roofers blog", "https://randomblog.net/p", "ABC Roofing Portland Oregon owner Bob Jones said...")]), ABC, settings()), settings());
    expect(decision.owner).toBeNull();
    expect(decision.status).toBe("UNCERTAIN");
  });

  it("treats a manager as a decision maker, not an owner", () => {
    const found = collectPeople(docs([result("Team - ABC Roofing", "https://abcroofing.com/team", "Sarah Johnson - General Manager. Tom Reed - Sales Manager.")]), ABC, settings());
    expect(decideOwner(found, settings()).status).toBe(NOT_FOUND);
    const dm = decideDecisionMaker(found, settings())!;
    expect(dm.value).toBe("Sarah Johnson");
    expect(dm.detail).toBe("General Manager"); // outranks Sales Manager
  });

  it("ignores the owner of a different company", () => {
    const found = collectPeople(docs([result("ABC Roofing of Texas", "https://abcroofingtx.com/", "ABC Roofing, Houston, Texas. Owner: Pat Wrongman")]), ABC, settings());
    expect(found.size).toBe(0);
  });
});

// -------------------------------------------------------------- contact research
const CONTACT = [
  result("ABC Roofing", "https://abcroofing.com/", "ABC Roofing, Portland, OR. Call (503) 555-0142. info@abcroofing.com"),
  result("Contact - ABC Roofing", "https://abcroofing.com/contact", "Main office (503) 555-0142, info@abcroofing.com. John Smith (Founder) direct: (503) 555-0143, john@abcroofing.com"),
];

describe("contact research", () => {
  it("finds phones", () => {
    const business = findBusinessPhone(docs(CONTACT), settings())!;
    expect(business.value).toBe("(503) 555-0142");
    const ownerPhone = findPersonPhone(docs(CONTACT), "John Smith", settings(), business.value)!;
    expect(ownerPhone.value).toBe("(503) 555-0143");
    expect(ownerPhone.status).toBe(VERIFIED);
  });

  it("does not report the main line as the owner's phone", () => {
    const onlyMain = [result("About - ABC Roofing", "https://abcroofing.com/about", "John Smith, Founder. Call us on (503) 555-0142.")];
    expect(findPersonPhone(docs(onlyMain), "John Smith", settings(), "(503) 555-0142")).toBeNull();
  });

  it("finds emails", () => {
    const ownerEmail = findPersonEmail(docs(CONTACT), "John Smith", settings(), OFFICIAL)!;
    expect(ownerEmail.value).toBe("john@abcroofing.com");
    expect(findCompanyEmail(docs(CONTACT), settings(), OFFICIAL, [ownerEmail.value])!.value).toBe("info@abcroofing.com");
  });

  it("finds nothing and invents nothing", () => {
    const bare = docs([result("About - ABC Roofing", "https://abcroofing.com/about", "John Smith, Founder of ABC Roofing.")]);
    expect(findPersonPhone(bare, "John Smith", settings())).toBeNull();
    expect(findPersonEmail(bare, "John Smith", settings(), OFFICIAL)).toBeNull(); // no john@abcroofing.com guess
    expect(findCompanyEmail(bare, settings(), OFFICIAL)).toBeNull();
    expect(findBusinessPhone(bare, settings())).toBeNull();
  });

  it("never uses private-data sites", () => {
    const shady = docs([result("John Smith - Spokeo", "https://www.spokeo.com/John-Smith", "John Smith ABC Roofing Portland Oregon (503) 555-0177 johnsmith@gmail.com")]);
    expect(findPersonPhone(shady, "John Smith", settings())).toBeNull();
    expect(findPersonEmail(shady, "John Smith", settings(), OFFICIAL)).toBeNull();
  });
});

// ------------------------------------------------------------------- full engine
const FULL = {
  name: "ABC Roofing",
  owner: { name: "John Smith", title: "Founder", phone: "(555) 555-0143", email: "john@abc-roofing.example" },
  phone: "(555) 555-0142",
  email: "info@abc-roofing.example",
};

describe("research engine", () => {
  it("runs the full workflow", async () => {
    const { db } = await makeDb();
    const company = await research(db, FULL);
    expect(company.research_status).toBe(COMPLETED);
    expect(company.verification_status).toBe(VERIFIED);
    expect(company.website).toBe("https://abc-roofing.example/");
    expect([company.owner_name, company.owner_title]).toEqual(["John Smith", "Founder"]);
    expect([company.owner_phone, company.owner_email]).toEqual(["(555) 555-0143", "john@abc-roofing.example"]);
    expect([company.business_phone, company.company_email]).toEqual(["(555) 555-0142", "info@abc-roofing.example"]);
    expect(company.field_confidence!.owner.status).toBe(VERIFIED);
    // demo data is always labelled
    expect(company.is_demo).toBe(true);
    expect(company.notes!.startsWith("DEMO DATA")).toBe(true);
    expect(company.source!.startsWith("DEMO DATA")).toBe(true);
    expect((await db.query("SELECT 1 FROM cr_search_results WHERE provider = 'mock' LIMIT 1")).length).toBe(1);
    const [ownerEvidence] = await db.query<Evidence>("SELECT * FROM cr_evidence WHERE field = 'owner' LIMIT 1");
    expect(ownerEvidence.source_url && ownerEvidence.snippet).toBeTruthy(); // every value has a source
    expect((await db.query<ResearchLog>("SELECT * FROM cr_research_logs WHERE query IS NOT NULL LIMIT 1")).length).toBe(1);
  });

  it("does not pick the similarly named business", async () => {
    const { db } = await makeDb();
    const company = await research(db, FULL);
    expect(company.website).not.toContain("supplies");
    expect(company.owner_name).not.toBe("Pat Wrongman");
    expect(company.business_phone).not.toBe("(555) 555-0199");
  });

  it("sends a conflict to review", async () => {
    const { db } = await makeDb();
    const company = await research(db, { ...FULL, conflict_owner: { name: "Michael Brown", title: "Owner" } });
    expect(company.owner_name).toBeNull();
    expect(company.verification_status).toBe(CONFLICT);
    expect(company.research_status).toBe(NEEDS_REVIEW);
    const items = await db.query<ReviewItem>("SELECT * FROM cr_review_queue WHERE field = 'owner'");
    expect(items).toHaveLength(1);
    expect(new Set(items[0].conflicting_information!.map((c) => c.value))).toEqual(new Set(["John Smith", "Michael Brown"]));
  });

  it("falls back to a decision maker", async () => {
    const { db } = await makeDb();
    const company = await research(db, {
      name: "ABC Roofing",
      decision_maker: { name: "Sarah Johnson", title: "General Manager", phone: "(555) 555-0150", email: "sarah@abc-roofing.example" },
    });
    expect(company.owner_name).toBeNull(); // never promoted to "owner"
    expect([company.decision_maker_name, company.decision_maker_title]).toEqual(["Sarah Johnson", "General Manager"]);
    expect(company.decision_maker_email).toBe("sarah@abc-roofing.example");
    expect(company.company_email).toBe("info@abc-roofing.example");
    expect(company.notes).toContain("Owner not found");
  });

  it("reports a company that cannot be found", async () => {
    const { db } = await makeDb();
    const company = await research(db, null, { name: "Ghost Company" });
    expect(company.verification_status).toBe(NOT_FOUND);
    expect(company.confidence).toBeNull();
    expect(company.website ?? company.owner_name ?? company.company_email).toBeNull();
    expect(company.is_demo).toBe(true);
    expect(company.notes!.startsWith("DEMO DATA")).toBe(true); // a simulated "not found" is labelled too
  });

  it("respects the query limit", async () => {
    const { db } = await makeDb();
    const s = settings();
    s.max_queries_per_company = 3;
    await research(db, { name: "ABC Roofing" }, { settings: s }); // no people: engine wants more queries
    const logs = await db.query<ResearchLog>("SELECT * FROM cr_research_logs");
    expect(new Set(logs.filter((l) => l.query).map((l) => l.query)).size).toBe(3);
    expect(logs.some((l) => l.status === "limit")).toBe(true);
  });

  it("marks the company FAILED when every provider fails", async () => {
    const { db } = await makeDb();
    const down = scriptedProvider("down", () => {
      throw new AllProvidersFailed("all providers down");
    });
    const row = await insertCompany(db, { company_name: "ABC Roofing" });
    const company = await new ResearchEngine(db, down, settings()).researchCompany(row.id);
    expect(company.research_status).toBe(FAILED);
    expect(company.notes).toContain("unavailable");
  });

  it("keeps an otherwise successful research when one query is flaky", async () => {
    const { db } = await makeDb();
    const flaky = scriptedProvider("flaky", (query) => {
      if (["owner", "founder", "ceo", "president", "director", "manager", "site:"].some((w) => query.toLowerCase().includes(w))) throw new AllProvidersFailed(`flaky: timed out on '${query}'`);
      return [searchResult({ title: "ABC Roofing | Portland, Oregon", url: "https://abcroofing.com/", snippet: "Roofing in Portland, Oregon.", source: "flaky" })];
    });
    const row = await insertCompany(db, { company_name: "ABC Roofing", city: "Portland", state: "Oregon" });
    const company = await new ResearchEngine(db, flaky, settings()).researchCompany(row.id);
    expect(company.research_status).not.toBe(FAILED);
    expect(company.website).toBe("https://abcroofing.com/"); // earlier success was kept
    expect(company.notes).toContain("repeated timeouts"); // but the problem is surfaced
  });

  it("gives later stages a fresh chance once a provider outage clears", async () => {
    const { db } = await makeDb();
    let ownerFailures = 0;
    const recovering = scriptedProvider("recovering", (query) => {
      const ql = query.toLowerCase();
      if (ql.includes("owner") || ql.includes("founder")) {
        if (ownerFailures < 3) {
          ownerFailures++;
          throw new AllProvidersFailed(`recovering: timed out on '${query}'`);
        }
        return []; // the outage cleared, but this company genuinely has no owner listed
      }
      return [
        searchResult({
          title: "ABC Roofing | Portland, Oregon",
          url: "https://abcroofing.com/",
          snippet: "ABC Roofing, Portland, Oregon. Sarah Johnson - General Manager. Call (503) 555-0142 or email info@abcroofing.com.",
          source: "recovering",
        }),
      ];
    });
    const row = await insertCompany(db, { company_name: "ABC Roofing", city: "Portland", state: "Oregon" });
    // a cooldown already "in the past" the moment it is set, so the next query gets a fresh attempt
    const company = await new ResearchEngine(db, recovering, settings(), { failureCooldown: -1 }).researchCompany(row.id);
    expect(company.research_status).not.toBe(FAILED);
    expect(company.decision_maker_name).toBe("Sarah Johnson"); // a later stage got a fresh attempt
    expect(company.business_phone).toBe("(503) 555-0142");
    expect(company.company_email).toBe("info@abcroofing.com");
    expect(company.notes).toContain("repeated timeouts"); // the outage is still disclosed
  });
});
