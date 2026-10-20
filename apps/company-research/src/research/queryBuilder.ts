/** Reusable search-query builders. All research queries are defined here. */
import { cleanText, registeredDomain } from "../utils/normalization";

export interface QueryCompany {
  company_name: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
}

const q = (value: string) => '"' + cleanText(value).replaceAll('"', "") + '"';

function dedupe(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let query of queries) {
    query = cleanText(query);
    if (query && !seen.has(query.toLowerCase())) {
      seen.add(query.toLowerCase());
      out.push(query);
    }
  }
  return out;
}

const location = (c: QueryCompany) => cleanText(`${c.city || ""} ${c.state || ""}`);

/**
 * The company's street address when already known (e.g. from the import file or an earlier
 * research pass), otherwise its city/state. A full address narrows results to the right
 * business far better than city/state alone, especially for a common name.
 */
const searchLocation = (c: QueryCompany) => cleanText(c.address) || location(c);

export function buildCompanyQueries(c: QueryCompany): string[] {
  const name = q(c.company_name);
  return dedupe([`${name} ${location(c)}`, `${name} ${c.state || ""}`, `${name} website`, `${name} contact`, `${name} phone`, `${name} owner`]);
}

export function buildOwnerQueries(c: QueryCompany, website?: string | null): string[] {
  const name = q(c.company_name);
  const queries: string[] = [];
  const where = searchLocation(c);
  // One combined query, tried first: a business-listing/registry page that already has the
  // address often has the owner's name, title, phone and email on the same page too, so this can
  // satisfy several fields in a single search instead of four separate ones.
  if (where) queries.push(`${name} ${where} owner title phone email`);
  queries.push(`${name} owner`, `${name} founder`);
  const domain = registeredDomain(website);
  if (domain) queries.push(`site:${domain} owner`, `site:${domain} about`, `site:${domain} team`, `site:${domain} founder`, `site:${domain} CEO`);
  queries.push(`${name} CEO`, `${name} president`, `${name} managing director`, `${name} "owner"`);
  return dedupe(queries);
}

export function buildOwnerPhoneQueries(c: QueryCompany, personName: string): string[] {
  const who = q(personName);
  const name = q(c.company_name);
  return dedupe([`${who} ${name} phone`, `${who} ${name} contact`, `${who} ${name} telephone`, `${who} ${name} "phone number"`]);
}

export function buildOwnerEmailQueries(c: QueryCompany, personName: string): string[] {
  const who = q(personName);
  const name = q(c.company_name);
  return dedupe([`${who} ${name} email`, `${who} ${name} contact`, `${who} ${name} "@"`]);
}

export function buildCompanyEmailQueries(c: QueryCompany, website?: string | null): string[] {
  const name = q(c.company_name);
  const queries = [`${name} email`, `${name} contact email`, `${name} contact`];
  const domain = registeredDomain(website);
  if (domain) queries.splice(1, 0, `site:${domain} email`);
  return dedupe(queries);
}

export function buildDecisionMakerQueries(c: QueryCompany, website?: string | null): string[] {
  const name = q(c.company_name);
  const queries: string[] = [];
  const where = searchLocation(c);
  if (where) queries.push(`${name} ${where} manager title phone email`);
  queries.push(`${name} general manager`, `${name} CEO`, `${name} president`, `${name} managing director`);
  const domain = registeredDomain(website);
  if (domain) queries.splice(1, 0, `site:${domain} team`);
  queries.push(`${name} operations manager`, `${name} sales manager`, `${name} business development manager`);
  return dedupe(queries);
}
