import { useState } from "react";
import CompanyDetailView from "../components/CompanyDetail";
import { Confidence, DemoTag, ErrorBox, Found, StatusBadge, usePolling } from "../components/ui";
import { api } from "../services/api";
import type { Company, Page } from "../types";

interface Props {
  companyId: number | null;
  setCompanyId: (id: number | null) => void;
  go: (page: Page) => void;
}

const FILTERS = ["", "PENDING", "RESEARCHING", "COMPLETED", "NEEDS_REVIEW", "FAILED", "VERIFIED", "CONFLICT", "NOT_FOUND"];

/** The row status the user cares about: review/failed first, otherwise how well it is verified. */
function rowStatus(company: Company): string | null {
  return company.research_status === "COMPLETED" ? company.verification_status : company.research_status;
}

export default function CompaniesPage({ companyId, setCompanyId, go }: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: companies, error, reload } = usePolling(() => api.companies(search, status), 4000, [search, status]);

  if (companyId !== null) {
    return <CompanyDetailView id={companyId} onBack={() => { setCompanyId(null); reload(); }} />;
  }

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const allSelected = !!companies?.length && companies.every((c) => selected.has(c.id));

  const run = async (action: () => Promise<string>) => {
    setMessage(null);
    setActionError(null);
    try {
      setMessage(await action());
      setSelected(new Set());
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const researchSelected = () => run(async () => {
    const job = await api.startResearch([...selected], true);
    go("research");
    return `Started research for ${job.total} companies.`;
  });

  const deleteSelected = () => {
    if (!window.confirm(`Delete ${selected.size} selected companies and all their research data?`)) return;
    run(async () => {
      for (const id of selected) await api.deleteCompany(id);
      return `Deleted ${selected.size} companies.`;
    });
  };

  return (
    <>
      <header className="page-head">
        <h1>Companies</h1>
        <button className="primary" onClick={() => go("research")}>+ New Research</button>
      </header>
      <ErrorBox message={error ?? actionError} />
      {message && <div className="alert success">{message}</div>}

      <div className="toolbar">
        <input placeholder="Search company, owner or city…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {FILTERS.map((f) => <option key={f} value={f}>{f ? f.replace("_", " ") : "All statuses"}</option>)}
        </select>
        <span className="spacer" />
        {selected.size > 0 && (
          <>
            <span className="muted">{selected.size} selected</span>
            <button onClick={researchSelected}>Research selected</button>
            <button className="danger" onClick={deleteSelected}>Delete</button>
          </>
        )}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th className="check">
                <input type="checkbox" checked={allSelected} aria-label="Select all"
                  onChange={() => setSelected(allSelected ? new Set() : new Set(companies?.map((c) => c.id)))} />
              </th>
              <th>Company</th><th>Location</th><th>Owner</th><th>Phone</th><th>Email</th><th>Status</th><th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {companies?.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setCompanyId(c.id)}>
                <td className="check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.company_name}`} />
                </td>
                <td><strong>{c.company_name}</strong> {c.is_demo && <DemoTag />}</td>
                <td>{[c.city, c.state].filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                <td>
                  {c.owner_name ?? (c.decision_maker_name
                    ? <span title="No owner found — this is the most senior decision maker">{c.decision_maker_name} <span className="muted">({c.decision_maker_title})</span></span>
                    : <span className="muted">{c.research_status === "PENDING" ? "—" : "Not found"}</span>)}
                </td>
                <td>{c.research_status === "PENDING" ? <span className="muted">—</span> : <Found value={c.owner_phone ?? c.decision_maker_phone ?? c.business_phone} />}</td>
                <td>{c.research_status === "PENDING" ? <span className="muted">—</span> : <Found value={c.owner_email ?? c.decision_maker_email ?? c.company_email} />}</td>
                <td><StatusBadge status={rowStatus(c)} /></td>
                <td><Confidence value={c.confidence} /></td>
              </tr>
            ))}
            {companies?.length === 0 && (
              <tr><td colSpan={8} className="empty-row">No companies match. Use “+ New Research” to add some.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
