import { useState } from "react";
import { Confidence, ErrorBox, formatDate, usePolling } from "../components/ui";
import { api } from "../services/api";
import type { ReviewItem } from "../types";

interface Props {
  openCompany: (id: number) => void;
  onChange: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  official_website: "Official Company Website", government_registry: "Government/Business Registry",
  official_business_profile: "Official Business Profile", professional_profile: "Professional Profile",
  reputable_directory: "Reputable Directory", news: "News/Publication", search_snippet: "Search Snippet",
  unknown: "Unknown",
};

export default function ReviewQueuePage({ openCompany, onChange }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const { data: items, error, reload } = usePolling(() => api.reviews(showResolved ? "ALL" : "OPEN"), 5000, [showResolved]);
  const [actionError, setActionError] = useState<string | null>(null);

  const resolve = async (item: ReviewItem, action: "choose" | "unknown" | "dismiss", index?: number) => {
    setActionError(null);
    try {
      await api.resolveReview(item.id, action, index);
      await reload();
      onChange();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>Review Queue</h1>
        <label className="row gap inline">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </header>
      <ErrorBox message={error ?? actionError} />
      {items?.length === 0 && <div className="card empty"><h3>Nothing to review</h3><p>Uncertain or conflicting records will appear here.</p></div>}

      {items?.map((item) => {
        const candidates = item.conflicting_information ?? [];
        const open = item.status === "OPEN";
        const canChoose = open && (item.field === "owner" || item.field === "website" || item.field === "company");
        return (
          <section key={item.id} className={`card review ${open ? "" : "resolved"}`}>
            <div className="row between">
              <div>
                <div className="eyebrow">{open ? "REVIEW REQUIRED" : `RESOLVED — ${item.resolution}`}</div>
                <h3><button className="link" onClick={() => openCompany(item.company_id)}>{item.company_name}</button></h3>
              </div>
              <span className="muted small">{formatDate(item.created_at)}</span>
            </div>
            <p><strong>Issue:</strong> {item.issue}</p>
            {item.recommended_action && open && <p className="muted">{item.recommended_action}</p>}

            {candidates.length > 0 && (
              <div className="grid two">
                {candidates.map((c, index) => (
                  <div key={index} className="candidate">
                    <div className="eyebrow">Candidate {index + 1}</div>
                    <div className="candidate-value">{c.value} {c.detail && item.field === "owner" && <span className="muted">— {c.detail}</span>}</div>
                    <div>Source: {SOURCE_LABELS[c.source_type] ?? c.source_type} <Confidence value={c.confidence} /></div>
                    {c.source_url && <div className="small"><a href={c.source_url} target="_blank" rel="noreferrer">{c.source_title || c.source_url}</a></div>}
                    {c.snippet && <blockquote>{c.snippet}</blockquote>}
                    {canChoose && <button className="primary" onClick={() => resolve(item, "choose", index)}>Choose {c.value}</button>}
                  </div>
                ))}
              </div>
            )}

            {open && (
              <div className="row gap">
                {(item.field === "owner" || item.field === "website") && (
                  <button onClick={() => resolve(item, "unknown")}>Mark Unknown</button>
                )}
                <button onClick={() => openCompany(item.company_id)}>Edit record manually</button>
                <button onClick={() => resolve(item, "dismiss")}>Dismiss</button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
