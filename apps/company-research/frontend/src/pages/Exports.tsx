import { useState } from "react";
import { ErrorBox, formatDate, usePolling } from "../components/ui";
import { api } from "../services/api";

export default function ExportsPage() {
  const { data: files, error, reload } = usePolling(api.exports);
  const [scope, setScope] = useState("all");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await api.createExport(scope, includeDemo);
      setMessage(`Exported ${result.rows} companies to ${result.filename}.`);
      await reload();
      window.location.href = api.exportUrl(result.filename);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (filename: string) => {
    try {
      await api.deleteExport(filename);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <>
      <header className="page-head"><h1>Exports</h1></header>
      <ErrorBox message={error ?? actionError} />
      {message && <div className="alert success">{message}</div>}

      <section className="card">
        <h3>Export to Excel</h3>
        <div className="row gap wrap">
          <label>Companies to include
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All companies</option>
              <option value="researched">Researched only (completed + needs review)</option>
              <option value="verified">Completed and verified/likely only</option>
            </select>
          </label>
          <label className="row gap inline">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
            Include DEMO DATA rows
          </label>
          <button className="primary" disabled={busy} onClick={create}>{busy ? "Exporting…" : "Export Excel"}</button>
        </div>
        <p className="muted small">The .xlsx has bold frozen headers, filters, clickable emails/links and colour-coded status and confidence.</p>
      </section>

      <section className="card flush">
        <table>
          <thead><tr><th>File</th><th>Created</th><th>Size</th><th /></tr></thead>
          <tbody>
            {files?.map((f) => (
              <tr key={f.filename}>
                <td><a href={api.exportUrl(f.filename)}>{f.filename}</a></td>
                <td>{formatDate(f.created_at)}</td>
                <td>{Math.max(1, Math.round(f.size / 1024))} KB</td>
                <td className="right"><button className="danger small" onClick={() => remove(f.filename)}>Delete</button></td>
              </tr>
            ))}
            {files?.length === 0 && <tr><td colSpan={4} className="empty-row">No exports yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
