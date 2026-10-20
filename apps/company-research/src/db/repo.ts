/** Row-level helpers shared by the API, the research engine and the email features. */
import { type Company, COMPANY_FIELDS } from "../models";
import { clip, type Db, json } from "./db";

/** Columns stored as JSON (written as text, read back already parsed). */
const JSON_COLUMNS = new Set(["field_confidence", "conflicting_information", "pending_items", "provider_raw", "input_row"]);

/** Width limits from schema.sql for columns that hold free text from the web or the user. */
const WIDTHS: Record<string, number> = {
  company_name: 300, city: 255, state: 255, country: 255, website: 1000, business_phone: 100, owner_phone: 100,
  decision_maker_phone: 100, company_email: 320, owner_email: 320, decision_maker_email: 320, owner_name: 300,
  owner_title: 300, decision_maker_name: 300, decision_maker_title: 300, source: 500, provider_used: 255,
  step: 60, field: 60, detail: 300, source_type: 40, provider: 50, domain: 255, email: 320, first_name: 100,
  last_name: 100, full_name: 200, title: 300, department: 120, discovery_provider: 50,
};

function toColumn(name: string, value: unknown): unknown {
  if (JSON_COLUMNS.has(name)) return json(value);
  if (typeof value === "string" && WIDTHS[name]) return clip(value, WIDTHS[name]);
  return value === undefined ? null : value;
}

export async function insertRow(db: Db, table: string, row: Record<string, unknown>): Promise<number> {
  const names = Object.keys(row);
  const { insertId } = await db.execute(
    `INSERT INTO ${table} (${names.map((n) => `\`${n}\``).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    names.map((n) => toColumn(n, row[n])),
  );
  return insertId;
}

export async function updateRow(db: Db, table: string, id: number, changes: Record<string, unknown>): Promise<void> {
  const names = Object.keys(changes);
  if (!names.length) return;
  await db.execute(`UPDATE ${table} SET ${names.map((n) => `\`${n}\` = ?`).join(", ")} WHERE id = ?`, [...names.map((n) => toColumn(n, changes[n])), id]);
}

// ---------------------------------------------------------------------------- companies
export async function getCompany(db: Db, id: number): Promise<Company | null> {
  const rows = await db.query<Company>("SELECT * FROM cr_companies WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function insertCompany(db: Db, fields: Partial<Company> & { company_name: string }): Promise<Company> {
  const now = new Date();
  const id = await insertRow(db, "cr_companies", { research_status: "PENDING", is_demo: false, queued: false, ...fields, created_at: now, updated_at: now });
  return (await getCompany(db, id))!;
}

/** Writes every editable column of an in-memory company back (the ORM-style "flush"). */
export async function saveCompany(db: Db, company: Company): Promise<void> {
  company.updated_at = new Date();
  const changes: Record<string, unknown> = { updated_at: company.updated_at };
  for (const field of COMPANY_FIELDS) changes[field] = company[field];
  await updateRow(db, "cr_companies", company.id, changes);
}

export const allCompanies = (db: Db) => db.query<Company>("SELECT * FROM cr_companies ORDER BY id");

/** Placeholders for `IN (...)` (mysql2 expands an array into a list). */
export const inList = (values: unknown[]) => (values.length ? values : [null]);
