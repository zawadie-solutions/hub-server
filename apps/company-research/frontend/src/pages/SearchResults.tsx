import { useState } from "react";
import { ErrorBox, formatDate, usePolling } from "../components/ui";
import { api } from "../services/api";

export default function SearchResultsPage({ openCompany }: { openCompany: (id: number) => void }) {
  const [q, setQ] = useState("");
  const { data: results, error } = usePolling(() => api.searchResults(q), 0, [q]);

  return (
    <>
      <header className="page-head"><h1>Search Results</h1></header>
      <ErrorBox message={error} />
      <div className="toolbar">
        <input placeholder="Filter by company, query, title or URL…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{results ? `${results.length} most recent results` : ""}</span>
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Company</th><th>Query</th><th>Result</th><th>Snippet</th><th>Provider</th><th>Searched</th></tr></thead>
          <tbody>
            {results?.map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => openCompany(r.company_id)}>{r.company_name}</button></td>
                <td><code>{r.query}</code></td>
                <td><a href={r.url ?? "#"} target="_blank" rel="noreferrer">{r.title || r.url}</a><div className="muted small">{r.url}</div></td>
                <td className="snippet">{(r.snippet ?? "").slice(0, 260)}</td>
                <td>{r.provider === "mock" ? <span className="badge demo">DEMO</span> : r.provider}</td>
                <td className="nowrap">{formatDate(r.searched_at)}</td>
              </tr>
            ))}
            {results?.length === 0 && <tr><td colSpan={6} className="empty-row">No search results stored yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
