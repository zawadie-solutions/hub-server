import type {
  AppSettings, Company, CompanyDetail, Dashboard, DiscoveredEmail, EditableField,
  EmailExportFile, EmailJobKind, EmailJobStatus, EmailProvidersResponse, EmailVerificationResult,
  ExportFile, ImportSummary, JobStatus, ReviewItem, SearchResult, SettingsResponse, UploadedTable,
} from "../types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    // Relative ("api/…", not "/api/…") so requests stay under whatever path the app is served
    // from — the root standalone, or /company-research/ behind the Zawadie Solutions Hub.
    response = await fetch(`api${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the backend. Is it running on port 8000?");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) {
        message = body.detail.map((d: { loc?: string[]; msg: string }) =>
          `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ");
      }
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit =>
  ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  session: () => request<{ hub_user: string | null }>("/session"),
  dashboard: () => request<Dashboard>("/dashboard"),

  companies: (search = "", status = "") =>
    request<Company[]>(`/companies?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  company: (id: number) => request<CompanyDetail>(`/companies/${id}`),
  createCompany: (body: { company_name: string; city?: string; state?: string; country?: string }) =>
    request<{ created: boolean; company: Company; duplicate_of?: number; reason?: string }>(
      "/companies", json("POST", body)),
  updateCompany: (id: number, changes: Partial<Record<EditableField, string>>) =>
    request<Company>(`/companies/${id}`, json("PUT", changes)),
  deleteCompany: (id: number) => request<{ deleted: number }>(`/companies/${id}`, json("DELETE")),
  importFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportSummary>("/import", { method: "POST", body: form });
  },

  jobStatus: () => request<JobStatus>("/research/status"),
  startResearch: (company_ids?: number[], redo = false) =>
    request<JobStatus>("/research/start", json("POST", { company_ids, redo })),
  pauseResearch: () => request<JobStatus>("/research/pause", json("POST")),
  resumeResearch: () => request<JobStatus>("/research/resume", json("POST")),
  stopResearch: () => request<JobStatus>("/research/stop", json("POST")),

  reviews: (status = "OPEN") => request<ReviewItem[]>(`/review?status=${status}`),
  resolveReview: (id: number, action: "choose" | "unknown" | "dismiss", candidate_index?: number) =>
    request<ReviewItem>(`/review/${id}/resolve`, json("POST", { action, candidate_index })),

  searchResults: (q = "", companyId?: number) =>
    request<SearchResult[]>(`/search-results?q=${encodeURIComponent(q)}${companyId ? `&company_id=${companyId}` : ""}`),

  exports: () => request<ExportFile[]>("/exports"),
  createExport: (scope: string, include_demo: boolean) =>
    request<{ filename: string; rows: number }>("/exports", json("POST", { scope, include_demo })),
  deleteExport: (filename: string) => request<{ deleted: string }>(`/exports/${filename}`, json("DELETE")),
  exportUrl: (filename: string) => `api/exports/${filename}`,
  sampleInputUrl: "api/sample-input",

  settings: () => request<SettingsResponse>("/settings"),
  saveSettings: (settings: AppSettings, providers: {
    default_provider: string; secondary_provider: string | null; enabled: Record<string, boolean>;
  }) => request<SettingsResponse>("/settings", json("PUT", { settings, providers })),
  saveKeys: (keys: Record<string, string>) =>
    request<SettingsResponse>("/settings/keys", json("PUT", { keys })),
  deleteKey: (name: string) => request<SettingsResponse>(`/settings/keys/${name}`, json("DELETE")),

  // -------------------------------------------------------------- email research
  emailProviders: () => request<EmailProvidersResponse>("/email/providers"),
  emailUpload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadedTable>("/email/upload", { method: "POST", body: form });
  },

  domainSearch: (domain: string, company_name?: string) =>
    request<DiscoveredEmail[]>("/email/domain-search", json("POST", { domain, company_name })),
  findByCompany: (company_name: string, website?: string, city?: string, state?: string) =>
    request<DiscoveredEmail[]>("/email/find-by-company", json("POST", { company_name, website, city, state })),
  findByName: (first_name: string, last_name: string, company_name?: string, domain?: string) =>
    request<DiscoveredEmail[]>("/email/find-by-name", json("POST", { first_name, last_name, company_name, domain })),
  verifyEmail: (email: string) => request<EmailVerificationResult>("/email/verify", json("POST", { email })),

  discoveredEmails: (method = "", q = "") =>
    request<DiscoveredEmail[]>(`/email/discovered?method=${method}&q=${encodeURIComponent(q)}`),
  deleteDiscoveredEmail: (id: number) => request<{ deleted: number }>(`/email/discovered/${id}`, json("DELETE")),
  emailVerifications: (q = "") => request<EmailVerificationResult[]>(`/email/verifications?q=${encodeURIComponent(q)}`),

  emailJobStatus: () => request<EmailJobStatus>("/email/jobs/status"),
  startEmailJob: (kind: EmailJobKind, items: Record<string, string>[]) =>
    request<EmailJobStatus>("/email/jobs/start", json("POST", { kind, items })),
  pauseEmailJob: () => request<EmailJobStatus>("/email/jobs/pause", json("POST")),
  resumeEmailJob: () => request<EmailJobStatus>("/email/jobs/resume", json("POST")),
  stopEmailJob: () => request<EmailJobStatus>("/email/jobs/stop", json("POST")),

  emailExports: (kind: "discovered" | "verifications") => request<EmailExportFile[]>(`/email/exports/${kind}`),
  createEmailExport: (kind: "discovered" | "verifications", scope: string, include_demo: boolean) =>
    request<{ filename: string; rows: number }>(`/email/exports/${kind}`, json("POST", { scope, include_demo })),
  deleteEmailExport: (kind: "discovered" | "verifications", filename: string) =>
    request<{ deleted: string }>(`/email/exports/${kind}/${filename}`, json("DELETE")),
  emailExportUrl: (kind: "discovered" | "verifications", filename: string) => `api/email/exports/${kind}/${filename}`,
};
