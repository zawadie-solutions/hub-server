import { useState } from "react";
import { api } from "../services/api";
import type { EditableField } from "../types";
import { Confidence, DemoTag, ErrorBox, StatusBadge, formatDate, usePolling } from "./ui";

const GROUPS: { title: string; confidenceKey?: string; fields: [EditableField, string][] }[] = [
  {
    title: "Company Information",
    confidenceKey: "company",
    fields: [["company_name", "Company name"], ["website", "Website"], ["address", "Address"],
      ["city", "City"], ["state", "State"], ["country", "Country"]],
  },
  {
    title: "Owner Information",
    confidenceKey: "owner",
    fields: [["owner_name", "Owner name"], ["owner_title", "Owner title"],
      ["owner_phone", "Owner phone"], ["owner_email", "Owner email"]],
  },
  {
    title: "Decision Maker",
    confidenceKey: "decision_maker",
    fields: [["decision_maker_name", "Name"], ["decision_maker_title", "Title"],
      ["decision_maker_phone", "Phone"], ["decision_maker_email", "Email"]],
  },
  {
    title: "Company Contact",
    fields: [["business_phone", "Business phone"], ["company_email", "Company email"], ["notes", "Notes"]],
  },
];

const FIELD_LABELS: Record<string, string> = {
  company: "Company match", website: "Website", owner: "Owner", owner_phone: "Owner phone",
  owner_email: "Owner email", decision_maker: "Decision maker", decision_maker_phone: "Decision maker phone",
  decision_maker_email: "Decision maker email", business_phone: "Business phone",
  company_email: "Company email", address: "Address", company_name: "Company name",
};

const CONFIDENCE_KEYS: Partial<Record<EditableField, string>> = {
  owner_name: "owner", decision_maker_name: "decision_maker", website: "website", address: "address",
  owner_phone: "owner_phone", owner_email: "owner_email", decision_maker_phone: "decision_maker_phone",
  decision_maker_email: "decision_maker_email", business_phone: "business_phone", company_email: "company_email",
};

type Tab = "evidence" | "queries" | "results" | "history";

export default function CompanyDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, error, reload } = usePolling(() => api.company(id), 5000, [id]);
  const [draft, setDraft] = useState<Partial<Record<EditableField, string>> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("evidence");

  if (!data) return <><button onClick={onBack}>← Back</button><ErrorBox message={error} /></>;
  const { company, evidence, logs, search_results: results, reviews, source_labels: labels } = data;
  const researched = company.research_status !== "PENDING" && company.research_status !== "RESEARCHING";
  const editing = draft !== null;

  const startEdit = () => {
    const initial: Partial<Record<EditableField, string>> = {};
    GROUPS.forEach((g) => g.fields.forEach(([f]) => { initial[f] = (company[f] as string | null) ?? ""; }));
    setDraft(initial);
    setSaveError(null);
  };

  const save = async () => {
    if (!draft) return;
    const changes: Partial<Record<EditableField, string>> = {};
    (Object.keys(draft) as EditableField[]).forEach((f) => {
      if ((draft[f] ?? "") !== ((company[f] as string | null) ?? "")) changes[f] = draft[f];
    });
    setSaving(true);
    try {
      if (Object.keys(changes).length) await api.updateCompany(company.id, changes);
      setDraft(null);
      await reload();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const research = async () => {
    try {
      await api.startResearch([company.id], true);
      reload();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  const renderValue = (field: EditableField, value: string | null) => {
    if (!value) return <span className="muted">{researched && field !== "notes" && field !== "country" ? "Not Found" : "—"}</span>;
    if (field === "website") return <a href={value} target="_blank" rel="noreferrer">{value}</a>;
    if (field.endsWith("email")) return <a href={`mailto:${value}`}>{value}</a>;
    return value;
  };

  const queries = logs.filter((l) => l.query);
  const openReviews = reviews.filter((r) => r.status === "OPEN");

  return (
    <>
      <header className="page-head">
        <div>
          <button className="link" onClick={onBack}>← All companies</button>
          <h1>{company.company_name} {company.is_demo && <DemoTag />}</h1>
          <div className="row gap">
            <StatusBadge status={company.research_status} />
            <StatusBadge status={company.verification_status} />
            <span className="muted">Overall confidence</span> <Confidence value={company.confidence} />
            <span className="muted">· Researched {formatDate(company.date_researched)}</span>
            {company.provider_used && <span className="muted">· via {company.provider_used}</span>}
          </div>
        </div>
        <div className="row gap">
          {editing ? (
            <>
              <button onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
              <button className="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </>
          ) : (
            <>
              <button onClick={research} disabled={company.research_status === "RESEARCHING"}>
                {researched ? "Research again" : "Research now"}
              </button>
              <button className="primary" onClick={startEdit}>Edit</button>
            </>
          )}
        </div>
      </header>
      <ErrorBox message={error ?? saveError} />
      {company.is_demo && (
        <div className="alert demo">DEMO DATA — everything on this record is simulated. It is not real research.</div>
      )}
      {openReviews.map((r) => (
        <div key={r.id} className="alert warn">Review required: {r.issue} Open the Review Queue to resolve it.</div>
      ))}

      <div className="grid two">
        {GROUPS.map((group) => (
          <section key={group.title} className="card">
            <div className="row between">
              <h3>{group.title}</h3>
              {group.confidenceKey && company.field_confidence?.[group.confidenceKey] && (
                <span className="row gap">
                  <StatusBadge status={company.field_confidence[group.confidenceKey].status} />
                  <Confidence value={company.field_confidence[group.confidenceKey].confidence} />
                </span>
              )}
            </div>
            <dl>
              {group.fields.map(([field, label]) => (
                <div key={field} className="field">
                  <dt>{label}</dt>
                  <dd>
                    {editing ? (
                      field === "notes"
                        ? <textarea rows={3} value={draft[field] ?? ""} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
                        : <input value={draft[field] ?? ""} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
                    ) : (
                      <>
                        {renderValue(field, company[field] as string | null)}
                        {CONFIDENCE_KEYS[field] && !!company[field] && company.field_confidence?.[CONFIDENCE_KEYS[field]!] && (
                          <span className="field-conf"><Confidence value={company.field_confidence[CONFIDENCE_KEYS[field]!].confidence} /></span>
                        )}
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <section className="card">
        <div className="row between">
          <h3>Sources</h3>
          {company.source_url && <a href={company.source_url} target="_blank" rel="noreferrer">{company.source}</a>}
        </div>
        <div className="tabs">
          {([["evidence", `Evidence (${evidence.length})`], ["queries", `Search Queries (${queries.length})`],
            ["results", `Search Results (${results.length})`], ["history", `Research History (${logs.length})`]] as [Tab, string][])
            .map(([key, label]) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
            ))}
        </div>

        {tab === "evidence" && (
          evidence.length === 0 ? <p className="muted">No evidence recorded yet.</p> : (
            <table>
              <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Evidence</th><th>Score</th></tr></thead>
              <tbody>
                {evidence.map((e) => (
                  <tr key={e.id} className={e.selected ? "" : "dim"}>
                    <td>{FIELD_LABELS[e.field] ?? e.field}{!e.selected && <div className="muted small">candidate</div>}</td>
                    <td><strong>{e.value}</strong>{e.detail && <div className="muted small">{e.detail}</div>}</td>
                    <td>
                      {labels[e.source_type] ?? e.source_type}
                      {e.source_url && <div className="small"><a href={e.source_url} target="_blank" rel="noreferrer">{e.source_title || e.source_url}</a></div>}
                    </td>
                    <td className="snippet">{e.snippet}</td>
                    <td><Confidence value={e.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "queries" && (
          queries.length === 0 ? <p className="muted">No searches have been run for this company.</p> : (
            <table>
              <thead><tr><th>Step</th><th>Query</th><th>Result</th><th>Time</th></tr></thead>
              <tbody>
                {queries.map((l) => (
                  <tr key={l.id}><td>{l.step}</td><td><code>{l.query}</code></td><td>{l.result}</td><td>{formatDate(l.timestamp)}</td></tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "results" && (
          results.length === 0 ? <p className="muted">No search results stored.</p> : (
            <table>
              <thead><tr><th>Result</th><th>Snippet</th><th>Query</th><th>Provider</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td><a href={r.url ?? "#"} target="_blank" rel="noreferrer">{r.title || r.url}</a><div className="muted small">{r.url}</div></td>
                    <td className="snippet">{(r.snippet ?? "").slice(0, 300)}</td>
                    <td><code>{r.query}</code></td>
                    <td>{r.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "history" && (
          <table>
            <thead><tr><th>Time</th><th>Step</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.timestamp)}</td><td>{l.step}</td><td>{l.status}</td>
                  <td>{l.query && <code>{l.query}</code>} {l.result}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={4} className="empty-row">Not researched yet.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
