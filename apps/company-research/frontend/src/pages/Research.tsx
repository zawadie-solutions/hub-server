import { useRef, useState } from "react";
import { Confidence, ErrorBox, StatusBadge, usePolling } from "../components/ui";
import { api } from "../services/api";
import type { ImportSummary, Page, Step } from "../types";

interface Props {
  go: (page: Page) => void;
  openCompany: (id: number) => void;
}

const STEP_ICON: Record<Step["state"], string> = { done: "✓", running: "⟳", pending: "○", failed: "✕", skipped: "–" };

export default function ResearchPage({ go, openCompany }: Props) {
  const { data: job, setData: setJob, error: jobError } = usePolling(api.jobStatus, 1000);
  const { data: summary, reload: reloadSummary } = usePolling(api.dashboard, 3000);
  const { data: settings, setData: setSettings } = usePolling(api.settings);
  const [form, setForm] = useState({ company_name: "", city: "", state: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const attempt = async (action: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await action();
      reloadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addCompany = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.company_name.trim()) return;
    attempt(async () => {
      const result = await api.createCompany(form);
      if (result.created) {
        setMessage(`Added “${result.company.company_name}”. Press START RESEARCH when you are ready.`);
        setForm({ company_name: "", city: "", state: "" });
      } else {
        setError(`“${form.company_name}” is already in the list (${result.reason}).`);
      }
    });
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    attempt(async () => {
      setImported(await api.importFile(file));
      if (fileInput.current) fileInput.current.value = "";
    });
  };

  const changeProvider = (name: string) => {
    if (!settings) return;
    attempt(async () => {
      const enabled = Object.fromEntries(settings.providers.map((p) => [p.name, p.enabled || p.name === name]));
      setSettings(await api.saveSettings(settings.settings, {
        default_provider: name, secondary_provider: settings.secondary_provider, enabled,
      }));
    });
  };

  const control = (action: () => Promise<typeof job>) => attempt(async () => { setJob(await action()); });

  const state = job?.state ?? "idle";
  const pending = summary?.pending ?? 0;
  const percent = job?.total ? Math.round((job.completed / job.total) * 100) : 0;
  const selected = settings?.providers.find((p) => p.name === settings.default_provider);
  const chainLabels = settings?.active_chain.map((n) => settings.providers.find((p) => p.name === n)?.label ?? n);

  return (
    <>
      <header className="page-head"><h1>Research</h1></header>
      <ErrorBox message={error ?? jobError} />
      {message && <div className="alert success">{message}</div>}

      <div className="grid two">
        <section className="card">
          <h3>1. Add companies</h3>
          <form onSubmit={addCompany} className="stack">
            <label>Company name
              <input value={form.company_name} placeholder="ABC Roofing" required
                onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
            </label>
            <div className="row gap">
              <label className="grow">City <span className="muted">(optional)</span>
                <input value={form.city} placeholder="Portland" onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </label>
              <label className="grow">State <span className="muted">(optional)</span>
                <input value={form.state} placeholder="Oregon" onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </label>
            </div>
            <button type="submit" disabled={busy}>Add company</button>
          </form>

          <hr />
          <label>Or upload an Excel / CSV list
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv" disabled={busy}
              onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          <p className="muted small">
            Columns: <code>Company Name</code>, and optionally <code>City</code>, <code>State</code>, <code>Country</code>, <code>Website</code>.{" "}
            <a href={api.sampleInputUrl}>Download example file</a>
          </p>
          {imported && (
            <div className="alert success">
              Imported {imported.imported} of {imported.rows} rows.
              {imported.duplicates.length > 0 && (
                <> Skipped {imported.duplicates.length} duplicate(s): {imported.duplicates.map((d) => d.company_name).join(", ")}.</>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h3>2. Search provider</h3>
          {settings && (
            <>
              <label>Primary provider
                <select value={settings.default_provider} disabled={busy || state !== "idle"}
                  onChange={(e) => changeProvider(e.target.value)}>
                  {settings.providers.map((p) => (
                    <option key={p.name} value={p.name}>{p.label}{!p.configured ? " — no API key" : ""}</option>
                  ))}
                </select>
              </label>
              {settings.demo_mode ? (
                <div className="alert demo">
                  <strong>DEMO MODE — No live web searches are being performed.</strong>
                  {selected && !selected.is_demo && <> {selected.label} has no API key, so simulated data will be used.</>}
                </div>
              ) : (
                <p className="small">Live search order: <strong>{chainLabels?.join(" → ")}</strong> (automatic fallback on errors).</p>
              )}
              <p className="muted small">
                Up to {settings.settings.max_queries_per_company} queries per company · {settings.settings.request_delay_seconds}s between requests ·{" "}
                {settings.settings.max_concurrent_searches} at a time. <button className="link" onClick={() => go("settings")}>Change in Settings</button>
              </p>
            </>
          )}

          <h3>3. Run</h3>
          <div className="row gap controls">
            {state === "idle" && (
              <button className="primary big" disabled={busy || pending === 0} onClick={() => control(() => api.startResearch())}>
                START RESEARCH{pending ? ` (${pending})` : ""}
              </button>
            )}
            {state === "running" && <button className="big" onClick={() => control(api.pauseResearch)}>PAUSE</button>}
            {state === "paused" && <button className="primary big" onClick={() => control(api.resumeResearch)}>RESUME</button>}
            {(state === "running" || state === "paused") && (
              <button className="danger big" onClick={() => control(api.stopResearch)}>STOP</button>
            )}
            {state === "stopping" && <span className="muted">Stopping…</span>}
          </div>
          {state === "idle" && pending === 0 && <p className="muted small">No companies are waiting. Add or upload some first.</p>}
          {job?.restored && (
            <div className="alert warn">
              An unfinished research job was found ({job.total} companies left). Press RESUME to continue where it stopped, or STOP to cancel it.
            </div>
          )}
        </section>
      </div>

      {job && job.total > 0 && (
        <section className="card">
          <div className="row between">
            <h3>
              {state === "idle" ? "Last run finished" : state === "paused" ? "Paused" : "Researching"}{" "}
              {Math.min(job.completed + (state === "running" ? job.current.length : 0), job.total)} / {job.total}
            </h3>
            <span className="muted">{job.completed} done · {job.failed} failed · {job.remaining} remaining{job.demo_mode ? " · DEMO DATA" : ""}</span>
          </div>
          <div className="progress"><div style={{ width: `${percent}%` }} /></div>

          <div className="grid three">
            {job.current.map((item) => (
              <div key={item.company_id} className="progress-card">
                <strong>{item.company_name}</strong>
                <ul className="steps">
                  {item.steps.map((step) => (
                    <li key={step.key} className={step.state}>
                      <span className="icon">{STEP_ICON[step.state]}</span>
                      {step.label}
                      {step.detail && <span className="muted small"> — {step.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {job.recent.length > 0 && (
            <table>
              <thead><tr><th>Finished</th><th>Owner</th><th>Status</th><th>Confidence</th></tr></thead>
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
          )}

          {job.events.some((e) => e.kind !== "search_ok") && (
            <details>
              <summary>Provider events (retries, rate limits, fallbacks)</summary>
              <ul className="events">
                {job.events.filter((e) => e.kind !== "search_ok").map((e, i) => (
                  <li key={i}><code>{e.kind}</code> {e.provider}: {e.detail}</li>
                ))}
              </ul>
            </details>
          )}
          {state === "idle" && summary && summary.open_reviews > 0 && (
            <p>{summary.open_reviews} record(s) need a human decision. <button className="link" onClick={() => go("review")}>Open Review Queue</button></p>
          )}
          {state === "idle" && <p><button className="link" onClick={() => go("exports")}>Export results to Excel</button></p>}
        </section>
      )}
    </>
  );
}
