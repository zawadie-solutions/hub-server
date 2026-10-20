import { useState } from "react";
import { BulkUploadPanel, EmailJobPanel, type BulkField } from "../components/EmailShared";
import { ErrorBox, StatusBadge, formatDate, usePolling } from "../components/ui";
import { api } from "../services/api";
import type { DiscoveredEmail, EmailTab, EmailVerificationResult } from "../types";

const TABS: { key: EmailTab; label: string; blurb: string }[] = [
  { key: "domain_search", label: "Domain Search", blurb: "Find emails published on a company's domain." },
  { key: "find_by_company", label: "Find Email by Company", blurb: "We identify the official website, then search it." },
  { key: "find_by_name", label: "Find Email by Name", blurb: "A person's email, backed by real evidence — never guessed." },
  { key: "verify", label: "Email Verification", blurb: "Check whether an address is safe to use." },
];

const BULK_FIELDS: Record<EmailTab, BulkField[]> = {
  domain_search: [
    { key: "domain", label: "Domain", required: false, guess: ["domain", "website", "url"] },
    { key: "company_name", label: "Company Name (used if no domain)", required: false, guess: ["company", "name", "business"] },
  ],
  find_by_company: [
    { key: "company_name", label: "Company Name", required: true, guess: ["company", "name", "business"] },
    { key: "website", label: "Website (optional)", required: false, guess: ["website", "url", "domain"] },
    { key: "city", label: "City (optional)", required: false, guess: ["city", "town"] },
    { key: "state", label: "State (optional)", required: false, guess: ["state", "province"] },
  ],
  find_by_name: [
    { key: "first_name", label: "First Name", required: true, guess: ["first"] },
    { key: "last_name", label: "Last Name", required: true, guess: ["last", "surname"] },
    { key: "company_name", label: "Company (optional)", required: false, guess: ["company", "business"] },
    { key: "domain", label: "Domain (optional)", required: false, guess: ["domain", "website"] },
  ],
  verify: [{ key: "email", label: "Email Address", required: true, guess: ["email", "address"] }],
};

const CHECK_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed", not_available: "Not Available" };

function initials(row: DiscoveredEmail): string {
  if (row.full_name) {
    const parts = row.full_name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  }
  return (row.email[0] ?? row.company_name?.[0] ?? "?").toUpperCase();
}

function scoreTone(value: number | null): string {
  if (value === null || value === undefined) return "muted";
  if (value >= 85) return "good";
  if (value >= 65) return "ok";
  if (value >= 40) return "warn";
  return "bad";
}

export default function EmailResearchPage({ tab, onTabChange }: {
  tab: EmailTab; onTabChange: (tab: EmailTab) => void;
}) {
  const [showExtra, setShowExtra] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingRow, setVerifyingRow] = useState<number | null>(null);
  const [removedRows, setRemovedRows] = useState<Set<number>>(new Set());
  const [lastVerify, setLastVerify] = useState<EmailVerificationResult | null>(null);

  const [ds, setDs] = useState({ domain: "", company: "" });
  const [fc, setFc] = useState({ company: "", website: "", city: "", state: "" });
  const [fn, setFn] = useState({ first: "", last: "", company: "", domain: "" });
  const [vEmail, setVEmail] = useState("");
  const [pasted, setPasted] = useState("");

  const { data: providers } = usePolling(api.emailProviders, 15000);
  const { data: discovered, reload: reloadDiscovered } = usePolling(
    () => (tab === "verify" ? Promise.resolve([]) : api.discoveredEmails(tab)), 4000, [tab]);
  const { data: verifications, reload: reloadVerifications } = usePolling(api.emailVerifications, 4000, [tab]);

  const switchTab = (next: EmailTab) => {
    onTabChange(next);
    setShowExtra(false);
    setShowBulk(false);
    setError(null);
    setLastVerify(null);
  };

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "domain_search") {
        if (!ds.domain.trim()) return;
        await api.domainSearch(ds.domain.trim(), ds.company.trim() || undefined);
        setDs({ domain: "", company: "" });
        reloadDiscovered();
      } else if (tab === "find_by_company") {
        if (!fc.company.trim()) return;
        await api.findByCompany(fc.company.trim(), fc.website.trim() || undefined,
          fc.city.trim() || undefined, fc.state.trim() || undefined);
        setFc({ company: "", website: "", city: "", state: "" });
        reloadDiscovered();
      } else if (tab === "find_by_name") {
        if (!fn.first.trim() || !fn.last.trim()) return;
        if (!fn.company.trim() && !fn.domain.trim()) {
          setError("Add a company or domain so people who share this name can be told apart.");
          return;
        }
        await api.findByName(fn.first.trim(), fn.last.trim(), fn.company.trim() || undefined,
          fn.domain.trim() || undefined);
        setFn({ first: "", last: "", company: "", domain: "" });
        reloadDiscovered();
      } else {
        if (!vEmail.trim()) return;
        setLastVerify(await api.verifyEmail(vEmail.trim()));
        setVEmail("");
        reloadVerifications();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyPasted = async () => {
    const emails = pasted.split("\n").map((l) => l.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.startEmailJob("verify", emails.map((value) => ({ email: value })));
      setPasted("");
      reloadVerifications();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeRow = async (id: number) => {
    await api.deleteDiscoveredEmail(id);
    setRemovedRows((current) => new Set(current).add(id));
  };

  const verifyRow = async (row: DiscoveredEmail) => {
    setVerifyingRow(row.id);
    setError(null);
    try {
      await api.verifyEmail(row.email);
      reloadDiscovered();
      reloadVerifications();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifyingRow(null);
    }
  };

  const exportResults = async () => {
    if (tab === "verify") {
      const result = await api.createEmailExport("verifications", "all", true);
      window.location.href = api.emailExportUrl("verifications", result.filename);
    } else {
      const result = await api.createEmailExport("discovered", "all", true);
      window.location.href = api.emailExportUrl("discovered", result.filename);
    }
  };

  const active = TABS.find((t) => t.key === tab)!;
  const discoveryProvider = providers?.discovery.find((p) => p.name === providers.active_discovery);
  const verificationProvider = providers?.verification.find((p) => p.name === providers.active_verification);
  const jobFields = BULK_FIELDS[tab];

  return (
    <>
      <div className="hunter-hero">
        <h1>Email Research</h1>
        <p className="sub">Find and verify publicly available professional email addresses.</p>

        <div className="hunter-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 10 }}>{active.blurb}</p>

        <form onSubmit={search}>
          {tab === "domain_search" && (
            <div className="hunter-search-bar">
              <input value={ds.domain} placeholder="example.com" required
                onChange={(e) => setDs({ ...ds, domain: e.target.value })} />
              <button type="submit" className="go" disabled={busy}>Search Domain</button>
            </div>
          )}
          {tab === "find_by_company" && (
            <div className="hunter-search-bar">
              <input value={fc.company} placeholder="ABC Roofing" required
                onChange={(e) => setFc({ ...fc, company: e.target.value })} />
              <button type="submit" className="go" disabled={busy}>Find Email</button>
            </div>
          )}
          {tab === "find_by_name" && (
            <div className="hunter-search-bar">
              <input value={fn.first} placeholder="First name" required
                onChange={(e) => setFn({ ...fn, first: e.target.value })} />
              <input value={fn.last} placeholder="Last name" required
                onChange={(e) => setFn({ ...fn, last: e.target.value })} />
              <input value={fn.company} placeholder="Company name or domain (e.g. acme.com)" required={!fn.domain}
                onChange={(e) => setFn({ ...fn, company: e.target.value })} />
              <button type="submit" className="go" disabled={busy}>Find Email</button>
            </div>
          )}
          {tab === "verify" && (
            <div className="hunter-search-bar">
              <input type="email" value={vEmail} placeholder="john@example.com" required
                onChange={(e) => setVEmail(e.target.value)} />
              <button type="submit" className="go" disabled={busy}>Verify Email</button>
            </div>
          )}

          {(tab === "domain_search" || tab === "find_by_company" || tab === "find_by_name") && (
            <div className="hunter-extra-toggle">
              <button type="button" className="link" onClick={() => setShowExtra(!showExtra)}>
                {showExtra ? "− Fewer details" : "+ Add more details"}
              </button>
            </div>
          )}
          {showExtra && tab === "domain_search" && (
            <div className="hunter-extra-fields">
              <input value={ds.company} placeholder="Company name (optional, for the results table)"
                onChange={(e) => setDs({ ...ds, company: e.target.value })} />
            </div>
          )}
          {showExtra && tab === "find_by_company" && (
            <div className="hunter-extra-fields">
              <input value={fc.website} placeholder="Website (optional)" onChange={(e) => setFc({ ...fc, website: e.target.value })} />
              <input value={fc.city} placeholder="City" onChange={(e) => setFc({ ...fc, city: e.target.value })} />
              <input value={fc.state} placeholder="State" onChange={(e) => setFc({ ...fc, state: e.target.value })} />
            </div>
          )}
          {showExtra && tab === "find_by_name" && (
            <div className="hunter-extra-fields">
              <input value={fn.domain} placeholder="Domain (used instead of/with company)"
                onChange={(e) => setFn({ ...fn, domain: e.target.value })} />
            </div>
          )}
        </form>

        <div className="hunter-provider-row">
          {tab !== "verify" && providers && (
            <span className={`hunter-pill ${providers.active_discovery_demo ? "demo" : "live"}`}>
              <span className="dot" />
              {providers.active_discovery_demo ? "Demo data" : "Live"} · {discoveryProvider?.label ?? providers.active_discovery}
            </span>
          )}
          {tab === "verify" && providers && (
            <span className={`hunter-pill ${verificationProvider?.is_demo ? "demo" : "live"}`}>
              <span className="dot" />{verificationProvider?.label ?? providers.active_verification}
            </span>
          )}
          <button type="button" className="link" onClick={() => setShowBulk(!showBulk)}>
            {showBulk ? "− Hide bulk upload" : "Bulk upload a list instead →"}
          </button>
        </div>
      </div>

      <ErrorBox message={error} />

      {showBulk && (
        <section className="card">
          <h3>Bulk {active.label.toLowerCase()}</h3>
          {tab === "verify" && (
            <div className="stack" style={{ marginBottom: 16 }}>
              <label>Paste emails, one per line
                <textarea rows={4} value={pasted} placeholder={"john@example.com\njane@example.com"}
                  onChange={(e) => setPasted(e.target.value)} />
              </label>
              <button disabled={busy || !pasted.trim()} onClick={verifyPasted}>Verify pasted list</button>
              <p className="muted small">Or upload a file and pick the email column:</p>
            </div>
          )}
          <BulkUploadPanel kind={tab} fields={jobFields} onStarted={() => { reloadDiscovered(); reloadVerifications(); }} />
        </section>
      )}

      <EmailJobPanel kind={tab} onDone={() => { reloadDiscovered(); reloadVerifications(); }} />

      {tab === "verify" ? (
        <>
          {lastVerify && (
            <section className="card">
              <div className="row between">
                <div>
                  <div className="eyebrow">{lastVerify.email}</div>
                  <h3 style={{ marginTop: 4 }}><StatusBadge status={lastVerify.status} /></h3>
                </div>
                <span className="muted small">{lastVerify.provider} · {formatDate(lastVerify.verified_at)}</span>
              </div>
              <div className="grid three checks-grid">
                {(["syntax_check", "domain_check", "mx_check", "mailbox_check"] as const).map((field) => (
                  <div key={field} className="check-item">
                    <span className="muted small">{field.replace("_check", "").replace(/^\w/, (c) => c.toUpperCase())}</span>
                    <span className={`badge ${lastVerify[field] === "passed" ? "good" : lastVerify[field] === "failed" ? "bad" : "muted"}`}>
                      {CHECK_LABEL[lastVerify[field]] ?? lastVerify[field]}
                    </span>
                  </div>
                ))}
                <div className="check-item"><span className="muted small">Disposable</span>
                  <span className={`badge ${lastVerify.disposable_status === "disposable" ? "bad" : "muted"}`}>
                    {lastVerify.disposable_status.replace(/_/g, " ")}</span></div>
                <div className="check-item"><span className="muted small">Role-Based</span>
                  <span className={`badge ${lastVerify.role_based_status === "role_based" ? "info" : "muted"}`}>
                    {lastVerify.role_based_status.replace(/_/g, " ")}</span></div>
                <div className="check-item"><span className="muted small">Catch-All</span>
                  <span className={`badge ${lastVerify.catch_all_status === "catch_all" ? "ok" : "muted"}`}>
                    {lastVerify.catch_all_status.replace(/_/g, " ")}</span></div>
              </div>
              {lastVerify.error && <p className="muted small" style={{ marginTop: 10 }}>{lastVerify.error}</p>}
            </section>
          )}

          <section className="card flush">
            <div className="row between" style={{ padding: "16px 16px 0" }}>
              <h3>Verification results</h3>
              <button disabled={!verifications?.length} onClick={exportResults}>Export Excel</button>
            </div>
            <table>
              <thead><tr><th>Email</th><th>Status</th><th>Syntax</th><th>MX</th><th>Mailbox</th><th>Provider</th><th>Date</th></tr></thead>
              <tbody>
                {(verifications ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="small">{CHECK_LABEL[row.syntax_check] ?? row.syntax_check}</td>
                    <td className="small">{CHECK_LABEL[row.mx_check] ?? row.mx_check}</td>
                    <td className="small">{CHECK_LABEL[row.mailbox_check] ?? row.mailbox_check}</td>
                    <td className="small">{row.provider}</td>
                    <td className="small nowrap">{formatDate(row.verified_at)}</td>
                  </tr>
                ))}
                {(verifications ?? []).length === 0 && <tr><td colSpan={7} className="empty-row">No verification results yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section className="card">
          <div className="row between">
            <h3>Results</h3>
            <button disabled={!discovered?.length} onClick={exportResults}>Export Excel</button>
          </div>
          {!discovered?.length ? <p className="muted">No results yet — try a search above.</p> : (
            <div className="hunter-list">
              {discovered.filter((row) => !removedRows.has(row.id)).map((row) => (
                <div key={row.id} className="hunter-row">
                  <div className="hunter-avatar">{initials(row)}</div>
                  <div className="hunter-row-main">
                    <div className="hunter-row-name">
                      {row.full_name || row.company_name || <span className="muted">Unknown</span>}
                      {row.title && <span className="muted"> — {row.title}</span>}
                    </div>
                    {row.email ? (
                      <a className="hunter-row-email" href={`mailto:${row.email}`}>{row.email}</a>
                    ) : (
                      <span className="muted">{row.status === "NOT_FOUND" ? "Not Found" : "Needs Review"}</span>
                    )}
                    {row.domain && <span className="muted small"> · {row.domain}</span>}
                  </div>
                  <div className="hunter-row-meta">
                    {row.verification_status && <StatusBadge status={row.verification_status} />}
                    {row.email && (
                      <button className="small" disabled={verifyingRow === row.id} onClick={() => verifyRow(row)}>
                        {verifyingRow === row.id ? "…" : row.verification_status ? "Re-verify" : "Verify"}
                      </button>
                    )}
                    <div className={`hunter-score ${scoreTone(row.confidence)}`} title="Confidence">
                      {row.confidence ? Math.round(row.confidence) : "—"}
                    </div>
                    <button className="small" title="Remove" onClick={() => removeRow(row.id)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
