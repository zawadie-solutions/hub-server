/** Professional .xlsx exports (companies, discovered emails, email verification results). */
import ExcelJS from "exceljs";
import { type Company, COMPLETED, type DiscoveredEmail, type EmailVerification, FAILED, NEEDS_REVIEW, PENDING } from "./models";

type Column<T> = [header: string, field: keyof T | "input_email", width: number];

export const COLUMNS: Column<Company>[] = [
  ["Company Name", "company_name", 30], ["Website", "website", 32], ["Address", "address", 34],
  ["City", "city", 16], ["State", "state", 14], ["Country", "country", 14],
  ["Business Phone", "business_phone", 18], ["Company Email", "company_email", 30],
  ["Owner Name", "owner_name", 22], ["Owner Title", "owner_title", 18],
  ["Owner Phone", "owner_phone", 18], ["Owner Email", "owner_email", 30],
  ["Decision Maker Name", "decision_maker_name", 22], ["Decision Maker Title", "decision_maker_title", 22],
  ["Decision Maker Phone", "decision_maker_phone", 20], ["Decision Maker Email", "decision_maker_email", 30],
  ["Source", "source", 30], ["Source URL", "source_url", 40], ["Confidence", "confidence", 12],
  ["Verification Status", "verification_status", 18], ["Research Status", "research_status", 16],
  ["Notes", "notes", 60], ["Date Researched", "date_researched", 18],
];
export const HEADERS = COLUMNS.map((c) => c[0]);

const NOT_FOUND_TEXT = "Not Found";
// Fields that read "Not Found" once a company has been researched and nothing verifiable turned up.
const RESEARCHED_FIELDS = new Set(["owner_name", "owner_phone", "owner_email", "company_email", "business_phone"]);
const PHONE_FIELDS = new Set(["business_phone", "owner_phone", "decision_maker_phone"]);
const EMAIL_FIELDS = new Set(["company_email", "owner_email", "decision_maker_email"]);

const STATUS_FILLS: Record<string, string> = {
  VERIFIED: "C6EFCE", LIKELY: "E2F0D9", UNCERTAIN: "FFEB9C", CONFLICT: "F8CBAD", NOT_FOUND: "E7E6E6",
  [COMPLETED]: "C6EFCE", [NEEDS_REVIEW]: "FFEB9C", [FAILED]: "F8CBAD", [PENDING]: "E7E6E6", RESEARCHING: "DDEBF7",
};
const fill = (rgb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${rgb}` } });
const HEADER_FILL = fill("1F3864");
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD9D9D9" } };
const BORDER: Partial<ExcelJS.Borders> = { left: THIN, right: THIN, top: THIN, bottom: THIN };
const LINK_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF0563C1" }, underline: "single" };
const MUTED_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF808080" }, italic: true };

const confidenceFill = (value: number) => fill(value >= 0.85 ? "C6EFCE" : value >= 0.65 ? "E2F0D9" : value >= 0.4 ? "FFEB9C" : "F8CBAD");
const pct = (value: number) => Math.round((value / 100) * 100) / 100;

function sheetWithHeaders<T>(workbook: ExcelJS.Workbook, title: string, columns: Column<T>[], rowCount: number): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }] });
  sheet.addRow(columns.map((c) => c[0]));
  columns.forEach(([, , width], i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
    sheet.getColumn(i + 1).width = width;
  });
  sheet.getRow(1).height = 32;
  sheet.autoFilter = `A1:${columnLetter(columns.length)}${Math.max(1, rowCount + 1)}`;
  return sheet;
}

function columnLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function infoSheet(workbook: ExcelJS.Workbook, rows: [string, string | number][], widths: [number, number]): void {
  const info = workbook.addWorksheet("Info");
  for (const row of rows) info.addRow(row);
  info.getColumn(1).eachCell((cell, rowNumber) => {
    cell.font = { bold: true, size: rowNumber === 1 ? 14 : 11, color: { argb: cell.value === "WARNING" ? "FFC00000" : "FF000000" } };
  });
  info.getColumn(1).width = widths[0];
  info.getColumn(2).width = widths[1];
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export async function exportCompanies(companies: Company[], file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = sheetWithHeaders(workbook, "Companies", COLUMNS, companies.length);

  companies.forEach((company, r) => {
    const researched = company.research_status === COMPLETED || company.research_status === NEEDS_REVIEW;
    COLUMNS.forEach(([, fieldKey], c) => {
      const field = fieldKey as keyof Company;
      const value = company[field] as unknown;
      const cell = sheet.getCell(r + 2, c + 1);
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: field === "notes" || field === "address" };

      if ((value === null || value === undefined || value === "") && researched && RESEARCHED_FIELDS.has(field)) {
        cell.value = NOT_FOUND_TEXT;
        cell.font = MUTED_FONT;
      } else if (field === "confidence") {
        if (value !== null && value !== undefined) {
          cell.value = pct(Number(value));
          cell.numFmt = "0%";
          cell.fill = confidenceFill(cell.value as number);
        }
        cell.alignment = { horizontal: "center", vertical: "top" };
      } else if (field === "date_researched") {
        if (value) {
          cell.value = value as Date;
          cell.numFmt = "yyyy-mm-dd hh:mm";
        }
      } else if (PHONE_FIELDS.has(field)) {
        cell.value = (value as string) ?? null;
        cell.numFmt = "@"; // keep phones as text (leading zeros, + signs)
      } else if (EMAIL_FIELDS.has(field) && value) {
        cell.value = { text: value as string, hyperlink: `mailto:${value}` };
        cell.font = LINK_FONT;
      } else if ((field === "website" || field === "source_url") && value) {
        cell.value = { text: value as string, hyperlink: value as string };
        cell.font = LINK_FONT;
      } else if (field === "verification_status" || field === "research_status") {
        cell.value = String(value ?? "").replaceAll("_", " ");
        cell.alignment = { horizontal: "center", vertical: "top" };
        cell.font = { bold: true };
        if (typeof value === "string" && STATUS_FILLS[value]) cell.fill = fill(STATUS_FILLS[value]);
      } else {
        cell.value = (value as ExcelJS.CellValue) ?? null;
      }
    });
  });

  const demoCount = companies.filter((c) => c.is_demo).length;
  const info: [string, string | number][] = [
    ["Company Research Export", ""],
    ["Exported", stamp()],
    ["Companies", companies.length],
    ["Owner found", companies.filter((c) => c.owner_name).length],
    ["Needs review", companies.filter((c) => c.research_status === NEEDS_REVIEW).length],
    ["Demo rows (simulated)", demoCount],
    ["", ""],
    ["Confidence", "Evidence-based: source reliability x company match, plus corroboration."],
    ["Not Found", "Nothing verifiable was found. Values are never guessed or generated."],
  ];
  if (demoCount) info.splice(1, 0, ["WARNING", `${demoCount} row(s) contain DEMO DATA — simulated, not real research. See the Notes column.`]);
  infoSheet(workbook, info, [26, 90]);
  await workbook.xlsx.writeFile(file);
}

// -------------------------------------------------------------- discovered emails
const EMAIL_COLUMNS: Column<DiscoveredEmail>[] = [
  ["Company Name", "company_name", 28], ["Domain", "domain", 24], ["Email Address", "email", 30],
  ["Contact Name", "full_name", 22], ["Job Title", "title", 20], ["Department", "department", 18],
  ["Email Type", "email_type", 14], ["Source URL", "source_url", 40],
  ["Verification Status", "verification_status", 18], ["Confidence", "confidence", 12],
  ["Discovery Provider", "discovery_provider", 16], ["Research Date", "created_at", 18],
];

export async function exportDiscoveredEmails(rows: DiscoveredEmail[], file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = sheetWithHeaders(workbook, "Discovered Emails", EMAIL_COLUMNS, rows.length);

  rows.forEach((item, r) => {
    EMAIL_COLUMNS.forEach(([, fieldKey], c) => {
      const field = fieldKey as keyof DiscoveredEmail;
      const value = item[field] as unknown;
      const cell = sheet.getCell(r + 2, c + 1);
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: field === "source_url" };

      if (field === "email" && !value) {
        cell.value = "Not Found";
        cell.font = MUTED_FONT;
      } else if (field === "email") {
        cell.value = { text: value as string, hyperlink: `mailto:${value}` };
        cell.font = LINK_FONT;
      } else if (field === "source_url" && value) {
        cell.value = { text: value as string, hyperlink: value as string };
        cell.font = LINK_FONT;
      } else if (field === "confidence") {
        if (value !== null && value !== undefined) {
          cell.value = pct(Number(value));
          cell.numFmt = "0%";
          cell.fill = confidenceFill(cell.value as number);
        }
        cell.alignment = { horizontal: "center", vertical: "top" };
      } else if (field === "email_type") {
        cell.value = ({ personal: "Personal", generic: "Generic" } as Record<string, string>)[value as string] ?? (value as string) ?? null;
      } else if (field === "verification_status") {
        cell.value = String(value || "Not Verified").replaceAll("_", " ");
        cell.font = { bold: true };
        if (typeof value === "string" && STATUS_FILLS[value]) cell.fill = fill(STATUS_FILLS[value]);
      } else if (field === "created_at" && value) {
        cell.value = value as Date;
        cell.numFmt = "yyyy-mm-dd hh:mm";
      } else {
        cell.value = value !== null && value !== undefined && value !== "" ? (value as ExcelJS.CellValue) : field === "company_name" && item.status === "NEEDS_REVIEW" ? "Needs Review" : ((value as ExcelJS.CellValue) ?? null);
      }
    });
  });

  const demoCount = rows.filter((r) => r.is_demo).length;
  const info: [string, string | number][] = [
    ["Email Discovery Export", ""],
    ["Exported", stamp()],
    ["Results", rows.length],
    ["Demo rows (simulated)", demoCount],
    ["", ""],
    ["Accuracy", "Only publicly discoverable addresses are listed — nothing is pattern-guessed."],
    ["Verification Status", "Set by the separate Email Verification feature, not by discovery."],
  ];
  if (demoCount) info.splice(1, 0, ["WARNING", `${demoCount} row(s) contain DEMO DATA — simulated, not real research.`]);
  infoSheet(workbook, info, [22, 90]);
  await workbook.xlsx.writeFile(file);
}

// ---------------------------------------------------------- email verification results
const VERIFICATION_COLUMNS: Column<EmailVerification>[] = [
  ["Input Email", "input_email", 30], ["Email Address", "email", 30],
  ["Overall Status", "status", 16], ["Syntax Check", "syntax_check", 14],
  ["Domain Check", "domain_check", 14], ["MX Check", "mx_check", 14],
  ["Mailbox Check", "mailbox_check", 14], ["Disposable Status", "disposable_status", 16],
  ["Role-Based Status", "role_based_status", 16], ["Catch-All Status", "catch_all_status", 16],
  ["Provider", "provider", 16], ["Verification Date", "verified_at", 18],
  ["Error / Explanation", "error", 50],
];
const CHECK_LABELS: Record<string, string> = { passed: "Passed", failed: "Failed", not_available: "Not Available" };
const VERIFY_STATUS_FILLS: Record<string, string> = {
  Valid: "C6EFCE", Invalid: "F8CBAD", Risky: "FFEB9C", Unknown: "E7E6E6",
  "Catch-All": "FFE3B3", Disposable: "F8CBAD", "Role-Based": "DDEBF7", "Verification Failed": "F8CBAD",
};
/** Python's str.title() for these snake_case labels: "not_role_based" -> "Not Role Based". */
const titleWords = (value: string) => value.replaceAll("_", " ").replace(/\b([a-z])/g, (m) => m.toUpperCase());

export async function exportEmailVerifications(rows: EmailVerification[], file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = sheetWithHeaders(workbook, "Email Verification", VERIFICATION_COLUMNS, rows.length);

  rows.forEach((item, r) => {
    const inputEmail = (item.input_row?.email as string | undefined) || item.email;
    VERIFICATION_COLUMNS.forEach(([, field], c) => {
      const value = field === "input_email" ? inputEmail : (item[field as keyof EmailVerification] as unknown);
      const cell = sheet.getCell(r + 2, c + 1);
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: field === "error" };

      if (field === "email") {
        cell.value = { text: value as string, hyperlink: `mailto:${value}` };
        cell.font = LINK_FONT;
      } else if (field === "syntax_check" || field === "domain_check" || field === "mx_check" || field === "mailbox_check") {
        cell.value = CHECK_LABELS[value as string] ?? (value as string);
        if (value === "not_available") cell.font = MUTED_FONT;
      } else if (field === "disposable_status" || field === "role_based_status" || field === "catch_all_status") {
        cell.value = titleWords((value as string) || "not_available");
        if (value === "not_available") cell.font = MUTED_FONT;
      } else if (field === "status") {
        cell.value = value as string;
        cell.font = { bold: true };
        if (VERIFY_STATUS_FILLS[value as string]) cell.fill = fill(VERIFY_STATUS_FILLS[value as string]);
      } else if (field === "verified_at" && value) {
        cell.value = value as Date;
        cell.numFmt = "yyyy-mm-dd hh:mm";
      } else {
        cell.value = (value as ExcelJS.CellValue) ?? null;
      }
    });
  });

  const demoCount = rows.filter((r) => r.is_demo).length;
  const info: [string, string | number][] = [
    ["Email Verification Export", ""],
    ["Exported", stamp()],
    ["Results", rows.length],
    ["Demo rows (simulated)", demoCount],
    ["", ""],
    ["Not Available", "The selected provider does not support this check — it is never shown as a pass."],
    ["Unknown", "Syntax/domain/MX may be fine, but mailbox existence could not be confirmed without a dedicated mailbox-verification provider."],
  ];
  if (demoCount) info.splice(1, 0, ["WARNING", `${demoCount} row(s) contain DEMO DATA — simulated, not real verification.`]);
  infoSheet(workbook, info, [18, 95]);
  await workbook.xlsx.writeFile(file);
}
