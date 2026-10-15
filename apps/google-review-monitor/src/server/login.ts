const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The sign-in page. A plain form post, so it works without scripts; the only script applies
 * the saved light/dark theme. Same colours and typeface as the dashboard.
 */
export function loginHtml(opts: { error?: string; user?: string } = {}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Google Review Monitor</title>
<link rel="icon" type="image/png" href="logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>try{if(localStorage.getItem('theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>
<style>
  :root{
    --white:#ffffff; --surface:#ffffff; --text:#1E293B; --muted:#64748B; --border:#E2E8F0;
    --magenta:#E51A5A; --magenta-dark:#C8134C; --red:#991B1B; --red-tint:#FEE2E2; --red-line:#F7B9B9;
  }
  :root[data-theme="dark"]{
    --surface:#0A0A0B; --text:#F1F5F9; --muted:#94A3B8; --border:#25272C;
    --red:#FCA5A5; --red-tint:#2A0C0C; --red-line:#5B1A1A;
  }
  *{box-sizing:border-box}
  html{color-scheme:light}
  html[data-theme="dark"]{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--magenta);color:var(--text);font:14px/1.5 'Inter',system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  main{width:100%;max-width:380px;background:var(--surface);border-radius:16px;padding:32px 28px 28px;box-shadow:0 20px 50px -12px rgba(80,5,30,.45)}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
  .brand .logo{flex:none;width:40px;height:40px;border-radius:10px;background:var(--white);border:1px solid var(--border);display:grid;place-items:center}
  .brand img{display:block;width:23px;height:27px;object-fit:contain}
  .brand .name{font-size:15px;font-weight:600;letter-spacing:-.01em}
  h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em}
  .lead{margin:4px 0 20px;color:var(--muted);font-size:13px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input{font:inherit;font-size:14px;width:100%;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
  input:focus-visible,button:focus-visible{outline:2px solid var(--magenta);outline-offset:1px}
  button{font:inherit;font-size:14px;font-weight:600;width:100%;margin-top:22px;color:var(--white);background:var(--magenta);border:1px solid var(--magenta);border-radius:9px;padding:11px 16px;cursor:pointer;box-shadow:0 1px 2px rgba(229,26,90,.35),0 8px 18px -6px rgba(229,26,90,.55);transition:background .15s}
  button:hover{background:var(--magenta-dark)}
  .error{margin:0 0 4px;padding:10px 12px;border-radius:8px;border:1px solid var(--red-line);background:var(--red-tint);color:var(--red);font-size:13px;font-weight:600}
  @media (prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body>
<main>
  <div class="brand"><span class="logo"><img src="logo.png" alt=""></span><span class="name">Google Review Monitor</span></div>
  <h1>Sign in</h1>
  <p class="lead">Use your dashboard username and password.</p>
  ${opts.error ? `<p class="error" role="alert">${esc(opts.error)}</p>` : ""}
  <form method="post" action="login">
    <label for="user">Username</label>
    <input id="user" name="user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(opts.user ?? "")}"${opts.user ? "" : " autofocus"}>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required${opts.user ? " autofocus" : ""}>
    <button type="submit">Sign in</button>
  </form>
</main>
</body></html>`;
}
