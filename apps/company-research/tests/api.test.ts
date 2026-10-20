/** End-to-end through the HTTP API in Demo Mode (no API keys): research, review, edit, export, email features. */
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { makeDb } from "./helpers";

const KEYS = ["GOOGLE_API_KEY", "GOOGLE_SEARCH_ENGINE_ID", "BING_API_KEY", "SERPAPI_KEY", "BRAVE_API_KEY", "HUNTER_API_KEY", "EMAIL_VERIFICATION_API_KEY"];
for (const k of KEYS) delete process.env[k];

let base = "";
let close: () => void = () => undefined;

beforeAll(async () => {
  const { db, config } = await makeDb();
  const app = await createApp({ db, config, userOf: () => "tester@zawadie.com" });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) } as { status: number; body: any };
};
const get = (path: string) => call("GET", path);
const post = (path: string, body: unknown = {}) => call("POST", path, body);
const upload = async (path: string, name: string, text: string) => {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/csv" }), name);
  const res = await fetch(base + path, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
};

async function waitIdle(path: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await get(path)).body;
    if (status.state === "idle") return status;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("job did not finish");
}

async function sheetOf(content: Buffer, name: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  return workbook.getWorksheet(name)!;
}

describe("company research API", () => {
  it("reports who the hub signed in", async () => {
    expect((await get("/api/session")).body).toEqual({ hub_user: "tester@zawadie.com" });
  });

  it("runs the full demo flow", async () => {
    const settings = (await get("/api/settings")).body;
    expect(settings.demo_mode).toBe(true);
    expect(settings.active_chain).toEqual(["mock"]);

    // manual entry + duplicate rejection
    const created = (await post("/api/companies", { company_name: "ABC Roofing", city: "Portland", state: "Oregon" })).body;
    expect(created.created).toBe(true);
    const again = (await post("/api/companies", { company_name: "abc roofing", city: "Portland", state: "OR" })).body;
    expect(again.created).toBe(false);
    expect(again.duplicate_of).toBe(created.company.id);

    // CSV upload; "Evergreen Painting" is a simulated conflicting-owner case
    const imported = await upload("/api/import", "companies.csv", "Company Name,City,State\nEvergreen Painting,Portland,Oregon\nSmith Plumbing,Salem,Oregon\n");
    expect(imported.body.imported).toBe(2);

    expect((await post("/api/research/start", {})).body.total).toBe(3);
    expect((await waitIdle("/api/research/status")).completed).toBe(3);

    const dashboard = (await get("/api/dashboard")).body;
    expect([dashboard.total, dashboard.demo_records]).toEqual([3, 3]);
    expect(dashboard.owner_found).toBeGreaterThanOrEqual(2);

    const abc = (await get(`/api/companies/${created.company.id}`)).body;
    expect(abc.company.owner_name).toBe("John Smith");
    expect(abc.company.is_demo).toBe(true);
    expect(abc.search_results.length && abc.evidence.length && abc.logs.length).toBeTruthy();

    // human review: choose one of the conflicting owners
    const conflict = (await get("/api/review")).body.find((r: any) => r.field === "owner");
    expect(conflict.conflicting_information).toHaveLength(2);
    const chosen = conflict.conflicting_information[0].value;
    expect((await post(`/api/review/${conflict.id}/resolve`, { action: "choose", candidate_index: 0 })).body.status).toBe("RESOLVED");
    const company = (await get(`/api/companies/${conflict.company_id}`)).body.company;
    expect(company.owner_name).toBe(chosen);
    expect(company.research_status).toBe("COMPLETED");
    expect(company.verification_status).not.toBe("CONFLICT");

    // manual edit is saved
    expect((await call("PUT", `/api/companies/${company.id}`, { owner_phone: "(555) 555-0101" })).body.owner_phone).toBe("(555) 555-0101");

    // export and download
    const exported = (await post("/api/exports", { scope: "all" })).body;
    expect(exported.rows).toBe(3);
    const download = await get(`/api/exports/${exported.filename}`);
    expect(download.status).toBe(200);
    const sheet = await sheetOf(download.body, "Companies");
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell("A1").value).toBe("Company Name");
    expect((await get("/api/exports/..%2F..%2F.env")).status).toBe(404);
  });

  it("saves and validates settings", async () => {
    const current = (await get("/api/settings")).body;
    const payload = { settings: { ...current.settings, max_queries_per_company: 12, request_delay_seconds: 2 }, providers: { default_provider: "mock", secondary_provider: null, enabled: { brave: true } } };
    const saved = (await call("PUT", "/api/settings", payload)).body;
    expect(saved.settings.max_queries_per_company).toBe(12);
    expect(saved.default_provider).toBe("mock");
    expect(saved.providers.find((p: any) => p.name === "brave").enabled).toBe(true);

    payload.providers.default_provider = "altavista";
    expect((await call("PUT", "/api/settings", payload)).status).toBe(422);
    expect((await call("PUT", "/api/settings/keys", { keys: { PATH: "x" } })).status).toBe(422);
  });

  it("answers unknown API paths with a 404 detail", async () => {
    expect(await get("/api/nope")).toEqual({ status: 404, body: { detail: "Not Found" } });
  });
});

describe("email API", () => {
  it("reports missing keys and safe fallbacks", async () => {
    const data = (await get("/api/email/providers")).body;
    const hunter = data.discovery.find((p: any) => p.name === "hunter");
    expect(hunter.configured).toBe(false);
    expect(hunter.required_env).toEqual(["HUNTER_API_KEY"]);
    expect(data.verification.find((p: any) => p.name === "builtin").configured).toBe(true); // always available, no key needed
    expect([data.active_discovery, data.active_discovery_demo, data.active_verification]).toEqual(["mock", true, "builtin"]);
  });

  it("runs a single domain search", async () => {
    const r = await post("/api/email/domain-search", { domain: "acme-test.example", company_name: "Acme Test" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(1);
    expect(r.body.every((row: any) => row.domain === "acme-test.example" && row.is_demo && row.email.includes("@acme-test.example"))).toBe(true);
  });

  it("finds by company", async () => {
    const r = await post("/api/email/find-by-company", { company_name: "Acme Test Co" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(1);
  });

  it("finds by name", async () => {
    const r = await post("/api/email/find-by-name", { first_name: "Jane", last_name: "Doe", company_name: "Acme Test Co" });
    expect(r.status).toBe(200);
    for (const row of r.body) expect(["VERIFIED", "LIKELY", "UNCERTAIN", "NOT_FOUND", "NEEDS_REVIEW"]).toContain(row.status);
  });

  it("verifies with the real built-in checks", async () => {
    const r = await post("/api/email/verify", { email: "contact@example.com" });
    expect(r.status).toBe(200);
    expect([r.body.provider, r.body.is_demo, r.body.syntax_check]).toEqual(["builtin", false, "passed"]);
    expect(["Role-Based", "Unknown", "Invalid"]).toContain(r.body.status); // never "Valid" without a mailbox check
    const bad = (await post("/api/email/verify", { email: "not-an-email" })).body;
    expect([bad.status, bad.syntax_check]).toEqual(["Invalid", "failed"]);
  });

  it("parses an upload's headers and rows", async () => {
    const r = await upload("/api/email/upload", "list.csv", "First Name,Last Name,Company\nJohn,Smith,Acme\nJane,Doe,Acme\n");
    expect(r.status).toBe(200);
    expect(r.body.headers).toEqual(["First Name", "Last Name", "Company"]);
    expect(r.body.rows).toEqual([["John", "Smith", "Acme"], ["Jane", "Doe", "Acme"]]);
  });

  it("dedupes a bulk verify and completes it", async () => {
    const r = await post("/api/email/jobs/start", { kind: "verify", items: [{ email: "dup@example.com" }, { email: "DUP@example.com" }, { email: "unique@example.com" }] });
    expect(r.status).toBe(200);
    expect([r.body.total, r.body.deduplicated]).toEqual([2, 1]);
    const final = await waitIdle("/api/email/jobs/status");
    expect([final.completed, final.failed]).toEqual([2, 0]);
  });

  it("pauses, resumes and stops a bulk job", async () => {
    await post("/api/email/jobs/start", { kind: "verify", items: Array.from({ length: 6 }, (_, i) => ({ email: `bulk${i}@example.com` })) });
    await post("/api/email/jobs/pause");
    expect(["paused", "idle"]).toContain((await get("/api/email/jobs/status")).body.state);
    await post("/api/email/jobs/resume");
    await post("/api/email/jobs/stop");
    expect((await waitIdle("/api/email/jobs/status")).state).toBe("idle");
  });

  it("lists and deletes results", async () => {
    const discovered = (await get("/api/email/discovered")).body;
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    const id = discovered[0].id;
    expect((await call("DELETE", `/api/email/discovered/${id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/email/discovered/${id}`)).status).toBe(404);
    expect((await get("/api/email/verifications")).body.length).toBeGreaterThanOrEqual(1);
  });

  it("exports discovered emails with the documented columns", async () => {
    const exported = await post("/api/email/exports/discovered", { scope: "all", include_demo: true });
    expect(exported.status).toBe(200);
    const { filename } = exported.body;
    const download = await get(`/api/email/exports/discovered/${filename}`);
    expect(download.status).toBe(200);
    const sheet = await sheetOf(download.body, "Discovered Emails");
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Company Name", "Domain", "Email Address", "Contact Name", "Job Title", "Department", "Email Type", "Source URL", "Verification Status", "Confidence", "Discovery Provider", "Research Date",
    ]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect((await call("DELETE", `/api/email/exports/discovered/${filename}`)).status).toBe(200);
    expect((await get(`/api/email/exports/discovered/${filename}`)).status).toBe(404);
  });

  it("exports verification results with the documented columns", async () => {
    const { filename } = (await post("/api/email/exports/verifications", { scope: "all", include_demo: true })).body;
    const sheet = await sheetOf((await get(`/api/email/exports/verifications/${filename}`)).body, "Email Verification");
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Input Email", "Email Address", "Overall Status", "Syntax Check", "Domain Check", "MX Check", "Mailbox Check", "Disposable Status", "Role-Based Status", "Catch-All Status", "Provider", "Verification Date", "Error / Explanation",
    ]);
    await call("DELETE", `/api/email/exports/verifications/${filename}`);
  });

  it("rejects path traversal and empty jobs", async () => {
    expect((await get("/api/email/exports/discovered/..%2F..%2F.env")).status).toBe(404);
    expect((await post("/api/email/jobs/start", { kind: "verify", items: [] })).status).toBe(422); // schema enforces at least one item
  });
});
