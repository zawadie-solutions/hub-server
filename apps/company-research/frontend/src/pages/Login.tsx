import { useState } from "react";

const FEATURES = [
  "Research companies, owners and decision-makers from public sources",
  "Domain Search, Find Email by Company and Find Email by Name",
  "Built-in email verification — syntax, domain, MX, disposable & role-based checks",
  "Import, review and export everything to Excel",
];

/**
 * A sign-in screen for this local, single-user tool. It is a style choice, not real security:
 * the app has no account system or backend auth — any input is accepted, and the "session" is
 * just a flag in this browser's localStorage so the screen doesn't reappear every reload.
 * Nothing here protects your data; anyone with access to this machine (or this URL, if you ever
 * expose it beyond localhost) can already reach the app underneath.
 */
export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter an email address to continue.");
      return;
    }
    setSubmitting(true);
    // Nothing to check against — this is a cosmetic gate for a local, single-user tool.
    window.setTimeout(() => onLogin(), 220);
  };

  return (
    <div className="login-screen">
      <aside className="login-aside">
        <div className="login-aside-top">
          <span className="mark">C</span>
          <span className="word">Company Research</span>
        </div>
        <div className="login-aside-body">
          <h2>Research leads and find verified emails, all in one place.</h2>
          <p>Evidence-backed company research, owner and contact discovery, and email
            verification — built to never fabricate a name, phone number or email.</p>
          <ul className="login-features">
            {FEATURES.map((feature) => (
              <li key={feature}>
                <span className="tick">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path
                    d="M13.5 4.5l-7 7L3 8" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
        <p className="login-aside-foot">Runs entirely on your own machine — your data never leaves it.</p>
      </aside>

      <div className="login-form-side">
        <div className="login-card">
          <h1>{mode === "signin" ? "Sign in" : "Create your account"}</h1>
          <p className="sub">
            {mode === "signin"
              ? "Welcome back — enter your details to continue."
              : "Takes a second — this runs locally, so there's nothing to verify."}
          </p>

          {error && <div className="login-error">{error}</div>}

          <button type="button" className="login-oauth" onClick={onLogin}>
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.71H.95v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>
          <div className="login-divider">or continue with email</div>

          <form onSubmit={submit} className="stack" style={{ gap: 0 }}>
            <label>Work email
              <input type="email" placeholder="you@company.com" value={email} autoFocus autoComplete="username"
                onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <div className="label-row">
                <span>Password</span>
                {mode === "signin" && <a href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>}
              </div>
              <div className="login-input-wrap">
                <input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="login-eye" tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A10.4 10.4 0 0112 5c5.5 0 9.5 4 11 7-.6 1.3-1.6 2.7-3 4m-3.2 2.1A10.6 10.6 0 0112 19c-5.5 0-9.5-4-11-7 .7-1.5 1.9-3.1 3.5-4.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
            {mode === "signin" && (
              <label className="login-remember">
                <input type="checkbox" defaultChecked /> Keep me signed in on this device
              </label>
            )}
            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? "Signing in…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="login-switch">
            {mode === "signin" ? (
              <>Don't have an account? <button className="link" onClick={() => setMode("signup")}>Sign up free</button></>
            ) : (
              <>Already have an account? <button className="link" onClick={() => setMode("signin")}>Sign in</button></>
            )}
          </div>
          <p className="login-foot">
            Runs on your machine — no account is actually created or checked, and nothing you type here is sent anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
