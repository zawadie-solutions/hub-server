import { useEffect, useState } from "react";
import { ErrorBox } from "../components/ui";
import { api } from "../services/api";
import type { AppSettings, EmailProvidersResponse, SettingsResponse } from "../types";

const NUMBER_FIELDS: [keyof AppSettings, string, string, number, number, number][] = [
  ["max_queries_per_company", "Maximum queries per company", "", 1, 100, 1],
  ["max_results_per_query", "Maximum results per query", "", 1, 20, 1],
  ["request_delay_seconds", "Request delay", "seconds between requests", 0, 60, 0.5],
  ["max_retries", "Maximum retries", "per provider, with exponential backoff", 0, 10, 1],
  ["max_concurrent_searches", "Maximum concurrent searches", "", 1, 10, 1],
];

const THRESHOLDS: [keyof AppSettings["thresholds"], string][] = [
  ["verified", "VERIFIED at or above"],
  ["likely", "LIKELY at or above"],
  ["uncertain", "UNCERTAIN at or above"],
  ["conflict_min_score", "Conflict: rival source score at or above"],
];

export default function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const [server, setServer] = useState<SettingsResponse | null>(null);
  const [emailProviders, setEmailProviders] = useState<EmailProvidersResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = (response: SettingsResponse) => {
    setServer(response);
    setSettings(response.settings);
    setPrimary(response.default_provider);
    setSecondary(response.secondary_provider ?? "");
    setEnabled(Object.fromEntries(response.providers.map((p) => [p.name, p.enabled])));
  };

  useEffect(() => {
    api.settings().then(apply).catch((e: Error) => setError(e.message));
    api.emailProviders().then(setEmailProviders).catch(() => undefined);
  }, []);

  if (!server || !settings) return <><h1>Settings</h1><ErrorBox message={error} /></>;

  const attempt = async (action: () => Promise<SettingsResponse>, done: string) => {
    setError(null);
    setMessage(null);
    try {
      apply(await action());
      setMessage(done);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = () => attempt(async () => {
    const filled = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()));
    if (Object.keys(filled).length) await api.saveKeys(filled);
    setKeys({});
    const result = await api.saveSettings(settings, { default_provider: primary, secondary_provider: secondary || null, enabled });
    api.emailProviders().then(setEmailProviders).catch(() => undefined);
    return result;
  }, "Settings saved.");

  const removeKey = (name: string) => attempt(async () => {
    const result = await api.deleteKey(name);
    api.emailProviders().then(setEmailProviders).catch(() => undefined);
    return result;
  }, `${name} removed.`);

  const setNumber = (field: keyof AppSettings, value: string) =>
    setSettings({ ...settings, [field]: value === "" ? 0 : Number(value) });

  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
        <button className="primary" onClick={save}>Save settings</button>
      </header>
      <ErrorBox message={error} />
      {message && <div className="alert success">{message}</div>}

      <section className="card">
        <h3>Search provider</h3>
        {server.demo_mode ? (
          <div className="alert demo"><strong>DEMO MODE — No live web searches are being performed.</strong> Add an API key below and select that provider to go live.</div>
        ) : (
          <p>Live search order: <strong>{server.active_chain.join(" → ")}</strong></p>
        )}
        <div className="row gap wrap">
          <label>Primary search provider
            <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              {server.providers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
            </select>
          </label>
          <label>Secondary (fallback) provider
            <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              <option value="">None</option>
              {server.providers.filter((p) => !p.is_demo).map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
            </select>
          </label>
        </div>

        <table className="providers">
          <thead><tr><th>Provider</th><th>Status</th><th>Use as extra fallback</th><th>API credentials (stored in .env only)</th></tr></thead>
          <tbody>
            {server.providers.map((p) => (
              <tr key={p.name}>
                <td><strong>{p.label}</strong></td>
                <td>{p.is_demo ? <span className="badge demo">Simulated</span>
                  : p.configured ? <span className="badge good">Configured</span>
                    : <span className="badge muted">No API key</span>}</td>
                <td>
                  {!p.is_demo && (
                    <input type="checkbox" checked={!!enabled[p.name]} aria-label={`Enable ${p.label}`}
                      onChange={(e) => setEnabled({ ...enabled, [p.name]: e.target.checked })} />
                  )}
                </td>
                <td>
                  {p.required_env.map((name) => (
                    <div key={name} className="row gap key-row">
                      <code>{name}</code>
                      <input type="password" autoComplete="off" value={keys[name] ?? ""}
                        placeholder={p.env_set[name] ? "•••••••• saved — type to replace" : "not set"}
                        onChange={(e) => setKeys({ ...keys, [name]: e.target.value })} />
                      {p.env_set[name] && (
                        <button className="small" onClick={() => attempt(() => api.deleteKey(name), `${name} removed.`)}>Remove</button>
                      )}
                    </div>
                  ))}
                  {p.is_demo && <span className="muted">No key needed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Keys are written to the local <code>.env</code> file and are never shown again or sent anywhere except the provider's own API.
          The mock provider is never mixed into a live run.
        </p>
      </section>

      {emailProviders && (
        <section className="card">
          <h3>Email research providers</h3>
          <p className="muted small">
            Domain Search / Find Email by Company / Find Email by Name currently use{" "}
            <strong>{emailProviders.discovery.find((p) => p.name === emailProviders.active_discovery)?.label}</strong>
            {emailProviders.active_discovery_demo && " (DEMO DATA — add a key below or configure a live search provider above)"}.
            {" "}Email Verification currently uses{" "}
            <strong>{emailProviders.verification.find((p) => p.name === emailProviders.active_verification)?.label}</strong>.
          </p>
          <table className="providers">
            <thead><tr><th>Provider</th><th>Used for</th><th>Status</th><th>API credentials (stored in .env only)</th></tr></thead>
            <tbody>
              {[...emailProviders.discovery.filter((p) => p.name !== "mock" && p.name !== "web_search"),
                ...emailProviders.verification.filter((p) => !["mock", "builtin"].includes(p.name)
                  && !emailProviders.discovery.some((d) => d.name === p.name))].map((p) => {
                const usedFor = [
                  emailProviders.discovery.some((d) => d.name === p.name) && "Discovery",
                  emailProviders.verification.some((v) => v.name === p.name) && "Verification",
                ].filter(Boolean).join(" + ");
                return (
                  <tr key={p.name}>
                    <td><strong>{p.label}</strong></td>
                    <td>{usedFor}</td>
                    <td>{p.configured ? <span className="badge good">Configured</span>
                      : <span className="badge muted">No API key</span>}</td>
                    <td>
                      {p.required_env.map((name) => (
                        <div key={name} className="row gap key-row">
                          <code>{name}</code>
                          <input type="password" autoComplete="off" value={keys[name] ?? ""}
                            placeholder={p.env_set[name] ? "•••••••• saved — type to replace" : "not set"}
                            onChange={(e) => setKeys({ ...keys, [name]: e.target.value })} />
                          {p.env_set[name] && <button className="small" onClick={() => removeKey(name)}>Remove</button>}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td><strong>Built-in verifier</strong></td>
                <td>Verification</td>
                <td><span className="badge good">Always available</span></td>
                <td><span className="muted">No key needed — syntax, domain, DNS MX, disposable &amp; role-based checks only (no mailbox check)</span></td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <div className="grid two">
        <section className="card">
          <h3>Search limits</h3>
          <div className="stack">
            {NUMBER_FIELDS.map(([field, label, hint, min, max, step]) => (
              <label key={field}>{label} {hint && <span className="muted">({hint})</span>}
                <input type="number" min={min} max={max} step={step} value={settings[field] as number}
                  onChange={(e) => setNumber(field, e.target.value)} />
              </label>
            ))}
            <label className="row gap inline">
              <input type="checkbox" checked={settings.fetch_official_pages}
                onChange={(e) => setSettings({ ...settings, fetch_official_pages: e.target.checked })} />
              Read the company's own website pages (home/about/contact), respecting robots.txt
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Source reliability scores</h3>
          <div className="stack">
            {Object.entries(server.source_labels).map(([key, label]) => (
              <label key={key} className="row between inline">{label}
                <input className="narrow" type="number" min={0} max={100} value={settings.source_scores[key] ?? 0}
                  onChange={(e) => setSettings({ ...settings, source_scores: { ...settings.source_scores, [key]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <h3>Confidence thresholds</h3>
          <div className="stack">
            {THRESHOLDS.map(([key, label]) => (
              <label key={key} className="row between inline">{label}
                <input className="narrow" type="number" min={1} max={100} value={settings.thresholds[key]}
                  onChange={(e) => setSettings({ ...settings, thresholds: { ...settings.thresholds, [key]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
