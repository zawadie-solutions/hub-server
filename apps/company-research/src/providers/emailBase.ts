/**
 * Email discovery and verification interfaces.
 *
 * Mirrors the SearchProvider pattern but for two deliberately separate responsibilities:
 *   - EmailDiscoveryProvider: find email addresses associated with a domain, company or person.
 *   - EmailVerificationProvider: check whether an already-known email address is real/safe to use.
 * A web search engine is not a mailbox-verification service, so one is never assumed to satisfy
 * the other.
 */

export const NOT_AVAILABLE = "not_available"; // a check the selected provider does not support — never "passed"

// The eight canonical verification statuses (the frontend relies on exactly these).
export const VALID = "Valid";
export const INVALID = "Invalid";
export const RISKY = "Risky";
export const UNKNOWN = "Unknown";
export const CATCH_ALL = "Catch-All";
export const DISPOSABLE = "Disposable";
export const ROLE_BASED = "Role-Based";
export const VERIFICATION_FAILED = "Verification Failed";

export const PERSONAL = "personal";
export const GENERIC = "generic";

/** One discovered email address, as returned by an EmailDiscoveryProvider. */
export interface EmailMatch {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  department: string;
  emailType: string; // "personal" | "generic" | "" (unknown)
  providerConfidence: number | null; // 0-100 straight from the provider, if it gives one
  sourceUrl: string;
  sourceTitle: string;
}

export const emailMatch = (m: Partial<EmailMatch> & { email: string }): EmailMatch => ({
  firstName: "",
  lastName: "",
  fullName: "",
  title: "",
  department: "",
  emailType: "",
  providerConfidence: null,
  sourceUrl: "",
  sourceTitle: "",
  ...m,
});

/** Result of checking one email address. Unsupported checks stay "not_available", never a guessed pass. */
export interface VerificationResult {
  status: string;
  syntax_check: string;
  domain_check: string;
  mx_check: string;
  mailbox_check: string;
  disposable_status: string;
  role_based_status: string;
  catch_all_status: string;
  provider: string;
  raw: Record<string, unknown>; // the provider's own response, kept verbatim
  error: string;
}

export const verificationResult = (r: Partial<VerificationResult> & { status: string }): VerificationResult => ({
  syntax_check: NOT_AVAILABLE,
  domain_check: NOT_AVAILABLE,
  mx_check: NOT_AVAILABLE,
  mailbox_check: NOT_AVAILABLE,
  disposable_status: NOT_AVAILABLE,
  role_based_status: NOT_AVAILABLE,
  catch_all_status: NOT_AVAILABLE,
  provider: "",
  raw: {},
  error: "",
  ...r,
});

interface ProviderMeta {
  readonly name: string;
  readonly label: string;
  readonly isDemo: boolean;
  readonly requiredEnv: readonly string[];
  isConfigured(): boolean;
}

export interface EmailDiscoveryProvider extends ProviderMeta {
  /** Every publicly discoverable email the provider has for this domain. */
  searchDomain(domain: string, limit?: number): Promise<EmailMatch[]>;
  /** Candidate email(s) for one named person, scoped to a company/domain when given. */
  findByName(firstName: string, lastName: string, domain?: string | null, companyName?: string | null): Promise<EmailMatch[]>;
  findByCompany(companyName: string, domain?: string | null): Promise<EmailMatch[]>;
}

export interface EmailVerificationProvider extends ProviderMeta {
  /** Never claims mailbox existence or a check the provider did not actually perform. */
  verify(email: string): Promise<VerificationResult>;
}

/** Default findByCompany: once a domain is known, this is just a domain search. */
export const findByCompanyViaDomain = (provider: EmailDiscoveryProvider, domain?: string | null) => (domain ? provider.searchDomain(domain) : Promise.resolve([]));
