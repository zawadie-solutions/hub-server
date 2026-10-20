/** Import company lists from Excel (.xlsx) or CSV, and parse generic tables for the email features. */
import ExcelJS from "exceljs";
import type { Db } from "./db/db";
import { insertCompany } from "./db/repo";
import type { Company } from "./models";
import { findDuplicate } from "./research/deduplication";
import { cleanText, normalizeText } from "./utils/normalization";

const HEADER_ALIASES: Record<string, Set<string>> = {
  company_name: new Set(["company name", "company", "name", "business name", "business", "organization", "organisation", "account name"]),
  city: new Set(["city", "town"]),
  state: new Set(["state", "province", "region", "state province"]),
  country: new Set(["country"]),
  website: new Set(["website", "url", "web", "domain", "site"]),
  business_phone: new Set(["phone", "business phone", "telephone", "phone number"]),
  address: new Set(["address", "street address", "street"]),
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""); // like Python's str(datetime)
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("error" in value) return String(value.error);
  }
  return String(value);
}

/** Splits CSV text, honouring quotes, with the delimiter that best fits the first lines. */
function parseCsv(text: string): string[][] {
  const sample = text.slice(0, 2000).split(/\r?\n/).filter((l) => l.trim());
  let delimiter = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t"]) {
    const counts = sample.map((line) => line.split(d).length - 1);
    // a delimiter that appears the same (non-zero) number of times on every line wins
    if (counts.length && counts[0] > 0 && counts.every((c) => c === counts[0]) && counts[0] * counts.length > bestScore) {
      delimiter = d;
      bestScore = counts[0] * counts.length;
    }
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function readTableRows(filename: string, content: Buffer): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs rows are 1-based
      rows.push(values.map(cellText));
    });
    return rows;
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let text = content.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return parseCsv(text);
  }
  throw new Error("Unsupported file type. Upload an .xlsx or .csv file.");
}

function mapHeaders(header: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  header.forEach((cell, index) => {
    const label = normalizeText(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.has(label) && !(field in mapping)) mapping[field] = index;
  });
  return mapping;
}

export async function parseCompanies(filename: string, content: Buffer): Promise<Record<string, string>[]> {
  let rows = (await readTableRows(filename, content)).filter((row) => row.some((c) => cleanText(c)));
  if (!rows.length) return [];
  let mapping = mapHeaders(rows[0]);
  if ("company_name" in mapping) rows = rows.slice(1);
  else mapping = { company_name: 0 }; // no header row: first column is the company name
  const companies: Record<string, string>[] = [];
  for (const row of rows) {
    const record = Object.fromEntries(Object.entries(mapping).map(([field, i]) => [field, i < row.length ? cleanText(row[i]) : ""]));
    if (record.company_name) companies.push(record);
  }
  return companies;
}

/** Insert unless it is a duplicate: [created, existing duplicate, reason]. */
export async function addCompany(db: Db, record: Record<string, string>): Promise<[Company | null, Company | null, string]> {
  const duplicate = await findDuplicate(db, {
    companyName: record.company_name,
    city: record.city,
    state: record.state,
    website: record.website,
    phone: record.business_phone,
    address: record.address,
  });
  if (duplicate) return [null, duplicate[0], duplicate[1]];
  const fields = Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v || null])) as unknown as Partial<Company> & { company_name: string };
  return [await insertCompany(db, fields), null, ""];
}

export async function importFile(db: Db, filename: string, content: Buffer) {
  const records = await parseCompanies(filename, content);
  const created: number[] = [];
  const duplicates: { company_name: string; existing_id: number; reason: string }[] = [];
  for (const record of records) {
    const [company, existing, reason] = await addCompany(db, record);
    if (company) created.push(company.id);
    else duplicates.push({ company_name: record.company_name, existing_id: existing!.id, reason });
  }
  return { rows: records.length, imported: created.length, duplicates, company_ids: created };
}

// ----------------------------------------------------------------- email-feature uploads
const MAX_ROWS = 5000; // a sane ceiling for a single upload processed in one browser session

/**
 * Generic table parsing for the email features' bulk uploads: each feature needs different
 * columns, so this returns the header row plus the raw rows and lets the user map the columns.
 */
export async function parseTable(filename: string, content: Buffer) {
  const rows = (await readTableRows(filename, content)).filter((row) => row.some((c) => cleanText(c)));
  if (!rows.length) return { headers: [], rows: [] };
  let header = rows[0];
  let body = rows.slice(1);
  const looksLikeHeader =
    header.some((cell) => cleanText(cell) && !/^\d+$/.test(cleanText(cell).replaceAll("@", "").replaceAll(".", ""))) && !header.some((cell) => cleanText(cell).includes("@"));
  if (!looksLikeHeader) {
    header = rows[0].map((_, i) => `Column ${i + 1}`);
    body = rows;
  }
  const width = header.length;
  body = body.slice(0, MAX_ROWS);
  const tableRows = body.map((row) => Array.from({ length: width }, (_, i) => (i < row.length ? cleanText(row[i]) : "")));
  return { headers: header.map((h, i) => cleanText(h) || `Column ${i + 1}`), rows: tableRows, truncated: body.length >= MAX_ROWS };
}
