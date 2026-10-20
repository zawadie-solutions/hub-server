/** Deduplication, import, Excel export and the background research job. */
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportDir } from "../src/config";
import type { Db } from "../src/db/db";
import { insertCompany } from "../src/db/repo";
import { exportCompanies, HEADERS } from "../src/exporter";
import { importFile, parseCompanies } from "../src/importer";
import { type Company, COMPLETED, NEEDS_REVIEW, PENDING } from "../src/models";
import { MockProvider } from "../src/providers/mock";
import { findDuplicate } from "../src/research/deduplication";
import { JobManager } from "../src/research/jobManager";
import { makeDb } from "./helpers";

const SPEC_COLUMNS = [
  "Company Name", "Website", "Address", "City", "State", "Country", "Business Phone", "Company Email", "Owner Name", "Owner Title", "Owner Phone", "Owner Email",
  "Decision Maker Name", "Decision Maker Title", "Decision Maker Phone", "Decision Maker Email", "Source", "Source URL", "Confidence", "Verification Status",
  "Research Status", "Notes", "Date Researched",
];

async function xlsxBytes(rows: (string | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("deduplication", () => {
  it("detects a duplicate company", async () => {
    const { db } = await makeDb();
    await insertCompany(db, { company_name: "ABC Roofing, LLC", city: "Portland", state: "OR", website: "https://www.abcroofing.com/", business_phone: "(503) 555-0142" });
    expect((await findDuplicate(db, { companyName: "abc roofing", city: "Portland", state: "Oregon" }))![1]).toBe("same company name and location");
    expect((await findDuplicate(db, { companyName: "ABC Roofing" }))![1]).toBe("same company name and location");
    expect((await findDuplicate(db, { companyName: "Other Name", website: "http://abcroofing.com/contact" }))![1]).toBe("same website");
    expect((await findDuplicate(db, { companyName: "Other Name", phone: "+1 503.555.0142" }))![1]).toBe("same business phone");
  });

  it("keeps different companies separate", async () => {
    const { db } = await makeDb();
    await insertCompany(db, { company_name: "ABC Roofing", city: "Portland", state: "Oregon" });
    expect(await findDuplicate(db, { companyName: "ABC Roofing", city: "Austin", state: "Texas" })).toBeNull(); // same name, other place
    expect(await findDuplicate(db, { companyName: "ABC Plumbing", city: "Portland", state: "Oregon" })).toBeNull();
  });
});

describe("import", () => {
  it("imports Excel and skips duplicates", async () => {
    const { db } = await makeDb();
    const content = await xlsxBytes([["Company Name", "City", "State"], ["ABC Roofing", "Portland", "Oregon"], ["Smith Plumbing", "Salem", "Oregon"], ["abc roofing llc", "Portland", "OR"], [null, null, null]]);
    const summary = await importFile(db, "companies.xlsx", content);
    expect(summary.rows).toBe(3);
    expect(summary.imported).toBe(2);
    expect(summary.duplicates[0].company_name).toBe("abc roofing llc");
    expect((await db.query<Company>("SELECT * FROM cr_companies ORDER BY id")).map((c) => c.research_status)).toEqual([PENDING, PENDING]);
  });

  it("reads CSV with and without a header", async () => {
    expect(await parseCompanies("list.csv", Buffer.from("Business;Town;Province\nXYZ Construction;Eugene;Oregon\n"))).toEqual([{ company_name: "XYZ Construction", city: "Eugene", state: "Oregon" }]);
    expect(await parseCompanies("names.csv", Buffer.from("ABC Roofing\nSmith Plumbing\n"))).toEqual([{ company_name: "ABC Roofing" }, { company_name: "Smith Plumbing" }]);
  });
});

describe("Excel export", () => {
  it("has the columns, rows and formatting", async () => {
    expect(HEADERS).toEqual(SPEC_COLUMNS);
    const base = { created_at: new Date(), updated_at: new Date(), queued: false } as Partial<Company>;
    const company = (c: Partial<Company>) => ({ ...base, ...c }) as Company;
    const companies = [
      company({
        company_name: "ABC Roofing", website: "https://abcroofing.com/", city: "Portland", business_phone: "011 555 0142", company_email: "info@abcroofing.com",
        owner_name: "John Smith", owner_title: "Founder", owner_email: "john@abcroofing.com", confidence: 96.0, verification_status: "VERIFIED",
        research_status: COMPLETED, date_researched: new Date(Date.UTC(2026, 0, 2, 3, 4)), is_demo: false,
      }),
      company({ company_name: "XYZ Plumbing", confidence: null, verification_status: "CONFLICT", research_status: NEEDS_REVIEW, is_demo: true, notes: "DEMO DATA" }),
      company({ company_name: "Waiting Co", research_status: PENDING, is_demo: false }),
    ];
    const file = path.join(exportDir(), "out.xlsx");
    await exportCompanies(companies, file);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet("Companies")!;

    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(SPEC_COLUMNS);
    expect(sheet.rowCount).toBe(4);
    const col = Object.fromEntries(SPEC_COLUMNS.map((name, i) => [name, i + 1]));
    expect(sheet.getCell(2, col["Owner Name"]).value).toBe("John Smith");

    // formatting
    expect(SPEC_COLUMNS.every((_, i) => sheet.getCell(1, i + 1).font?.bold)).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:W4");
    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(20);
    const confidence = sheet.getCell(2, col.Confidence);
    expect(confidence.value).toBe(0.96);
    expect(confidence.numFmt).toBe("0%");
    const phone = sheet.getCell(2, col["Business Phone"]);
    expect(phone.value).toBe("011 555 0142"); // leading zero kept
    expect(phone.numFmt).toBe("@");
    expect((sheet.getCell(2, col["Owner Email"]).value as ExcelJS.CellHyperlinkValue).hyperlink).toBe("mailto:john@abcroofing.com");
    expect(((sheet.getCell(2, col["Verification Status"]).fill as ExcelJS.FillPattern).fgColor!.argb ?? "").endsWith("C6EFCE")).toBe(true);
    expect(((sheet.getCell(3, col["Verification Status"]).fill as ExcelJS.FillPattern).fgColor!.argb ?? "").endsWith("F8CBAD")).toBe(true);

    // researched but nothing found -> "Not Found"; not yet researched -> blank
    expect(sheet.getCell(3, col["Owner Name"]).value).toBe("Not Found");
    expect(sheet.getCell(4, col["Owner Name"]).value).toBeNull();
    expect(String(workbook.getWorksheet("Info")!.getCell("B2").value)).toContain("DEMO DATA");
  });
});

// -------------------------------------------------------------- background job
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeJobs() {
  const { db, config } = await makeDb();
  return { db, jobs: new JobManager(db, config, async () => [[new MockProvider()], true]) };
}

async function addCompanies(db: Db, count: number) {
  for (let i = 0; i < count; i++) await insertCompany(db, { company_name: `Demo Firm ${i}`, city: "Salem", state: "Oregon" });
}

describe("background research job", () => {
  it("researches every pending company", async () => {
    const { db, jobs } = await makeJobs();
    await addCompanies(db, 4);
    expect((await jobs.start()).total).toBe(4);
    await jobs.wait();
    const final = jobs.status();
    expect(final.state).toBe("idle");
    expect(final.completed).toBe(4);
    expect(final.demo_mode).toBe(true);
    const companies = await db.query<Company>("SELECT * FROM cr_companies");
    expect(companies.every((c) => c.research_status === COMPLETED || c.research_status === NEEDS_REVIEW)).toBe(true);
    expect(companies.every((c) => c.is_demo && !c.queued)).toBe(true);
  });

  it("pauses, resumes and stops", async () => {
    const { db, jobs } = await makeJobs();
    await addCompanies(db, 12);
    await jobs.start();
    expect((await jobs.pause()).state).toBe("paused");
    await sleep(600);
    const frozen = jobs.status().completed;
    await sleep(400);
    expect(jobs.status().completed).toBe(frozen); // nothing moves while paused
    expect(frozen).toBeLessThan(12);
    expect((await jobs.resume()).state).toBe("running");
    await jobs.stop();
    await jobs.wait();
    expect(jobs.status().state).toBe("idle");
    const statuses = (await db.query<Company>("SELECT * FROM cr_companies")).map((c) => c.research_status);
    expect(statuses).not.toContain("RESEARCHING"); // finished ones saved, the rest back to PENDING
    expect(statuses.every((s) => [COMPLETED, NEEDS_REVIEW, PENDING].includes(s))).toBe(true);
  });

  it("restores an unfinished job after a restart", async () => {
    const { db, jobs } = await makeJobs();
    await addCompanies(db, 3);
    const [a, b, c] = await db.query<Company>("SELECT * FROM cr_companies ORDER BY id");
    await db.execute("UPDATE cr_companies SET research_status = ? WHERE id = ?", [COMPLETED, a.id]); // finished before the "crash"
    await db.execute("UPDATE cr_companies SET research_status = 'RESEARCHING', queued = 1 WHERE id = ?", [b.id]);
    await db.execute("UPDATE cr_companies SET queued = 1 WHERE id = ?", [c.id]);
    await jobs.recover();
    const status = jobs.status();
    expect([status.state, status.restored, status.total]).toEqual(["paused", true, 2]);
    await jobs.resume();
    await jobs.wait();
    expect(jobs.status().completed).toBe(2);
    expect((await db.query<Company>("SELECT * FROM cr_companies")).some((x) => x.research_status === PENDING)).toBe(false);
  });
});
