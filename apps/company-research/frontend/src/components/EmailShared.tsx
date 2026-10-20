import { useState } from "react";
import { api } from "../services/api";
import type { EmailJobKind, EmailJobStatus } from "../types";
import { ErrorBox, usePolling } from "./ui";

// ------------------------------------------------------------------------- job panel
const STEP_LABELS: Record<EmailJobKind, string> = {
  domain_search: "Domain search", find_by_company: "Find Email by Company",
  find_by_name: "Find Email by Name", verify: "Email verification",
};

export function EmailJobPanel({ kind, onDone }: { kind: EmailJobKind; onDone?: () => void }) {
  const { data: job, setData } = usePolling(api.emailJobStatus, 1000);
  const [error, setError] = useState<string | null>(null);

  if (!job || job.state === "idle") return null;
  const mine = job.kind === kind;

  const control = async (action: () => Promise<EmailJobStatus>) => {
    setError(null);
    try {
      const next = await action();
      setData(next);
      if (next.state === "idle") onDone?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!mine) {
    return (
      <div className="alert warn">
        A {STEP_LABELS[job.kind as EmailJobKind] ?? job.kind} job is currently {job.state} ({job.completed}/{job.total}).
        Only one bulk email job can run at a time.
      </div>
    );
  }

  const percent = job.total ? Math.round((job.completed / job.total) * 100) : 0;
  return (
    <div className="card">
      <ErrorBox message={error} />
      <div className="row between">
        <h3>{job.state === "paused" ? "Paused" : "Running"}: {job.completed} / {job.total}
          {job.deduplicated ? <span className="muted"> ({job.deduplicated} duplicate(s) skipped)</span> : null}
        </h3>
        <div className="row gap">
          {job.state === "running" && <button onClick={() => control(api.pauseEmailJob)}>PAUSE</button>}
          {job.state === "paused" && <button className="primary" onClick={() => control(api.resumeEmailJob)}>RESUME</button>}
          <button className="danger" onClick={() => control(api.stopEmailJob)}>STOP</button>
        </div>
      </div>
      <div className="progress"><div style={{ width: `${percent}%` }} /></div>
      <p className="muted small">
        {job.failed > 0 && <>{job.failed} failed · </>}
        via {job.provider_used}{job.is_demo ? " (DEMO DATA)" : ""}
        {job.current_item && <> · now: {job.current_item.email || job.current_item.domain || job.current_item.company_name || "…"}</>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------- bulk upload
export interface BulkField {
  key: string;
  label: string;
  required: boolean;
  guess: string[];   // lower-cased header fragments to auto-match
}

export function BulkUploadPanel({ kind, fields, onStarted }: {
  kind: EmailJobKind; fields: BulkField[]; onStarted: () => void;
}) {
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const parsed = await api.emailUpload(file);
      setTable(parsed);
      const guessed: Record<string, string> = {};
      fields.forEach((field) => {
        const index = parsed.headers.findIndex((h) =>
          field.guess.some((g) => h.toLowerCase().includes(g)));
        if (index >= 0) guessed[field.key] = String(index);
      });
      setMapping(guessed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const missing = fields.filter((f) => f.required && !mapping[f.key]);

  const start = async () => {
    if (!table) return;
    setError(null);
    setBusy(true);
    try {
      const items = table.rows.map((row) => {
        const item: Record<string, string> = {};
        fields.forEach((field) => {
          const index = mapping[field.key];
          if (index !== undefined && index !== "") item[field.key] = row[Number(index)] ?? "";
        });
        return item;
      }).filter((item) => fields.filter((f) => f.required).every((f) => item[f.key]));
      if (items.length === 0) throw new Error("No rows had values in all the required columns.");
      await api.startEmailJob(kind, items);
      setTable(null);
      setMapping({});
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <ErrorBox message={error} />
      <label>Upload Excel / CSV
        <input type="file" accept=".xlsx,.xlsm,.csv" disabled={busy}
          onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {table && (
        <>
          <p className="muted small">{table.rows.length} row(s) found. Match each column to a field:</p>
          <div className="grid two">
            {fields.map((field) => (
              <label key={field.key}>{field.label}{field.required && " *"}
                <select value={mapping[field.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}>
                  <option value="">— not mapped —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy || missing.length > 0} onClick={start}>
            Start bulk job ({table.rows.length} rows)
          </button>
          {missing.length > 0 && <p className="muted small">Map a column for: {missing.map((f) => f.label).join(", ")}</p>}
        </>
      )}
    </div>
  );
}
