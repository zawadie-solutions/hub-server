import { Fragment, useEffect, useState } from "react";
import logo from "./assets/zawadie-logo.png";
import { usePolling } from "./components/ui";
import CompaniesPage from "./pages/Companies";
import DashboardPage from "./pages/Dashboard";
import EmailResearchPage from "./pages/EmailResearch";
import ExportsPage from "./pages/Exports";
import LoginPage from "./pages/Login";
import ResearchPage from "./pages/Research";
import ReviewQueuePage from "./pages/ReviewQueue";
import SearchResultsPage from "./pages/SearchResults";
import SettingsPage from "./pages/Settings";
import { api } from "./services/api";
import type { EmailTab, Page } from "./types";

const NAV: { page: Page; label: string; group?: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "companies", label: "Companies" },
  { page: "research", label: "Research" },
  { page: "review", label: "Review Queue" },
  { page: "results", label: "Search Results" },
  { page: "email-research", label: "Email Research", group: "Email Research" },
  { page: "exports", label: "Exports" },
  { page: "settings", label: "Settings" },
];

const EMAIL_TAB_KEYS: EmailTab[] = ["domain_search", "find_by_company", "find_by_name", "verify"];
const LOGIN_FLAG = "crt_logged_in";

function readHash(): { page: Page; companyId: number | null; emailTab: EmailTab } {
  const [name, sub] = window.location.hash.replace(/^#\/?/, "").split("/");
  const page = NAV.some((item) => item.page === name) ? (name as Page) : "dashboard";
  const companyId = page === "companies" && /^\d+$/.test(sub ?? "") ? Number(sub) : null;
  const emailTab = (EMAIL_TAB_KEYS as string[]).includes(sub ?? "") ? (sub as EmailTab) : "domain_search";
  return { page, companyId, emailTab };
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem(LOGIN_FLAG) === "1");
  // Set when opened through the Zawadie Solutions Hub: the hub has already signed the user in,
  // so its login replaces this app's own (see backend/hub_sso.py). undefined = still checking.
  const [hubUser, setHubUser] = useState<string | null | undefined>(undefined);
  const signedIn = loggedIn || !!hubUser;
  const [{ page, companyId, emailTab }, setRoute] = useState(readHash);
  const { data: summary, reload } = usePolling(api.dashboard, signedIn ? 4000 : 0);
  const { data: job } = usePolling(api.jobStatus, signedIn ? 2000 : 0);

  useEffect(() => {
    api.session().then((s) => setHubUser(s.hub_user), () => setHubUser(null));
  }, []);

  // The URL hash is the source of truth, so refresh and the browser Back button work.
  useEffect(() => {
    const onHashChange = () => setRoute(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!signedIn) {
    if (hubUser === undefined) return null; // don't flash the login screen at a hub user
    return <LoginPage onLogin={() => {
      try { localStorage.setItem(LOGIN_FLAG, "1"); } catch { /* private window etc. */ }
      setLoggedIn(true);
    }} />;
  }

  const go = (next: Page) => {
    window.location.hash = next;
    reload();
  };
  const setCompanyId = (id: number | null) => {
    window.location.hash = id === null ? "companies" : `companies/${id}`;
  };
  const openCompany = (id: number) => setCompanyId(id);
  const setEmailTab = (tab: EmailTab) => { window.location.hash = `email-research/${tab}`; };
  const logOut = () => {
    if (hubUser) {
      // Signed in by the hub, so sign out of the hub (its POST /logout at the site root).
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/logout";
      document.body.appendChild(form);
      form.submit();
      return;
    }
    try { localStorage.removeItem(LOGIN_FLAG); } catch { /* ignore */ }
    setLoggedIn(false);
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand"><img src={logo} alt="Zawadie" />Lead Generation</div>
        <button className="primary new-research" onClick={() => go("research")}>+ New Research</button>
        <nav>
          {NAV.map(({ page: target, label, group }, index) => (
            <Fragment key={target}>
              {group && NAV[index - 1]?.group !== group && <div className="nav-group">{group}</div>}
              <button className={page === target ? "active" : ""} onClick={() => go(target)}>
                {label}
                {target === "review" && !!summary?.open_reviews && <span className="count">{summary.open_reviews}</span>}
                {target === "research" && job && job.state !== "idle" && <span className={`dot ${job.state}`} />}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>{summary?.demo_mode ? "Demo mode" : "Live search"}</div>
          {hubUser && <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>{hubUser}</div>}
          <button className="link" onClick={logOut}>Log out</button>
        </div>
      </aside>

      <main>
        {summary?.demo_mode && (
          <div className="demo-banner">
            <strong>DEMO MODE — No live web searches are being performed.</strong>{" "}
            Results are simulated and labelled DEMO DATA. Add an API key in{" "}
            <button className="link" onClick={() => go("settings")}>Settings</button> to research real companies.
          </div>
        )}
        {page === "dashboard" && <DashboardPage go={go} openCompany={openCompany} />}
        {page === "companies" && (
          <CompaniesPage companyId={companyId} setCompanyId={setCompanyId} go={go} />
        )}
        {page === "research" && <ResearchPage go={go} openCompany={openCompany} />}
        {page === "review" && <ReviewQueuePage openCompany={openCompany} onChange={reload} />}
        {page === "results" && <SearchResultsPage openCompany={openCompany} />}
        {page === "email-research" && <EmailResearchPage tab={emailTab} onTabChange={setEmailTab} />}
        {page === "exports" && <ExportsPage />}
        {page === "settings" && <SettingsPage onSaved={reload} />}
      </main>
    </div>
  );
}
