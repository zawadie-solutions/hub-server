import { Confidence, ErrorBox, StatusBadge, usePolling } from "../components/ui";
import { api } from "../services/api";
import type { Page } from "../types";

interface Props {
  go: (page: Page) => void;
  openCompany: (id: number) => void;
}

export default function DashboardPage({ go, openCompany }: Props) {
  const { data, error } = usePolling(api.dashboard, 3000);
  const { data: job } = usePolling(api.jobStatus, 2000);

  const cards: [string, number | undefined, string][] = [
    ["Total Companies", data?.total, ""],
    ["Research Completed", data?.completed, "good"],
    ["Researching", data?.researching, "info"],
    ["Waiting", data?.pending, ""],
    ["Owner Found", data?.owner_found, "good"],
    ["Owner Not Found", data?.owner_not_found, ""],
    ["Contact Found", data?.contact_found, "good"],
    ["Needs Review", data?.needs_review, "warn"],
    ["Failed", data?.failed, "bad"],
  ];

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        <button className="primary" onClick={() => go("research")}>+ New Research</button>
      </header>
      <ErrorBox message={error} />

      <div className="cards">
        {cards.map(([label, value, tone]) => (
          <div key={label} className={`card stat ${tone}`}>
            <div className="stat-value">{value ?? "—"}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {!!data?.demo_records && (
        <p className="muted">{data.demo_records} of these records contain simulated DEMO DATA.</p>
      )}

      {data?.total === 0 && (
        <div className="card empty">
          <h3>No companies yet</h3>
          <p>Add a company name or upload an Excel/CSV list to start researching.</p>
          <button className="primary" onClick={() => go("research")}>+ New Research</button>
        </div>
      )}

      {job && job.state !== "idle" && (
        <div className="card">
          <div className="row between">
            <h3>Research {job.state}: {job.completed} / {job.total}</h3>
            <button onClick={() => go("research")}>Open progress</button>
          </div>
          <div className="progress"><div style={{ width: `${job.total ? (job.completed / job.total) * 100 : 0}%` }} /></div>
        </div>
      )}

      {!!job?.recent.length && (
        <div className="card">
          <h3>Recently researched</h3>
          <table>
            <thead><tr><th>Company</th><th>Owner</th><th>Status</th><th>Confidence</th></tr></thead>
            <tbody>
              {job.recent.map((item) => (
                <tr key={item.company_id} className="clickable" onClick={() => openCompany(item.company_id)}>
                  <td>{item.company_name}</td>
                  <td>{item.owner_name ?? <span className="muted">Not found</span>}</td>
                  <td><StatusBadge status={item.research_status === "COMPLETED" ? item.verification_status : item.research_status} /></td>
                  <td><Confidence value={item.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
