/** Duplicate detection: company name + location, then website, phone and address. */
import type { Db } from "../db/db";
import { allCompanies } from "../db/repo";
import type { Company } from "../models";
import { normalizeCompanyName, normalizeText, phoneDigits, registeredDomain, stateForms } from "../utils/normalization";

/** Blank on either side is compatible; otherwise the values must match. */
function samePlace(a: string | null | undefined, b: string | null | undefined, isState = false): boolean {
  if (!(a ?? "").trim() || !(b ?? "").trim()) return true;
  if (isState) return stateForms(a)[0] === stateForms(b)[0];
  return normalizeText(a) === normalizeText(b);
}

export interface DuplicateQuery {
  companyName: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  excludeId?: number | null;
}

/** [existing company, reason] when the given company is already in the database. */
export function findDuplicateIn(companies: Company[], q: DuplicateQuery): [Company, string] | null {
  const name = normalizeCompanyName(q.companyName);
  const domain = registeredDomain(q.website);
  const digits = phoneDigits(q.phone);
  const street = normalizeText(q.address);
  for (const other of companies) {
    if (other.id === q.excludeId) continue;
    const sameLocation = samePlace(q.city, other.city) && samePlace(q.state, other.state, true);
    if (name && normalizeCompanyName(other.company_name) === name && sameLocation) return [other, "same company name and location"];
    if (domain && registeredDomain(other.website) === domain) return [other, "same website"];
    if (digits.length >= 9 && phoneDigits(other.business_phone) === digits) return [other, "same business phone"];
    if (street.length >= 10 && normalizeText(other.address) === street) return [other, "same address"];
  }
  return null;
}

export async function findDuplicate(db: Db, q: DuplicateQuery): Promise<[Company, string] | null> {
  return findDuplicateIn(await allCompanies(db), q);
}
