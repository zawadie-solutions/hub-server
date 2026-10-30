// Single static page: a magenta app shell (top bar + icon rail) around a locations sidebar and
// the month's insights. All data is inserted via textContent / DOM APIs (never innerHTML),
// so review text cannot inject markup.
export const dashboardHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Review Monitor</title>
<link rel="icon" type="image/png" href="logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>try{if(localStorage.getItem('theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>
<style>
  /* Same colour tokens as Ombeni AI (ombeni-ai/public/style.css), so this
     dashboard reads as part of the same product; the typeface here is Inter. Status colors (green =
     still available, red = removed) stay semantic, not brand chrome. */
  :root{
    --white:#ffffff; --bg:#F8FAFC; --surface:#ffffff; --hover:#F1F5F9; --text:#1E293B; --muted:#64748B; --border:#E2E8F0;
    --magenta:#E51A5A; --magenta-dark:#C8134C; --magenta-tint:#FDECF1; --magenta-ink:#C8134C; --link:#E51A5A;
    --green:#1DB881; --green-dark:#065F46; --green-tint:#D1FAE5; --green-line:#BBF0DA;
    --red:#991B1B; --red-tint:#FEE2E2; --red-line:#F7B9B9;
  }
  /* Dark theme: pitch-black page, near-black surfaces; the magenta shell is unchanged. */
  :root[data-theme="dark"]{
    --bg:#000000; --surface:#0A0A0B; --hover:#18191D; --text:#F1F5F9; --muted:#94A3B8; --border:#25272C;
    --magenta-tint:#2B0A16; --magenta-ink:#FF8FB1; --link:#FF6B98;
    --green-dark:#6EE7B7; --green-tint:#06281D; --green-line:#0F4A36;
    --red:#FCA5A5; --red-tint:#2A0C0C; --red-line:#5B1A1A;
  }
  *{box-sizing:border-box}
  html{color-scheme:light}
  html[data-theme="dark"]{color-scheme:dark}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 'Inter',system-ui,-apple-system,"Segoe UI",sans-serif;font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  button,input,select{font-family:inherit}
  table,.totals,.loclist .n{font-variant-numeric:tabular-nums}
  a{color:var(--link)}
  a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--magenta);outline-offset:1px}

  /* ---- app shell ---- */
  .shell{display:grid;grid-template-columns:68px minmax(0,1fr);grid-template-rows:52px minmax(0,1fr);height:100vh;background:var(--magenta)}
  .topbar{grid-column:1/-1;background:var(--magenta);color:var(--white);display:flex;align-items:center;gap:14px;padding:0 16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;letter-spacing:-.01em;white-space:nowrap}
  .brand .logo{width:32px;height:32px;border-radius:8px;background:var(--white);display:grid;place-items:center}
  .brand .logo img{display:block;width:19px;height:22px;object-fit:contain}
  /* Month picker: one bar with the filter (icon) and the month, each opening its own menu. */
  .monthbar{display:none;position:relative;align-items:center;gap:2px;height:36px;padding:3px;min-width:0;width:420px;max-width:100%;color:var(--text);background:var(--surface);border-radius:11px;box-shadow:0 1px 2px rgba(15,23,42,.14),0 6px 18px rgba(15,23,42,.12)}
  .monthbar.show{display:flex}
  .mb-filter{flex:none;position:relative;width:30px;height:30px;display:grid;place-items:center;padding:0;color:var(--muted);background:none;border:0;border-radius:8px;cursor:pointer;transition:background .15s,color .15s}
  .mb-filter svg{width:15px;height:15px;fill:currentColor}
  .mb-filter:hover,.mb-filter[aria-expanded="true"]{background:var(--hover);color:var(--text)}
  .mb-filter.on{color:var(--magenta-ink);background:var(--magenta-tint)}
  .mb-filter .dot{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--magenta);box-shadow:0 0 0 2px var(--surface)}
  .mb-sep{flex:none;width:1px;height:18px;margin:0 3px;background:var(--border)}
  .mb-month{flex:1;min-width:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 8px 0 9px;color:var(--text);background:none;border:0;border-radius:8px;font-size:13px;font-weight:600;text-align:left;cursor:pointer;transition:background .15s}
  .mb-month:hover,.mb-month[aria-expanded="true"]{background:var(--hover)}
  .mb-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mb-month .chev{flex:none;width:14px;height:14px;margin-left:auto;fill:none;stroke:var(--muted);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s}
  .mb-month[aria-expanded="true"] .chev{transform:rotate(180deg)}
  .chip{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1}
  .chip.legacy{color:var(--magenta-ink);background:var(--magenta-tint);box-shadow:inset 0 0 0 1px rgba(229,26,90,.22)}
  .mb-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:60;padding:6px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.20),0 2px 6px rgba(15,23,42,.08);animation:popin .14s ease-out}
  .mb-pop[hidden]{display:none}
  @keyframes popin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .mb-list{right:0;max-height:min(440px,70vh);overflow:auto;overscroll-behavior:contain}
  .mb-menu{width:230px}
  .mb-head{padding:8px 10px 4px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .mb-head:not(:first-child){margin-top:4px;border-top:1px solid var(--border);padding-top:10px}
  .mb-item{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;color:inherit;background:none;border:0;border-radius:8px;font-size:13px;font-weight:500;text-align:left;cursor:pointer}
  .mb-item:hover,.mb-item:focus-visible{background:var(--hover);outline:none}
  .mb-item:disabled{opacity:.45;cursor:default;background:none}
  .mb-item[aria-selected="true"],.mb-item[aria-checked="true"]{font-weight:600}
  .mb-item .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mb-item .end{margin-left:auto;display:flex;align-items:center;gap:8px;padding-left:6px}
  .mb-item .meta{font-size:11.5px;font-weight:500;color:var(--muted);white-space:nowrap}
  .mb-item .check{flex:none;width:14px;height:14px;fill:none;stroke:var(--magenta);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;visibility:hidden}
  .mb-item[aria-selected="true"] .check,.mb-item[aria-checked="true"] .check{visibility:visible}
  .mb-empty{padding:14px 10px;font-size:13px;color:var(--muted)}
  @media (prefers-reduced-motion:reduce){.mb-pop{animation:none}.mb-month .chev{transition:none}}
  .btn{font:inherit;font-size:13px;font-weight:600;color:var(--white);background:var(--magenta);border:1px solid var(--magenta);border-radius:7px;padding:6px 14px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background .15s,box-shadow .15s,transform .15s}
  .btn[hidden]{display:none}
  .btn svg{flex:none;width:13px;height:13px;fill:currentColor}
  .btn:hover{background:var(--magenta-dark)}
  .btn:disabled{background:var(--border);border-color:var(--border);color:var(--muted);cursor:default}
  .btn.ghost{background:var(--surface);color:var(--text);border-color:var(--border)}
  .btn.ghost:hover{background:var(--hover)}
  .btn.ghost:disabled{background:var(--bg);color:var(--muted)}
  .btn.busy,.btn.busy:disabled{background:var(--magenta-tint);border-color:var(--magenta-tint);color:var(--magenta-ink);cursor:progress}
  .runactions .btn.ghost{font-size:14px;padding:9px 16px;border-radius:9px}
  .btn.ghost.busy,.btn.ghost.busy:disabled{background:var(--hover);border-color:var(--border);color:var(--text)}
  /* The page's one primary action: larger, with a soft magenta glow. */
  .btn.run{font-size:14px;padding:9px 20px 9px 16px;border-radius:9px;box-shadow:0 1px 2px rgba(229,26,90,.35),0 8px 18px -6px rgba(229,26,90,.55)}
  .btn.run:hover{transform:translateY(-1px);box-shadow:0 2px 4px rgba(229,26,90,.35),0 12px 22px -6px rgba(229,26,90,.6)}
  .btn.run:active{transform:none}
  .btn.run:disabled{transform:none;box-shadow:none}
  .spin{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .loading{display:flex;align-items:center;gap:9px;color:var(--muted);padding:14px 0}
  [hidden]{display:none!important}
  .runactions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pagehead{position:relative}
  /* The text gives way before the buttons do, so the buttons stay on the heading's line. */
  .pagehead>div:first-child{flex:1 1 240px;min-width:0}
  .pagehead .runactions{flex:none}
  /* Run options: a small panel that drops down under the run buttons. */
  .runopts{position:absolute;right:0;top:calc(100% + 8px);z-index:6;width:min(400px,100%);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px 14px;box-shadow:0 16px 36px -12px rgba(15,23,42,.32)}
  .runopts h3{margin:0;font-size:15px;font-weight:600}
  .runopts .lead{color:var(--muted);font-size:12.5px;margin:2px 0 14px}
  .runopts .grp{font-size:13px;font-weight:600;margin:0 0 4px}
  .runopts label.radio{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13.5px;font-weight:400;margin:0;cursor:pointer}
  .runopts input[type=radio]{flex:none;margin:0;accent-color:var(--magenta)}
  .runopts input[type=number]{font:inherit;font-size:13.5px;width:92px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-variant-numeric:tabular-nums}
  .runopts .hint{color:var(--muted);font-size:12.5px;margin-top:6px}
  .runopts .sep{border-top:1px solid var(--border);margin:14px 0}
  .runopts .foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px}
  .runopts .linkbtn{font:inherit;font-size:12.5px;color:var(--muted);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
  .runplan{color:var(--magenta-ink);font-size:12.5px;font-weight:600;margin-top:4px}
  .runplan:empty{display:none}
  /* Live run panel: what is being checked now, how far along, and a bar that fills as reviews are done. */
  .runstatus{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:12px 16px 14px}
  .runline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;color:var(--magenta)}
  .runline .what{color:var(--text);font-weight:600;min-width:0;overflow-wrap:anywhere}
  .runline .count{margin-left:auto;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
  .runbar{height:4px;border-radius:999px;background:var(--magenta-tint);overflow:hidden}
  .runbar i{display:block;width:0;height:100%;border-radius:inherit;background:var(--magenta);transition:width .4s ease}
  .runbar.indet i{display:none}
  .runbar.indet::before{content:"";display:block;width:35%;height:100%;border-radius:inherit;background:var(--magenta);animation:slide 1.4s ease-in-out infinite}
  @keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(290%)}}
  .skel{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--hover) 25%,var(--border) 50%,var(--hover) 75%);background-size:200% 100%;animation:shimmer 1.3s linear infinite}
  @keyframes shimmer{to{background-position:-200% 0}}
  .skel+.skel{margin-top:14px}
  .skel.short{width:45%} .skel.big{width:110px;height:30px}
  .loclist .skel{margin:9px 8px}
  @media (prefers-reduced-motion:reduce){.switch input,.switch input::after{transition:none}.spin,.runbar.indet::before,.skel{animation:none}.runbar i{transition:none}.btn{transition:none}.btn.run:hover{transform:none}}
  .topbar :focus-visible{outline-color:var(--white)}
  .themebtn{margin-left:auto;width:32px;height:32px;display:grid;place-items:center;padding:0;color:var(--white);background:none;border:0;border-radius:8px;cursor:pointer}
  .themebtn:hover{background:var(--magenta-dark)}
  .themebtn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .themebtn .sun{display:none}
  :root[data-theme="dark"] .themebtn .sun{display:block}
  :root[data-theme="dark"] .themebtn .moon{display:none}
  .logout{font:inherit;font-size:12.5px;font-weight:600;color:var(--white);background:none;border:1px solid rgba(255,255,255,.55);border-radius:7px;padding:5px 11px;cursor:pointer;white-space:nowrap}
  .logout:hover{background:var(--magenta-dark);border-color:var(--magenta-dark)}
  .pill{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;white-space:nowrap}
  .pill .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(255,255,255,.25)}
  .rail{padding:10px 6px;display:flex;flex-direction:column;gap:4px}
  .rail a{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px;border-radius:8px;color:var(--white);opacity:.82;text-decoration:none;font-size:10.5px;font-weight:500}
  .rail a:hover{opacity:1;background:var(--magenta-dark)}
  .rail a.active{opacity:1;font-weight:600;background:var(--magenta-dark)}
  .rail a:focus-visible{outline-color:var(--white)}
  .rail svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

  /* ---- content panel: locations column | main ---- */
  .panel{display:grid;grid-template-columns:288px minmax(0,1fr);min-width:0;min-height:0;background:var(--bg);border-top-left-radius:18px;overflow:hidden}
  .side{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--surface);border-right:1px solid var(--border);padding:22px 16px 0}
  .side .label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .side .scope{font-weight:600;margin:4px 0 12px;overflow-wrap:anywhere}
  .side input{font:inherit;font-size:13px;width:100%;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px}
  .loclist{list-style:none;flex:1;min-height:0;margin:10px -8px 0;padding:0 8px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
  .loclist button{font:inherit;font-size:13px;width:100%;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;text-align:left;color:var(--text);background:none;border:0;border-radius:7px;padding:7px 8px;cursor:pointer}
  .loclist button:hover{background:var(--hover)}
  .loclist button.active{background:var(--magenta-tint);color:var(--magenta-ink);font-weight:600}
  .loclist .n{flex:none;font-size:11.5px;font-weight:500;color:var(--muted);line-height:1.7}
  .loclist button.active .n{color:var(--magenta-ink)}
  .loclist .name{flex:1;min-width:0;overflow-wrap:anywhere}
  .loclist .mark{flex:none;width:14px;height:20px;display:grid;place-items:center}
  .loclist .mark:empty{display:none}
  .loclist .mark svg{width:14px;height:14px;fill:none;stroke:var(--green);stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}
  .loclist .mark .spin{width:12px;height:12px;color:var(--magenta)}

  .main{min-width:0;overflow-y:auto;scroll-behavior:smooth;padding:24px 28px 48px;display:flex;flex-direction:column;gap:20px}
  .main>*{flex:none}
  .pagehead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  .pagehead h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em}
  .schedule{color:var(--muted);font-size:12.5px;margin-top:4px}
  .monthnote{color:var(--muted);font-size:12.5px;margin-top:2px}
  .monthnote:empty{display:none}
  .banner{display:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600}
  .banner.show{display:block}
  .banner.bad{border:1px solid var(--red-line);background:var(--red-tint);color:var(--red)}
  .banner.note{border:1px solid var(--border);background:var(--surface);color:var(--muted);font-weight:500}

  /* ---- cards ---- */
  .card{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:16px 18px}
  .overview{display:grid;grid-template-columns:340px minmax(0,1fr);padding:0;overflow:hidden}
  .totals{padding:20px 22px;border-right:1px solid var(--border)}
  .totals .cap{font-size:12.5px;font-weight:500;color:var(--muted)}
  .totals .big{font-size:32px;font-weight:700;line-height:1.15;letter-spacing:-.02em;margin-top:2px}
  .totals .rows{margin-top:16px;border-top:1px solid var(--border)}
  .totals .line{display:grid;grid-template-columns:minmax(0,1fr) auto 50px;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
  .totals .line:last-child{border-bottom:0;padding-bottom:0}
  .totals .line .k{display:flex;align-items:center;gap:8px}
  .totals .line .k i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .totals .line.green .k i{background:var(--green)} .totals .line.red .k i{background:var(--red)}
  .totals .line.asana .k i{background:var(--green-dark)}
  .totals .line .v{font-weight:600;text-align:right}
  .totals .line .p{color:var(--muted);font-size:12.5px;text-align:right}
  .totals .line.hot .v{color:var(--red)}
  section h2{font-size:14px;margin:0 0 10px;color:var(--text)}
  .cardhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .cardhead .title{font-weight:700;overflow-wrap:anywhere;min-width:0}
  .cardhead .actions{display:flex;gap:8px;flex-wrap:wrap}
  .locworker{color:var(--muted);font-size:12.5px;margin-top:4px}
  .locworker b{color:var(--text);font-weight:600}
  .locworker:empty{display:none}
  /* Removed disputes at the selected location. */
  .locremoved{margin-top:14px}
  .locremoved h3{font-size:13px;font-weight:600;margin:0 0 8px}
  .locremoved.has{border:1px solid var(--red-line);background:var(--red-tint);border-radius:8px;padding:12px 14px}
  .locremoved.has h3{color:var(--red)}
  .locremoved .removed-list{margin-top:0}
  .locremoved .none{color:var(--muted);font-size:12.5px}
  .locnote{color:var(--muted);font-size:12.5px;margin-top:8px}
  .locnote:empty{display:none}
  .tablewrap{overflow-x:auto;margin-top:12px}
  table{border-collapse:collapse;width:100%;min-width:660px;font-size:13px}
  th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);background:var(--bg);padding:8px 10px;white-space:nowrap;border-bottom:1px solid var(--border)}
  td{padding:10px;border-bottom:1px solid var(--border);vertical-align:top}
  tr:last-child td{border-bottom:0}
  td .who{font-weight:600}
  td .meta{color:var(--muted);font-size:12.5px;margin-top:2px;overflow-wrap:anywhere}
  td.nowrap{white-space:nowrap}
  /* Links out to Google Maps / Asana, shown as the destination's logo. White in both themes so the logos read. */
  .logolink{display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:34px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:#fff;vertical-align:middle;transition:border-color .15s,box-shadow .15s}
  .logolink:hover{border-color:var(--magenta);box-shadow:0 1px 4px rgba(229,26,90,.25)}
  .logolink img{display:block;height:16px;width:auto}
  .logolink.asana img{height:11px}
  td .logolink+.logolink{margin-left:8px}
  .card.ok{background:var(--green-tint);border-color:var(--green-line)}
  .card.ok .headline{color:var(--green-dark)}
  .card.attn{background:var(--red-tint);border-color:var(--red-line)}
  .card.attn .headline{color:var(--red)}
  .headline{font-size:15px;font-weight:700;margin:0}
  .subline{font-size:13px;color:var(--muted);margin:4px 0 0}
  .card.attn .subline{color:var(--red);opacity:.85}
  .removed-list{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
  .removed-list li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--red-line);border-radius:8px;flex-wrap:wrap}
  .removed-list .left{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .removed-list .who{font-weight:600}
  .removed-list .where{color:var(--muted);font-weight:500;font-size:12.5px}
  .removed-list .right{display:flex;align-items:center;gap:10px;margin-left:auto}
  .removed-list .when{color:var(--muted);font-size:12.5px;white-space:nowrap}
  .review-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column}
  .review-list li{padding:10px 0;border-top:1px solid var(--border)}
  .review-list .top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .review-list .who{font-weight:600}
  .review-list .links{display:flex;gap:12px;margin-left:auto}
  .review-list .meta{color:var(--muted);font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
  .review-list .text{font-size:13px;margin-top:5px;white-space:pre-wrap;overflow-wrap:anywhere}
  .google-head{margin-top:16px;padding-top:14px;border-top:2px solid var(--border)}
  .google-head .name{font-weight:700}
  .google-head .meta{color:var(--muted);font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
  .tag{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;white-space:nowrap}
  .tag.sent{background:var(--green-tint);color:var(--green-dark)}
  .tag.pending{background:var(--bg);color:var(--muted);border:1px solid var(--border)}
  .tag.failed{background:var(--red-tint);color:var(--red)}
  .activity{display:flex;flex-direction:column}
  .activity .row{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px}
  .activity .row:last-child{border-bottom:0}
  .activity .when{width:84px;flex:none;color:var(--muted);font-weight:600}
  .activity .what{color:var(--text)}
  .activity .what b{font-weight:600}
  .empty{color:var(--muted);padding:10px 0}

  /* ---- pages without the locations column (Audit, Configure) ---- */
  .panel.full{grid-template-columns:minmax(0,1fr)}
  .panel.full .side{display:none}
  .card.flush{padding:0;overflow:hidden}
  .card.flush .tablewrap{margin-top:0}
  .card.flush th:first-child,.card.flush td:first-child{padding-left:18px}
  .seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:2px;gap:2px}
  .seg button{font:inherit;font-size:13px;font-weight:500;color:var(--muted);background:none;border:0;border-radius:6px;padding:5px 12px;cursor:pointer}
  .seg button:hover{color:var(--text)}
  .seg button.on{background:var(--magenta-tint);color:var(--magenta-ink);font-weight:600}
  .who-tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--hover);color:var(--text);white-space:nowrap}
  .who-tag.auto{color:var(--muted);font-weight:500}
  .kind{display:inline-block;min-width:78px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
  .more{padding:12px 18px;border-top:1px solid var(--border);text-align:center}
  .cfg{column-count:2;column-gap:20px}
  .cfg .card{break-inside:avoid;margin-bottom:20px}
  .cfg .card h2{font-size:15px;margin:0}
  .cfg .card .lead{color:var(--muted);font-size:12.5px;margin:3px 0 0}
  .field{margin-top:16px}
  .field label,.field .lbl{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
  .field select,.field input[type=number]{font:inherit;font-size:13.5px;width:100%;max-width:320px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 10px}
  .field input[type=number]{max-width:140px;font-variant-numeric:tabular-nums}
  .field .hint{color:var(--muted);font-size:12.5px;margin-top:6px}
  .field label.switch{display:flex;align-items:flex-start;gap:12px;margin-bottom:0;cursor:pointer}
  .switch .t{display:block}
  .switch input{appearance:none;-webkit-appearance:none;flex:none;width:36px;height:20px;margin:1px 0 0;border-radius:999px;background:var(--border);position:relative;cursor:pointer;transition:background .15s}
  .switch input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .switch input:checked{background:var(--magenta)}
  .switch input:checked::after{transform:translateX(16px)}
  .switch .t{font-size:13px;font-weight:600}
  .switch .d{display:block;color:var(--muted);font-size:12.5px;font-weight:400;margin-top:2px}
  .rows{margin-top:12px}
  .rows .r{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:10px 0;border-top:1px solid var(--border);font-size:13px}
  .rows .r:first-child{border-top:0}
  .rows .r .k{font-weight:600}
  .rows .r .v{color:var(--muted);text-align:right;overflow-wrap:anywhere}
  .rows .r.bad .v{color:var(--red);font-weight:600}
  .banner.good{border:1px solid var(--green-line);background:var(--green-tint);color:var(--green-dark)}

  /* Month rings: how many Asana months have been synced, overall and by kind. One ring per kind,
     filled to its synced share. Ring colours are validated for colour-blind separation in both themes. */
  :root{--ring-all:#E51A5A;--ring-managed:#2a78d6;--ring-legacy:#eb6834}
  :root[data-theme="dark"]{--ring-all:#F0336F;--ring-managed:#3987e5;--ring-legacy:#d95926}
  .chart{padding:20px 22px;display:flex;flex-direction:column;gap:16px;min-width:0}
  .chart .cap{font-size:12.5px;font-weight:500;color:var(--muted)}
  .chart .big{font-size:32px;font-weight:700;line-height:1.15;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums}
  .chart .from{font-size:12.5px;color:var(--muted);margin-top:2px}
  .mstats{display:flex;gap:28px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--border)}
  .mstats .n{font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .mstats .k{font-size:12.5px;color:var(--muted)}
  .rings{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
  .rings svg{flex:none;width:156px;height:156px;overflow:visible}
  .rings .track{fill:none;stroke:var(--hover)}
  .rings .arc{fill:none;stroke-linecap:round;transition:stroke-dashoffset .9s cubic-bezier(.22,1,.36,1),opacity .15s}
  .rings .hit{fill:none;stroke:transparent;cursor:default}
  .rings .mid{font-size:22px;font-weight:700;fill:var(--text);text-anchor:middle;font-variant-numeric:tabular-nums}
  .rings .mid-sub{font-size:11px;font-weight:500;fill:var(--muted);text-anchor:middle}
  .rings.focus .arc:not(.on){opacity:.25}
  .ringkey{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 170px;max-width:280px}
  .ringkey li{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 8px;margin:0 -8px;border-radius:7px;font-size:13px;cursor:default}
  .ringkey li:hover,.ringkey li.on{background:var(--hover)}
  .ringkey i{width:10px;height:10px;border-radius:50%}
  .ringkey .v{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
  .ringkey .v span{font-weight:400;color:var(--muted)}
  @media (prefers-reduced-motion:reduce){.rings .arc{transition:none}}

  /* No months yet: the totals take the whole card instead of leaving half of it blank. */
  .chart:empty{display:none}
  .overview:has(>.chart:empty){grid-template-columns:minmax(0,1fr)}
  .overview:has(>.chart:empty) .totals{border-right:0}
  .shell{height:100dvh}

  /* The locations header only folds the list away on phones (see 640px below). */
  .sidehead{display:flex;align-items:flex-start;gap:10px;width:100%;padding:0;color:inherit;background:none;border:0;text-align:left;font:inherit;pointer-events:none}
  .sidehead>span:first-child{flex:1;min-width:0}
  .sidehead .label{display:block}
  .sidehead .picked,.sidehead .chev{display:none}
  .sidebody{display:flex;flex-direction:column;flex:1;min-height:0}

  /* ---- small laptops and tablets in landscape ---- */
  @media (max-width:1100px){
    .panel{grid-template-columns:240px minmax(0,1fr)}
    .side{padding:20px 12px 0}
    .main{padding:20px 20px 40px}
  }

  /* ---- tablets in portrait: the rail becomes tabs, the locations column stays ---- */
  @media (max-width:900px){
    .cfg{column-count:1}
    .shell{grid-template-columns:minmax(0,1fr);grid-template-rows:52px auto minmax(0,1fr)}
    .rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;padding:0 10px 8px}
    .rail a{flex-direction:row;justify-content:center;gap:6px;padding:7px 6px;font-size:12.5px;white-space:nowrap}
    .rail svg{width:16px;height:16px}
    .panel{border-top-right-radius:18px}
    .brand span:last-child{display:none}
    .pill span:last-child{display:none}
    .monthbar{flex:1;width:auto;max-width:420px}
    .overview{grid-template-columns:minmax(0,1fr)}
    .totals{border-right:0}
    .chart{border-top:1px solid var(--border)}
  }
  /* Text under 16px makes phones and tablets zoom in when the field is tapped. */
  @media (max-width:900px),(pointer:coarse){
    input,select,textarea{font-size:16px!important}
    .mb-item{padding:11px 10px}
    .loclist button{padding:10px 8px}
  }

  /* ---- phones: one column, the month on its own row, the locations folded away ---- */
  @media (max-width:640px){
    .shell{grid-template-rows:auto auto 1fr;height:auto;min-height:100dvh}
    .topbar{flex-wrap:wrap;gap:8px 10px;padding:8px 12px 10px}
    .monthbar{order:9;flex:1 1 100%;max-width:none;height:40px}
    .mb-month{height:34px;font-size:14px}
    .mb-filter{width:34px;height:34px}
    .mb-menu{width:min(260px,calc(100vw - 24px))}
    .mb-list{max-height:min(460px,65dvh)}
    .mb-item .name{white-space:normal}
    .rail{padding:0 8px 8px;gap:2px}
    .rail a{flex-direction:column;gap:3px;padding:6px 2px;font-size:11px}
    .rail svg{width:18px;height:18px}
    .panel{grid-template-columns:minmax(0,1fr);border-top-left-radius:16px;border-top-right-radius:16px;overflow:visible}
    .side{border-right:0;border-bottom:1px solid var(--border);padding:0;border-top-left-radius:16px;border-top-right-radius:16px}
    .sidehead{pointer-events:auto;cursor:pointer;align-items:center;padding:14px 16px}
    .sidehead .scope{margin:2px 0 0;font-size:13px;font-weight:500;color:var(--muted)}
    .sidehead .picked{display:block;font-weight:600;font-size:15px;margin-top:2px;overflow-wrap:anywhere}
    .sidehead .chev{display:block;flex:none;width:34px;height:34px;padding:8px;border-radius:50%;background:var(--hover);fill:none;stroke:var(--text);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s}
    .side.open .sidehead .chev{transform:rotate(180deg)}
    .side:not(.open) .sidebody{display:none}
    .sidebody{padding:0 16px 8px}
    .loclist{flex:none;max-height:min(360px,55dvh)}
    .main{overflow:visible;padding:16px 12px 40px;gap:16px}
    .pagehead h1{font-size:20px}
    .pagehead .runactions{flex:1 1 100%}
    .runactions .btn{flex:1 1 0}
    .runactions #runNow,.runactions #cancelRun{flex-basis:100%}
    #runNow{order:-1}
    /* Run options opens as a sheet from the bottom of the screen. */
    .runopts{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-height:85dvh;overflow-y:auto;overscroll-behavior:contain;z-index:70;border-radius:16px 16px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 0 0 100vmax rgba(15,23,42,.45);animation:sheetin .2s ease-out}
    .runopts label.radio{padding:8px 0;flex-wrap:wrap}
    .runopts .foot .btn{min-width:120px}
    .card{padding:14px}
    .totals,.chart{padding:16px}
    .rings{justify-content:center}
    .cardhead .actions{width:100%}
    .cardhead .actions .btn{flex:1 1 0}
    .removed-list li{align-items:flex-start}
    .removed-list .right{flex-wrap:wrap;margin-left:0;width:100%}
    .activity .row{flex-direction:column;gap:2px}
    .activity .when{width:auto}
    .seg{display:flex;width:100%}
    .seg button{flex:1;padding:7px 4px}
    /* Tables become one card per row, each value labelled. */
    table.stack{min-width:0}
    table.stack thead{display:none}
    table.stack tr{display:block;padding:10px 0;border-bottom:1px solid var(--border)}
    table.stack tr:last-child{border-bottom:0}
    table.stack td{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 0;border:0;white-space:normal;text-align:right}
    table.stack td::before{content:attr(data-label);flex:none;font-size:12px;font-weight:600;color:var(--muted);text-align:left}
    table.stack td.full{display:block;text-align:left}
    table.stack td.full::before{content:none}
    .card.flush table.stack tr{padding:12px 14px}
    .card.flush table.stack td:first-child{padding-left:0}
  }
  @keyframes sheetin{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
  @media (prefers-reduced-motion:reduce){.runopts{animation:none}.sidehead .chev{transition:none}}
</style></head><body>
<div class="shell">
  <header class="topbar">
    <div class="brand"><span class="logo"><img src="logo.png" alt=""></span><span>Google Review Monitor</span></div>
    <div class="monthbar" id="monthbar">
      <button class="mb-filter" id="monthFilter" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="filterMenu" aria-label="Filter months" title="Filter months"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.17 2.44L14.5 13.5V19a1 1 0 0 1-.55.9l-3 1.5A1 1 0 0 1 9.5 20.5v-7L3.83 6.44a1.5 1.5 0 0 1-.33-.94z"/></svg><span class="dot" id="monthFilterDot" hidden></span></button>
      <span class="mb-sep" aria-hidden="true"></span>
      <button class="mb-month" id="monthBtn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="monthList"><span class="mb-name" id="monthName"></span><span class="chip legacy" id="monthChip" hidden>Legacy</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="mb-pop mb-menu" id="filterMenu" role="menu" aria-label="Show months" hidden></div>
      <div class="mb-pop mb-list" id="monthList" role="listbox" aria-label="Month" hidden></div>
    </div>
    <button class="themebtn" id="themeToggle" type="button" aria-label="Switch to dark theme" title="Switch to dark theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    </button>
    <div class="pill"><span class="dot"></span><span>Monitoring active</span></div>
    <form method="post" action="logout"><button class="logout" type="submit">Log out</button></form>
  </header>
  <nav class="rail" aria-label="Sections">
    <a href="#insights" data-view="insights" class="active"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Insights</a>
    <a href="#removedSection"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Removed</a>
    <a href="#activitySection"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Activity</a>
    <a href="#audit" data-view="audit"><svg viewBox="0 0 24 24"><path d="M8 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6M9 13h6M9 17h3"/></svg>Audit</a>
    <a href="#configure" data-view="configure"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>Configure</a>
  </nav>
  <div class="panel" id="panel">
    <aside class="side" id="side" aria-label="Locations">
      <button class="sidehead" id="locToggle" type="button" aria-controls="locBody">
        <span><span class="label">Locations</span><span class="picked" id="locPicked"></span><span class="scope" id="locScope"></span></span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="sidebody" id="locBody">
        <input id="locSearch" type="search" placeholder="Search locations…" aria-label="Search locations">
        <ul class="loclist" id="locList"><li class="skel"></li><li class="skel"></li><li class="skel"></li><li class="skel"></li><li class="skel"></li><li class="skel"></li></ul>
      </div>
    </aside>

    <main class="main" id="viewInsights">
      <div class="pagehead" id="top">
        <div>
          <h1>Insights</h1>
          <div class="schedule" id="schedule">Loading…</div>
          <div class="monthnote" id="monthNote"></div>
          <div class="runplan" id="runPlan"></div>
        </div>
        <div class="runactions">
          <button class="btn ghost" id="cancelRun" type="button" hidden>Cancel</button>
          <button class="btn ghost" id="syncNow" type="button" hidden title="Refresh this month's review tasks from Asana. Does not check Google.">Sync from Asana</button>
          <button class="btn ghost" id="runOpts" type="button" hidden aria-expanded="false" aria-controls="runOptsPanel">Run options</button>
          <button class="btn run" id="runNow" type="button" hidden>Run now</button>
        </div>
        <div class="runopts" id="runOptsPanel" hidden>
          <h3>Run options</h3>
          <p class="lead">Applies when you press Run. The whole month is still synced from Asana first.</p>
          <div class="grp" id="runScopeLabel">Reviews to check</div>
          <div role="radiogroup" aria-labelledby="runScopeLabel">
            <label class="radio"><input type="radio" name="runScope" value="all" checked><span id="runAllLabel">All of this month's reviews</span></label>
            <label class="radio"><input type="radio" name="runScope" value="first"><span>The first</span><input type="number" id="runFirst" min="1" step="50" value="700" aria-label="Number of reviews from the start"><span>reviews</span></label>
            <label class="radio"><input type="radio" name="runScope" value="last"><span>The last</span><input type="number" id="runLast" min="1" step="50" value="700" aria-label="Number of reviews from the end"><span>reviews</span></label>
          </div>
          <div class="hint">Counted in the order of the locations list. A location is never split, so the number is rounded up to the end of the location it lands in.</div>
          <div class="sep"></div>
          <label class="radio"><input type="checkbox" id="runForceSync" style="accent-color:var(--magenta);margin:0"><span>Sync from Asana first anyway</span></label>
          <div class="hint" id="runSyncHint"></div>
          <div id="runDepthBox">
            <div class="sep"></div>
            <label class="grp" for="runDepth" style="display:block">Google reviews to look through per location</label>
            <input type="number" id="runDepth" min="0" max="20000" step="50" inputmode="numeric">
            <div class="hint" id="runDepthHint"></div>
          </div>
          <div class="foot"><button class="linkbtn" id="runOptsReset" type="button">Back to defaults</button><button class="btn" id="runOptsDone" type="button">Done</button></div>
        </div>
      </div>
      <div class="runstatus" id="runStatus" hidden>
        <div class="runline" aria-live="polite"><span class="spin"></span><span class="what" id="runText"></span><span class="count" id="runCount"></span></div>
        <div class="runbar indet" id="runBar" role="progressbar" aria-label="Check progress"><i id="runFill"></i></div>
      </div>
      <div class="banner bad" id="failBanner"></div>
      <div class="banner note" id="unknownBanner"></div>

        <div class="card overview">
          <div class="totals" id="stats"><span class="skel short"></span><span class="skel big"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>
          <div class="chart" id="chart"></div>
        </div>

        <section>
          <div class="card">
            <div class="cardhead">
              <div class="title" id="locTitle">Reviews by location</div>
              <div class="actions"><button class="btn" id="checkLocation" type="button" disabled>Check now</button><button class="btn ghost" id="loadGoogle" type="button" disabled>Load Google reviews</button></div>
            </div>
            <div class="locworker" id="locWorker"></div>
            <div class="locnote" id="locationNote"></div>
            <div id="locRemoved"></div>
            <div id="reviews"></div>
            <div id="googleReviews"></div>
          </div>
        </section>

        <section id="removedSection">
          <h2>Review status</h2>
          <div id="status"><div class="card"><span class="skel short"></span><span class="skel"></span></div></div>
        </section>

        <section id="activitySection">
          <h2>Recent activity</h2>
          <div class="card"><div class="activity" id="activity"><span class="skel"></span><span class="skel short"></span></div></div>
        </section>
    </main>

    <main class="main" id="viewAudit" hidden>
      <div class="pagehead">
        <div>
          <h1>Audit log</h1>
          <div class="schedule">Who did what, and when. Newest first.</div>
        </div>
        <div class="seg" id="auditFilter" role="group" aria-label="Show">
          <button type="button" data-filter="" class="on">All</button>
          <button type="button" data-filter="checks">Checks</button>
          <button type="button" data-filter="settings">Settings</button>
          <button type="button" data-filter="system">System</button>
        </div>
      </div>
      <div class="card flush">
        <div class="tablewrap"><table class="stack">
          <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
          <tbody id="auditRows"></tbody>
        </table></div>
        <div class="more" id="auditMore" hidden><button class="btn ghost" id="auditOlder" type="button">Show older entries</button></div>
      </div>
    </main>

    <main class="main" id="viewConfig" hidden>
      <div class="pagehead">
        <div>
          <h1>Configure</h1>
          <div class="schedule">Changes apply from the next check. No restart is needed.</div>
        </div>
        <div class="runactions">
          <button class="btn ghost" id="cfgReset" type="button" hidden>Reset to .env values</button>
          <button class="btn" id="cfgSave" type="button" disabled>Save changes</button>
        </div>
      </div>
      <div class="banner" id="cfgMsg" role="status"></div>
      <div class="cfg" id="cfgBody">
        <div class="card">
          <h2>Review source</h2>
          <p class="lead">The service that lists each business's Google reviews.</p>
          <div class="field"><label for="cfgSource">Check reviews with</label><select id="cfgSource"></select></div>
          <div class="field"><label for="cfgFallback">If that service fails, use</label><select id="cfgFallback"></select>
            <div class="hint">Used only when the first service fails outright, for example when it is out of credit. Not used when it answers "could not be checked".</div></div>
        </div>

        <div class="card">
          <h2>How far back to look</h2>
          <p class="lead">The newest reviews fetched per location. A disputed review older than this cannot be checked. You pay for the reviews returned, so a higher number costs more only at large businesses.</p>
          <div class="field"><label for="cfgMax">Google reviews to look through per location</label><input id="cfgMax" type="number" min="0" max="20000" step="50" inputmode="numeric">
            <div class="hint">The same setting as in Run options on the Insights page. 0 means as many as the service allows.</div></div>
          <div class="field"><label for="cfgSyncFresh">Skip the Asana sync if the month was synced in the last (minutes)</label><input id="cfgSyncFresh" type="number" min="0" max="10080" step="5" inputmode="numeric">
            <div class="hint">Applies to Run now. 0 means always sync from Asana first. The daily check and the Sync from Asana button always sync.</div></div>
          <div class="field"><label class="switch"><input id="cfgDfsFast" type="checkbox"><span><span class="t">Use DataForSEO's fast queue for full runs</span><span class="d">About a minute per request at double the price. Single-location checks always use it.</span></span></label></div>
        </div>

        <div class="card">
          <h2>Automatic daily check</h2>
          <p class="lead" id="cfgSchedule"></p>
          <div class="field"><label class="switch"><input id="cfgDaily" type="checkbox"><span><span class="t">Run the daily check automatically</span><span class="d">When off, reviews are only checked when someone presses Run now or Check now.</span></span></label></div>
        </div>

        <div class="card">
          <h2>Accounts</h2>
          <p class="lead">Credit left with the paid review services, read live.</p>
          <div class="rows" id="cfgAccounts"></div>
        </div>

        <div class="card">
          <h2>Connections</h2>
          <p class="lead">Set in the .env file on the server. Shown here for reference.</p>
          <div class="rows" id="cfgConnections"></div>
        </div>
      </div>
    </main>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e}
// A 401 means the sign-in has expired: go back to the sign-in form instead of showing errors.
{const send=window.fetch.bind(window);window.fetch=async(...a)=>{const r=await send(...a);if(r.status===401)location.href='login';return r}}
async function api(p){const r=await fetch(p);if(!r.ok)throw new Error(r.status);return r.json()}

const SVG_NS='http://www.w3.org/2000/svg';
const CHECK='M5 12.5l4.5 4.5L19 7.5';
const PLAY='M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z';
function icon(d){const s=document.createElementNS(SVG_NS,'svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');const p=document.createElementNS(SVG_NS,'path');p.setAttribute('d',d);s.append(p);return s}
/** Sets a button's label; busy swaps its icon for a spinner. */
function setBtn(btn,text,busy,iconPath){
  // Skip no-op updates so a spinner is not restarted every time live progress is redrawn.
  const key=text+'|'+!!busy;if(btn.dataset.k===key)return;btn.dataset.k=key;
  btn.classList.toggle('busy',!!busy);
  if(busy)btn.setAttribute('aria-busy','true');else btn.removeAttribute('aria-busy');
  btn.replaceChildren(...(busy?[el('span',null,'spin')]:iconPath?[icon(iconPath)]:[]),document.createTextNode(text));
}
/** A link out to the review on Google Maps or to its Asana task, shown as that product's logo. */
function logoLink(kind,href){
  const google=kind==='google', label=google?'Open the review on Google Maps':'Open the task in Asana';
  const a=el('a',null,'logolink '+(google?'gmaps':'asana'));
  a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.title=label;
  const img=document.createElement('img');img.src=google?'assets/google-maps.png':'assets/asana.png';img.alt=label;
  a.append(img);return a;
}
function loadingRow(text){const d=el('div',null,'loading');d.append(el('span',null,'spin'),document.createTextNode(text));return d}

function applyTheme(dark){
  if(dark)document.documentElement.dataset.theme='dark';else delete document.documentElement.dataset.theme;
  const label='Switch to '+(dark?'light':'dark')+' theme', b=$('themeToggle');
  b.setAttribute('aria-label',label);b.title=label;
}
applyTheme(document.documentElement.dataset.theme==='dark');
$('themeToggle').onclick=()=>{
  const dark=document.documentElement.dataset.theme!=='dark';
  applyTheme(dark);
  try{localStorage.setItem('theme',dark?'dark':'light')}catch(e){}
};

// ---- Run options: which reviews the next run checks, and how far back it looks per location ----
// sharedDepth is the saved "Google reviews per location" setting, the same one Configure edits.
let runOptions={scope:'all',first:700,last:700}, monthTotal=null, sharedDepth=null;
const DEPTH_HINT='Used for every check, and the same setting as on the Configure page. A higher number finds older disputed reviews and costs more at large businesses. 0 means as many as the service allows.';
let syncFresh=null; // minutes an Asana sync stays fresh (Configure); null until loaded
$('runForceSync').onchange=()=>{runOptions.forceSync=$('runForceSync').checked;saveRunOptions()};
const takesDepth=c=>c.settings.reviewChecker==='dataforseo'||c.settings.reviewChecker==='apify';
try{Object.assign(runOptions,JSON.parse(localStorage.getItem('runOptions')||'{}'))}catch(e){}
const wholeNumber=(v,min)=>Number.isInteger(v)&&v>=min;
/** What to send with a run request; nothing extra when the options are at their defaults. */
function runRequest(){
  const o={};
  if(runOptions.scope==='first'&&wholeNumber(runOptions.first,1))o.select={from:'first',count:runOptions.first};
  if(runOptions.scope==='last'&&wholeNumber(runOptions.last,1))o.select={from:'last',count:runOptions.last};
  if(runOptions.forceSync)o.forceSync=true;
  return o;
}
function runLabel(){const r=runRequest();return r.select?'Run '+r.select.from+' '+r.select.count.toLocaleString():'Run now'}
function renderRunOptions(){
  const r=runRequest(), parts=[];
  if(r.select)parts.push('the '+r.select.from+' '+r.select.count.toLocaleString()+' reviews');
  if(r.forceSync)parts.push('syncing from Asana first');
  $('runForceSync').checked=!!runOptions.forceSync;
  $('runSyncHint').textContent=syncFresh===null?'':syncFresh===0?'Every run already syncs from Asana first (set on the Configure page).'
    :'Run now skips the Asana sync when this month was synced in the last '+syncFresh+' minute'+(syncFresh===1?'':'s')+'. Tick this when Asana has changed since.';
  $('runPlan').textContent=parts.length?'Next run: '+parts.join(', ')+'.':'';
  $('runAllLabel').textContent='All of this month\u2019s reviews'+(monthTotal!==null?' ('+monthTotal.toLocaleString()+')':'');
  for(const x of document.querySelectorAll('input[name=runScope]'))x.checked=x.value===runOptions.scope;
  if(document.activeElement!==$('runFirst'))$('runFirst').value=runOptions.first;
  if(document.activeElement!==$('runLast'))$('runLast').value=runOptions.last;
  $('runDepthBox').hidden=sharedDepth===null;
  if(sharedDepth!==null&&document.activeElement!==$('runDepth'))$('runDepth').value=sharedDepth;
  if(!$('runDepthHint').textContent)$('runDepthHint').textContent=DEPTH_HINT;
  const btn=$('runNow');
  if(!btn.classList.contains('busy'))setBtn(btn,runLabel(),false,PLAY);
}
function saveRunOptions(){try{localStorage.setItem('runOptions',JSON.stringify(runOptions))}catch(e){}renderRunOptions()}
function showRunOptions(open){$('runOptsPanel').hidden=!open;$('runOpts').setAttribute('aria-expanded',String(open))}
$('runOpts').onclick=()=>showRunOptions($('runOptsPanel').hidden);
$('runOptsDone').onclick=()=>showRunOptions(false);
$('runOptsReset').onclick=()=>{runOptions={scope:'all',first:700,last:700};saveRunOptions()};
for(const x of document.querySelectorAll('input[name=runScope]'))x.onchange=()=>{runOptions.scope=x.value;saveRunOptions()};
const numberField=(id,key,min,pickScope)=>{$(id).oninput=()=>{
  const raw=$(id).value.trim(), v=raw===''?null:Number(raw);
  if(v!==null&&wholeNumber(v,min)){runOptions[key]=v;runOptions.scope=pickScope}
  saveRunOptions();
}};
numberField('runFirst','first',1,'first');numberField('runLast','last',1,'last');
// The per-location number is a saved setting, not a per-run one: changing it here saves it for Configure too.
$('runDepth').onchange=async()=>{
  const box=$('runDepth'), raw=box.value.trim(), v=Number(raw);
  if(raw===''||!wholeNumber(v,0)){box.value=sharedDepth;return}
  if(v===sharedDepth)return;
  try{
    const r=await fetch('api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewsPerLocation:v})});
    const j=await r.json();
    if(!j.ok){$('runDepthHint').textContent=j.reason||'Could not save.';box.value=sharedDepth;return}
    sharedDepth=j.settings.reviewsPerLocation;$('runDepthHint').textContent='Saved. '+DEPTH_HINT;
    if(cfg){cfg.settings.reviewsPerLocation=sharedDepth;$('cfgMax').value=sharedDepth;$('cfgReset').hidden=false}
  }catch(e){$('runDepthHint').textContent='Could not save: '+e.message;box.value=sharedDepth}
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')showRunOptions(false)});
document.addEventListener('pointerdown',e=>{if(!$('runOptsPanel').hidden&&!e.target.closest('#runOptsPanel,#runOpts'))showRunOptions(false)});
// The per-location number only applies to the services that take one.
api('api/config').then(c=>{
  if(!c.available)return;
  sharedDepth=takesDepth(c)?c.settings.reviewsPerLocation:null;
  syncFresh=c.settings.syncFreshMinutes;
  renderRunOptions();
}).catch(()=>{});

let currentProject=null, availableMonths=[];
// Which months the picker lists: all, Managed only or Legacy only. Remembered per browser.
let monthKind='all';
try{monthKind=localStorage.getItem('grm.monthKind')||'all'}catch(e){}
const kindOf=m=>m.legacy?'legacy':'managed';
const KIND_LABEL={all:'All months',managed:'Managed',legacy:'Legacy'};
const CHECK_SVG='<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const yearOf=m=>m.name.split(/[^0-9]+/).find(s=>s.length===4&&s.startsWith('20'))||'Other';

function closeMonthPops(){
  for(const [pop,btn] of [['monthList','monthBtn'],['filterMenu','monthFilter']]){$(pop).hidden=true;$(btn).setAttribute('aria-expanded','false')}
}
function toggleMonthPop(pop,btn){
  const open=$(pop).hidden;
  closeMonthPops();
  if(!open)return;
  $(pop).hidden=false;$(btn).setAttribute('aria-expanded','true');
  const f=$(pop).querySelector('[aria-selected="true"],[aria-checked="true"]')||$(pop).querySelector('.mb-item');
  if(f){f.focus();f.scrollIntoView({block:'nearest'})}
}
$('monthBtn').onclick=()=>toggleMonthPop('monthList','monthBtn');
$('monthFilter').onclick=()=>toggleMonthPop('filterMenu','monthFilter');
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#monthbar'))closeMonthPops()});
$('monthbar').addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    const back=!$('monthList').hidden?'monthBtn':!$('filterMenu').hidden?'monthFilter':null;
    closeMonthPops();if(back)$(back).focus();return;
  }
  const pop=e.target.closest('.mb-pop');
  if(!pop||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();
  const items=[...pop.querySelectorAll('.mb-item:not(:disabled)')], i=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,i+(e.key==='ArrowDown'?1:-1)));
  if(items[next])items[next].focus();
});
function setMonthKind(k){
  monthKind=k;
  try{localStorage.setItem('grm.monthKind',k)}catch(e){}
  if(!availableMonths.some(m=>m.projectGid===currentProject&&(k==='all'||kindOf(m)===k)))currentProject=null;
  refresh();
}
/** Draws the bar (selected month, its chip, the filter state) and both menus from availableMonths. */
function renderMonthPicker(shown){
  const cur=availableMonths.find(x=>x.projectGid===currentProject);
  $('monthName').textContent=cur?cur.name.trim():'No month';
  $('monthChip').hidden=!(cur&&cur.legacy);
  $('monthBtn').title=cur?cur.name.trim():'';
  const filtered=monthKind!=='all', f=$('monthFilter');
  f.classList.toggle('on',filtered);$('monthFilterDot').hidden=!filtered;
  f.title='Filter months: '+KIND_LABEL[monthKind];f.setAttribute('aria-label',f.title);

  const menu=$('filterMenu');menu.replaceChildren(el('div','Show','mb-head'));
  for(const k of ['all','managed','legacy']){
    const n=k==='all'?availableMonths.length:availableMonths.filter(x=>kindOf(x)===k).length;
    const b=el('button',null,'mb-item');b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(k===monthKind));
    b.append(el('span',KIND_LABEL[k],'name'));
    if(k==='legacy')b.append(el('span','Legacy','chip legacy'));
    const end=el('span',null,'end');end.append(el('span',String(n),'meta'));end.insertAdjacentHTML('beforeend',CHECK_SVG);b.append(end);
    b.disabled=!n&&k!=='all';
    b.onclick=()=>{closeMonthPops();$('monthFilter').focus();if(k!==monthKind)setMonthKind(k)};
    menu.append(b);
  }

  const list=$('monthList');list.replaceChildren();
  if(!shown.length)list.append(el('div','No months to show.','mb-empty'));
  let year=null;
  for(const x of shown){
    const y=yearOf(x);
    if(y!==year){list.append(el('div',y,'mb-head'));year=y}
    const b=el('button',null,'mb-item');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(x.projectGid===currentProject));
    b.append(el('span',x.name.trim(),'name'));
    if(x.legacy)b.append(el('span','Legacy','chip legacy'));
    const end=el('span',null,'end');
    if(x.runStatus==='running')end.append(el('span','Running','meta'));
    else if(!x.lastSyncedAt)end.append(el('span','Not synced','meta'));
    end.insertAdjacentHTML('beforeend',CHECK_SVG);b.append(end);
    b.onclick=()=>{
      closeMonthPops();$('monthBtn').focus();
      if(x.projectGid===currentProject)return;
      currentProject=x.projectGid;refresh();
    };
    list.append(b);
  }
}
// monthRunning: the month is marked as running. runState: live progress, when the run is in this server.
let monthRunning=false, runState=null, pollTimer=null, pollCount=0, cancelPending=false;
function withProject(path){return currentProject?path+(path.includes('?')?'&':'?')+'project='+encodeURIComponent(currentProject):path}
function pickDefaultProject(list){
  const synced=list.filter(m=>m.lastSyncedAt).sort((a,b)=>new Date(b.lastSyncedAt)-new Date(a.lastSyncedAt));
  return (synced[0]||list[0]).projectGid;
}

// Numbers count up to their new value. The last value shown is kept per number, so the
// 60-second refresh only animates what changed, not everything from 0 again.
const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)');
const shownValue={};
function countTo(node,key,to){
  const from=shownValue[key]??0;shownValue[key]=to;
  if(from===to||reduceMotion.matches){node.textContent=to.toLocaleString();return}
  const t0=performance.now(), ms=1100;
  const step=t=>{
    if(!node.isConnected)return;
    // A frame's timestamp can be a little before t0, which would otherwise start below the old value.
    const k=Math.min(1,Math.max(0,(t-t0)/ms)), eased=1-Math.pow(1-k,3);
    node.textContent=Math.round(from+(to-from)*eased).toLocaleString();
    if(k<1)requestAnimationFrame(step);
  };
  node.textContent=from.toLocaleString();requestAnimationFrame(step);
}

/** The stats card's right half: disputes synced, all / synced / not synced months, and one ring per kind filled to its synced share. */
function renderMonthRings(){
  const box=$('chart');box.replaceChildren();
  const all=availableMonths, synced=m=>!!m.lastSyncedAt;
  if(!all.length)return;
  const done=all.filter(synced).length;
  const disputes=all.filter(synced).reduce((n,m)=>n+(m.disputes||0),0);
  const big=el('div',null,'big');
  box.append(el('div','Disputes synced from Asana','cap'),big,
    el('div','Across all locations in '+done+' synced month'+(done===1?'':'s'),'from'));
  countTo(big,'disputes',disputes);
  const stats=el('div',null,'mstats');
  for(const [k,v] of [['All months',all.length],['Synced',done],['Not synced',all.length-done]]){
    const n=el('div',null,'n'), s=el('div');s.append(n,el('div',k,'k'));stats.append(s);countTo(n,'months.'+k,v);
  }
  box.append(stats);

  const rows=[['all','All months',all],['managed','Managed',all.filter(m=>!m.legacy)],['legacy','Legacy',all.filter(m=>m.legacy)]]
    .filter(r=>r[2].length).map(([id,label,list])=>({id,label,total:list.length,done:list.filter(synced).length}));
  const wrap=el('div',null,'rings');
  const svg=document.createElementNS(SVG_NS,'svg');svg.setAttribute('viewBox','0 0 156 156');svg.setAttribute('role','img');
  svg.setAttribute('aria-label',rows.map(r=>r.label+': '+r.done+' of '+r.total+' synced').join('. '));
  const node=(tag,attrs)=>{const n=document.createElementNS(SVG_NS,tag);for(const k in attrs)n.setAttribute(k,attrs[k]);return n};
  const W=12, GAP=4, C=78;
  const mid=node('text',{x:C,y:C+4,class:'mid'}), sub=node('text',{x:C,y:C+20,class:'mid-sub'});
  const key=el('ul',null,'ringkey');
  const show=r=>{
    wrap.classList.toggle('focus',!!r);
    for(const x of rows){x.arc&&x.arc.classList.toggle('on',x===r);x.li.classList.toggle('on',x===r)}
    const t=r||rows[0];
    mid.textContent=t.done+'/'+t.total;
    sub.textContent='synced';
  };
  rows.forEach((r,i)=>{
    const rad=C-W/2-i*(W+GAP), len=2*Math.PI*rad, colour='var(--ring-'+r.id+')';
    const g=node('g',{transform:'rotate(-90 '+C+' '+C+')'});
    g.append(node('circle',{cx:C,cy:C,r:rad,class:'track','stroke-width':W}));
    // A round cap would draw a dot at 0%, so an empty ring has no arc at all.
    // The ring sweeps from where it was last shown (empty the first time) to its new share.
    if(r.done){
      const was=shownValue['ring.'+r.id]??0, now=r.done/r.total;shownValue['ring.'+r.id]=now;
      r.arc=node('circle',{cx:C,cy:C,r:rad,class:'arc',stroke:colour,'stroke-width':W,'stroke-dasharray':len,'stroke-dashoffset':len*(1-was)});
      g.append(r.arc);
      if(was!==now)requestAnimationFrame(()=>requestAnimationFrame(()=>r.arc.setAttribute('stroke-dashoffset',len*(1-now))));
    }
    const hit=node('circle',{cx:C,cy:C,r:rad,class:'hit','stroke-width':W+GAP});
    hit.append(node('title',{}));hit.firstChild.textContent=r.label+': '+r.done+' of '+r.total+' synced';
    hit.addEventListener('pointerenter',()=>show(r));hit.addEventListener('pointerleave',()=>show(null));
    g.append(hit);svg.append(g);
    r.li=document.createElement('li');
    const dot=document.createElement('i');dot.style.background=colour;
    const v=el('span',r.done.toLocaleString(),'v');v.append(el('span',' / '+r.total.toLocaleString()));
    r.li.append(dot,el('span',r.label),v);
    r.li.addEventListener('pointerenter',()=>show(r));r.li.addEventListener('pointerleave',()=>show(null));
    key.append(r.li);
  });
  svg.append(mid,sub);
  show(null);
  wrap.append(svg,key);box.append(wrap);
}

async function loadMonths(){
  availableMonths=await api('api/available-months');
  renderMonthRings();
  const bar=$('monthbar');
  $('runNow').hidden=!availableMonths.length;
  $('syncNow').hidden=!availableMonths.length;
  $('runOpts').hidden=!availableMonths.length;
  if(!availableMonths.length){bar.classList.remove('show');monthRunning=false;runState=null;renderRun();$('monthNote').textContent='';return}
  bar.classList.add('show');
  if(!['all','managed','legacy'].includes(monthKind)||(monthKind!=='all'&&!availableMonths.some(m=>kindOf(m)===monthKind)))monthKind='all';
  const shown=availableMonths.filter(m=>monthKind==='all'||kindOf(m)===monthKind);
  if(!currentProject||!shown.some(m=>m.projectGid===currentProject))currentProject=pickDefaultProject(shown);
  renderMonthPicker(shown);

  const m=availableMonths.find(x=>x.projectGid===currentProject);
  const btn=$('runNow');
  const running=m&&m.runStatus==='running';
  monthRunning=!!running;
  btn.disabled=monthRunning;
  if(!monthRunning){runState=null;cancelPending=false;clearTimeout(pollTimer);setBtn(btn,runLabel(),false,PLAY);$('runOpts').disabled=false;$('syncNow').disabled=false;setBtn($('syncNow'),'Sync from Asana',false)}
  renderRun();
  if(monthRunning&&!runState)pollRun();
  $('monthNote').textContent=running?''
    :m&&m.lastRunError==='cancelled'?'Last run was cancelled before it finished.'
    :m&&m.lastRunError?'Last run failed: '+m.lastRunError
    :m&&m.lastSyncedAt?'Last synced '+dayLabel(m.lastSyncedAt)+', '+timeLabel(m.lastSyncedAt)
    :'Never synced yet — click Sync from Asana to bring this month in, or Run now to sync and check it.';
}

/** Draws the run panel, the Run button's label and the Cancel button from monthRunning / runState. */
function renderRun(){
  const running=monthRunning||!!runState;
  $('runStatus').hidden=!running;
  // A sync cannot be stopped part-way (it is one read of Asana), so it has no Cancel.
  const syncing=!!(runState&&runState.kind==='sync');
  $('cancelRun').hidden=!running||syncing;
  if(!running)return;
  const p=runState, btn=$('runNow'), cancel=$('cancelRun'), sync=$('syncNow');
  const cancelling=cancelPending||!!(p&&p.cancelRequested);
  cancel.disabled=cancelling;setBtn(cancel,cancelling?'Cancelling…':'Cancel',cancelling);
  // While either one is going, both buttons are off: a month has one job at a time.
  btn.disabled=true;sync.disabled=true;$('runOpts').disabled=true;showRunOptions(false);
  if(syncing){
    showSyncProgress(p,'Syncing this month from Asana…');
    $('runCount').textContent=syncCount(p)+'Not checking Google';
    setBtn(sync,'Syncing…',true);
    setBtn(btn,runLabel(),false,PLAY);
    return;
  }
  setBtn(sync,'Sync from Asana',false);
  if(p&&p.phase==='checking'&&p.reviewsTotal){
    const n=Math.min(p.doneLocations.length+1,p.totalLocations);
    $('runBar').classList.remove('indet');
    $('runFill').style.width=(p.reviewsDone/p.reviewsTotal*100)+'%';
    $('runText').textContent=cancelling?'Stopping after the current review…':'Checking '+(p.location||'reviews with no location');
    $('runCount').textContent='Location '+n+' of '+p.totalLocations+'  ·  '+p.reviewsDone.toLocaleString()+' of '+p.reviewsTotal.toLocaleString()+' reviews'
      +(p.syncedMinutesAgo==null?'':'  ·  Asana sync from '+(p.syncedMinutesAgo<1?'under a minute':p.syncedMinutesAgo+' min')+' ago');
    setBtn(btn,'Running · '+n+' of '+p.totalLocations,true);
  }else{
    if(p)showSyncProgress(p,cancelling?'Stopping…':'Syncing review tasks from Asana…');
    else{$('runBar').classList.add('indet');$('runText').textContent=cancelling?'Stopping…':'A check is running for this month…'}
    $('runCount').textContent=p?syncCount(p).replace(/  ·  $/,''):'';
    setBtn(btn,p&&p.sync&&p.sync.total?'Syncing · '+syncPct(p.sync)+'%':'Running check…',true);
  }
}

/** Sync progress: Asana tasks with subtasks opened so far, of those found so far (the total grows as the walk goes deeper). */
function syncPct(s){return Math.min(100,Math.floor(s.done/s.total*100))}
function showSyncProgress(p,text){
  $('runText').textContent=text;
  const s=p&&p.sync;
  if(s&&s.total){$('runBar').classList.remove('indet');$('runFill').style.width=syncPct(s)+'%'}
  else $('runBar').classList.add('indet');
}
function syncCount(p){
  const s=p&&p.sync;
  if(!s)return '';
  return (s.total?syncPct(s)+'%  ·  '+s.done.toLocaleString()+' of '+s.total.toLocaleString()+' tasks opened  ·  ':'')+s.scanned.toLocaleString()+' tasks read  ·  ';
}

/** Follows a live run: every 2 seconds while it is in this server, else falls back to a slow refresh. */
async function pollRun(){
  clearTimeout(pollTimer);
  const project=currentProject;
  let p=null;
  try{p=await api(withProject('api/run-progress'))}catch(e){}
  if(project!==currentProject)return;
  const wasLive=!!runState;
  runState=p&&p.running?p:null;
  renderRun();markLocations();
  if(runState){
    // Every 10 seconds, also refresh the numbers the run is changing.
    if(++pollCount%5===0)Promise.all([loadSummary(),loadStatus(),loadActivity(),loadReviews()]).catch(()=>{});
    pollTimer=setTimeout(pollRun,2000);
  }else if(wasLive){cancelPending=false;refresh().catch(()=>{})}
  else if(monthRunning)pollTimer=setTimeout(()=>refresh().catch(()=>{}),10000);
}

$('syncNow').onclick=async()=>{
  if(!currentProject||monthRunning)return;
  const m=availableMonths.find(x=>x.projectGid===currentProject);
  const btn=$('syncNow');btn.disabled=true;$('runNow').disabled=true;setBtn(btn,'Starting…',true);
  try{
    const r=await fetch('api/sync-month',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectGid:currentProject,name:m&&m.name})});
    const j=await r.json();
    if(!j.started)$('monthNote').textContent='Could not start the sync: '+(j.reason||'unknown error');
  }catch(e){$('monthNote').textContent='Failed to start the sync: '+e.message}
  await loadMonths();
};

$('cancelRun').onclick=async()=>{
  if(!currentProject||cancelPending)return;
  cancelPending=true;renderRun();
  try{
    const r=await fetch('api/cancel-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectGid:currentProject})});
    if(!r.ok)throw new Error(r.status);
  }catch(e){cancelPending=false;$('monthNote').textContent='Could not cancel: '+e.message;renderRun();return}
  // No live run behind the mark (left over from a restart): it is released straight away.
  if(!runState){cancelPending=false;refresh().catch(()=>{})}
};

$('runNow').onclick=async()=>{
  if(!currentProject)return;
  const m=availableMonths.find(x=>x.projectGid===currentProject);
  const btn=$('runNow');btn.disabled=true;$('syncNow').disabled=true;$('runOpts').disabled=true;showRunOptions(false);setBtn(btn,'Starting…',true);
  try{
    const r=await fetch('api/run-month',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectGid:currentProject,name:m&&m.name,...runRequest()})});
    const j=await r.json();
    if(!j.started)$('monthNote').textContent='Could not start: '+(j.reason||'unknown error');
  }catch(e){$('monthNote').textContent='Failed to start: '+e.message}
  await loadMonths();
};

function startOfDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
function dayLabel(d){
  const dt=new Date(d);
  const diff=Math.round((startOfDay(dt)-startOfDay(new Date()))/86400000);
  if(diff===0)return'Today';
  if(diff===-1)return'Yesterday';
  if(diff===1)return'Tomorrow';
  return dt.toLocaleDateString([], {month:'short',day:'numeric'});
}
function timeLabel(d){return new Date(d).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}
function pct(n,total){return total?(Math.round(n/total*1000)/10)+'%':'0%'}

async function loadSummary(){
  const s=await api(withProject('api/summary'));
  monthTotal=s.monitored;renderRunOptions();
  const st=$('stats');st.replaceChildren();
  const big=el('div',null,'big');
  st.append(el('div','Reviews monitored','cap'),big);
  countTo(big,'monitored',s.monitored);
  const rows=el('div',null,'rows');
  for(const [k,v,c] of [['Still available',s.exists,'green'],['Removed',s.removed,'red'+(s.removed?' hot':'')],['Could not be checked',s.unknown,''],['Removed in Asana',s.taggedRemoved,'asana']]){
    const line=el('div',null,'line '+c);
    const key=el('div',null,'k');key.append(document.createElement('i'),document.createTextNode(k));
    if(c==='asana')line.title='Tagged "Successfully removed" in Asana as of the last sync. Counted on its own, so it overlaps the lines above.';
    line.append(key,el('div',v.toLocaleString(),'v'),el('div',pct(v,s.monitored),'p'));
    rows.append(line);
  }
  st.append(rows);

  $('schedule').textContent='Last check: '+(s.lastCheckAt?dayLabel(s.lastCheckAt)+', '+timeLabel(s.lastCheckAt):'never')
    +'   ·   Next check: '+(s.nextCheckAt?dayLabel(s.nextCheckAt)+', '+timeLabel(s.nextCheckAt):'not scheduled');

  const fail=$('failBanner');
  if(s.notificationsFailing){fail.textContent=s.notificationsFailing+' removal notification(s) could not be emailed. They will be retried at the next run.';fail.classList.add('show')}
  else fail.classList.remove('show');

  const unk=$('unknownBanner');
  if(s.unknown){unk.textContent='⚠ '+s.unknown+' review(s) could not be checked. They will be retried automatically.';unk.classList.add('show')}
  else unk.classList.remove('show');

  return s;
}

/** The person working on a dispute: its own Asana assignee, else whoever has the location. */
const workedOnBy=r=>r.assignee_name||r.location_assignee_name||null;
function notifTag(r){
  if(!r.notification_sent&&r.asana_tagged_removed)return ['Already tagged in Asana','sent'];
  if(!r.notification_sent)return r.last_notification_error?['Failed, will retry','failed']:['Pending','pending'];
  return ['Notified '+dayLabel(r.notification_sent_at),'sent'];
}

async function loadStatus(){
  const rows=await api(withProject('api/removed'));
  const box=$('status');box.replaceChildren();
  if(!rows.length){
    const c=el('div',null,'card ok');
    c.append(el('p','🟢 No new reviews have been removed.','headline'),el('p','Everything is working normally.','subline'));
    box.append(c);return;
  }
  const c=el('div',null,'card attn');
  c.append(el('p','🔴 '+rows.length+' review'+(rows.length>1?'s':'')+' removed','headline'),
    el('p','These reviews were detected as removed during the most recent check.','subline'));
  const list=el('ul',null,'removed-list');
  for(const r of rows){
    const li=document.createElement('li');
    const left=el('div',null,'left');left.append(el('span',r.reviewer_name||'Unknown reviewer','who'),el('span',(r.location||'Unknown location')+'  ·  '+(workedOnBy(r)?'Worked on by '+workedOnBy(r):'Nobody assigned in Asana'),'where'));
    const [tagText,tagCls]=notifTag(r);
    const right=el('div',null,'right');
    right.append(el('span','Removed '+dayLabel(r.removed_at),'when'), el('span',tagText,'tag '+tagCls));
    right.append(logoLink('google',r.google_review_url),logoLink('asana',r.asana_task_url));
    li.append(left,right);
    list.append(li);
  }
  c.append(list);box.append(c);
}

const NO_LOCATION='__none__';
let currentLocation=null, locations=[], lastWorking=null;
const locButtons=new Map();
const STATUS_TAG={REVIEW_EXISTS:['Still available','sent'],REVIEW_REMOVED:['Removed','failed'],UNKNOWN:['Not checked','pending']};
const locValue=l=>l.location==null?NO_LOCATION:l.location;
const locName=v=>v===NO_LOCATION?'Unknown location':v;
// On phones the locations list folds away under its header; elsewhere it is always open.
const phone=matchMedia('(max-width:640px)');
function setLocOpen(open){
  $('side').classList.toggle('open',open);
  $('locToggle').setAttribute('aria-expanded',String(!phone.matches||open));
}
$('locToggle').onclick=()=>{if(phone.matches)setLocOpen(!$('side').classList.contains('open'))};
phone.addEventListener('change',()=>setLocOpen($('side').classList.contains('open')));
setLocOpen(false);

async function loadLocations(){
  locations=await api(withProject('api/locations'));
  if(!locations.some(l=>locValue(l)===currentLocation))currentLocation=null;
  const m=availableMonths.find(x=>x.projectGid===currentProject);
  $('locScope').textContent=(m?m.name:'All months')+' · '+locations.length+' location'+(locations.length===1?'':'s');
  renderLocations();
  await loadReviews();
}

function renderLocations(){
  const q=$('locSearch').value.trim().toLowerCase();
  $('locPicked').textContent=currentLocation?locName(currentLocation):'Choose a location';
  const list=$('locList');list.replaceChildren();locButtons.clear();
  const shown=locations.filter(l=>!q||locName(locValue(l)).toLowerCase().includes(q));
  if(!shown.length){list.append(el('li',locations.length?'No locations match.':'No locations synced for this month yet.','empty'));return}
  for(const l of shown){
    const v=locValue(l);
    const b=el('button',null,v===currentLocation?'active':'');b.type='button';
    if(v===currentLocation)b.setAttribute('aria-current','true');
    const mark=el('span',null,'mark');
    b.append(el('span',locName(v),'name'),mark,el('span',l.count,'n'));
    b.onclick=()=>selectLocation(v);
    locButtons.set(v,{btn:b,mark});
    const li=document.createElement('li');li.append(b);list.append(li);
  }
  markLocations();
}

/** During a live run: a spinner on the location being checked, a tick on those already done. */
function markLocations(){
  const p=runState&&runState.phase==='checking'?runState:null;
  const key=x=>x==null?NO_LOCATION:x;
  const done=new Set(p?p.doneLocations.map(key):[]);
  const working=p?key(p.location):null;
  for(const [v,{btn,mark}] of locButtons){
    const st=v===working?'working':done.has(v)?'done':'';
    if(mark.dataset.s===st)continue;
    mark.dataset.s=st;
    mark.replaceChildren(...(st==='working'?[el('span',null,'spin')]:st==='done'?[icon(CHECK)]:[]));
    mark.title=st==='working'?'Being checked now':st==='done'?'Checked in this run':'';
  }
  // Keep the location being checked in view, unless the list is being browsed.
  if(working!==lastWorking){
    lastWorking=working;
    const cur=locButtons.get(working);
    // Not on phones, where the list is part of the page and this would scroll the whole page.
    if(cur&&!phone.matches&&!$('locList').matches(':hover'))cur.btn.scrollIntoView({block:'nearest'});
  }
}
$('locSearch').oninput=renderLocations;

function selectLocation(v){
  currentLocation=v;
  $('locationNote').textContent='';$('googleReviews').replaceChildren();
  renderLocations();
  if(phone.matches){setLocOpen(false);$('locTitle').closest('.card').scrollIntoView({block:'start'})}
  $('reviews').replaceChildren(loadingRow('Loading reviews…'));
  loadReviews().catch(showReviewsError);
}

let checkingLocation=false;
$('checkLocation').onclick=async()=>{
  if(!currentLocation||checkingLocation)return;
  const location=currentLocation, btn=$('checkLocation'), note=$('locationNote');
  checkingLocation=true;btn.disabled=true;setBtn(btn,'Checking…',true);
  note.textContent='Checking this location against Google — this can take a minute.';
  try{
    const r=await fetch('api/check-location',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({projectGid:currentProject,location:location===NO_LOCATION?null:location})});
    if(!r.ok)throw new Error(r.status);
    const j=await r.json();
    note.textContent=j.ok?'Checked '+j.checked+' review'+(j.checked===1?'':'s')+': '+j.exists+' still available, '+j.removed+' removed, '+j.unknown+' could not be checked.'
      :'Could not check: '+(j.reason||'unknown error');
  }catch(e){note.textContent='Check failed: '+e.message}
  checkingLocation=false;setBtn(btn,'Check now',false);
  await Promise.all([loadSummary(),loadStatus(),loadReviews(),loadActivity()]).catch(showReviewsError);
};

// Display only: shows the reviews Google returns for the selected location. Changes nothing.
let loadingGoogle=false;
$('loadGoogle').onclick=async()=>{
  if(!currentLocation||currentLocation===NO_LOCATION||loadingGoogle)return;
  const location=currentLocation, btn=$('loadGoogle'), box=$('googleReviews');
  loadingGoogle=true;btn.disabled=true;setBtn(btn,'Loading…',true);
  const head=el('div',null,'google-head');
  try{
    const j=await api(withProject('api/places-reviews?location='+encodeURIComponent(location)));
    if(!j.ok){head.append(el('div','Could not load Google reviews: '+(j.reason||'unknown error'),'empty'))}
    else{
      const p=j.place;
      head.append(el('div','On Google: '+(p.name||'Unknown business'),'name'));
      const meta=[];
      if(p.address)meta.push(p.address);
      if(p.rating!=null)meta.push(p.rating+'★');
      if(p.totalReviews!=null)meta.push(p.totalReviews+' reviews on Google');
      if(!p.confirmed)meta.push('top search result, not confirmed against a review link');
      head.append(el('div',meta.join('  ·  '),'meta'));
      if(!p.reviews.length)head.append(el('div','No individual reviews were returned for this business.','empty'));
      else{
        head.append(el('div','Showing '+p.reviews.length+' review'+(p.reviews.length===1?'':'s')+' returned, newest first.','meta'));
        const list=el('ul',null,'review-list');
        for(const r of p.reviews){
          const li=document.createElement('li');
          const top=el('div',null,'top');
          top.append(el('span',r.author||'Unknown reviewer','who'));
          if(r.rating!=null)top.append(el('span',r.rating+'★','tag pending'));
          if(r.googleMapsUri&&/^https:\\/\\//.test(r.googleMapsUri)){
            const links=el('div',null,'links');
            links.append(logoLink('google',r.googleMapsUri));top.append(links);
          }
          li.append(top);
          if(r.publishedAt)li.append(el('div','Posted '+new Date(r.publishedAt).toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'}),'meta'));
          if(r.text)li.append(el('div',r.text,'text'));
          list.append(li);
        }
        head.append(list);
      }
    }
  }catch(e){head.append(el('div','Could not load Google reviews: '+e.message,'empty'))}
  loadingGoogle=false;setBtn(btn,'Load Google reviews',false);
  btn.disabled=!currentLocation||currentLocation===NO_LOCATION;
  if(currentLocation===location)box.replaceChildren(head);
};

function showReviewsError(e){$('locRemoved').replaceChildren();$('reviews').replaceChildren(el('div','Failed to load reviews: '+e.message,'empty'))}

async function loadReviews(){
  const box=$('reviews');
  $('checkLocation').disabled=!currentLocation||checkingLocation;
  $('loadGoogle').disabled=!currentLocation||currentLocation===NO_LOCATION||loadingGoogle;
  $('locTitle').textContent=currentLocation?locName(currentLocation):'Reviews by location';
  const worker=$('locWorker'), removedBox=$('locRemoved');
  if(!currentLocation){worker.replaceChildren();removedBox.replaceChildren();box.replaceChildren(el('div',(phone.matches?'Choose a location above':'Choose a location on the left')+' to see its reviews for this month.','empty'));return}
  const q=currentLocation===NO_LOCATION?'api/reviews':'api/reviews?location='+encodeURIComponent(currentLocation);
  const rows=await api(withProject(q));
  if(!rows.length){worker.replaceChildren();removedBox.replaceChildren();box.replaceChildren(el('div','No reviews for this location.','empty'));return}

  // Who has this location in Asana (the location task's assignee).
  const owner=(rows.find(r=>r.location_assignee_name)||{}).location_assignee_name;
  if(owner)worker.replaceChildren(document.createTextNode('Worked on by '),el('b',owner),document.createTextNode(' (from Asana)'));
  else worker.replaceChildren(document.createTextNode('Nobody is assigned to this location in Asana.'));

  // Removed disputes at this location.
  const gone=rows.filter(r=>r.status==='REVIEW_REMOVED');
  const sec=el('div',null,'locremoved'+(gone.length?' has':''));
  sec.append(el('h3',gone.length?gone.length+' removed dispute'+(gone.length>1?'s':''):'Removed disputes'));
  if(!gone.length)sec.append(el('div','None of the disputed reviews at this location has been removed.','none'));
  else{
    const list=el('ul',null,'removed-list');
    for(const r of gone){
      const li=document.createElement('li');
      const left=el('div',null,'left');
      left.append(el('span',r.reviewer_name||'Unknown reviewer','who'),el('span',workedOnBy(r)?'Worked on by '+workedOnBy(r):'Nobody assigned in Asana','where'));
      const [tagText,tagCls]=notifTag(r);
      const right=el('div',null,'right');
      right.append(el('span',r.removed_at?'Removed '+dayLabel(r.removed_at):'Removed','when'),el('span',tagText,'tag '+tagCls),logoLink('google',r.google_review_url),logoLink('asana',r.asana_task_url));
      li.append(left,right);list.append(li);
    }
    sec.append(list);
  }
  removedBox.replaceChildren(sec);

  const table=el('table',null,'stack');
  const hr=document.createElement('tr');
  for(const h of ['Reviewer','Worked on by','Status','Last checked','Links'])hr.append(el('th',h));
  const label=(td,text)=>{td.dataset.label=text;return td};
  const thead=document.createElement('thead');thead.append(hr);
  const tbody=document.createElement('tbody');
  for(const r of rows){
    const tr=document.createElement('tr');
    const who=el('td',null,'full');
    who.append(el('div',r.reviewer_name||'Unknown reviewer','who'),el('div',r.asana_task_name+(r.rating?'  ·  '+r.rating+'★':''),'meta'));
    if(r.status==='UNKNOWN'&&r.last_error)who.append(el('div','Reason: '+r.last_error,'meta'));
    const by=el('td',workedOnBy(r)||'—');if(!workedOnBy(r))by.title='Nobody is assigned in Asana';
    const [tagText,tagCls]=STATUS_TAG[r.status]||STATUS_TAG.UNKNOWN;
    const st=el('td',null,'nowrap');
    st.append(el('span',r.status==='UNKNOWN'&&r.last_checked_at?'Could not be checked':tagText,'tag '+tagCls));
    if(r.status==='REVIEW_REMOVED'&&r.removed_at)st.append(el('div','Removed '+dayLabel(r.removed_at),'meta'));
    const when=el('td',r.last_checked_at?dayLabel(r.last_checked_at)+', '+timeLabel(r.last_checked_at):'Never','nowrap');
    const links=el('td',null,'nowrap');
    links.append(logoLink('google',r.google_review_url),logoLink('asana',r.asana_task_url));
    tr.append(who,label(by,'Worked on by'),label(st,'Status'),label(when,'Last checked'),label(links,'Links'));tbody.append(tr);
  }
  table.append(thead,tbody);
  const wrap=el('div',null,'tablewrap');wrap.append(table);
  box.replaceChildren(wrap);
}

async function loadActivity(){
  const days=await api(withProject('api/activity'));
  const box=$('activity');box.replaceChildren();
  if(!days.length){box.append(el('div','No checks recorded yet.','empty'));return}
  for(const d of days.slice(0,10)){
    const row=el('div',null,'row');
    const what=el('div',null,'what');
    if(d.removed>0){
      what.append(el('b',d.removed+' review'+(d.removed>1?'s':'')+' removed'),document.createTextNode(' — '));
      what.append(document.createTextNode([...new Set(d.removedDetails.map(x=>x.location||'Unknown location'))].join(', ')));
    } else {
      what.append(el('b','Check completed'),document.createTextNode(' — '+d.checked+' checked'));
    }
    row.append(el('div',dayLabel(d.date),'when'), what);
    box.append(row);
  }
}

// ---- Audit page ----
const AUDIT_KIND={run:'Check',sync:'Sync',location:'Check',daily:'Daily',google:'Google',settings:'Settings',system:'System'};
let auditFilter='', auditOldest=null;
function auditRow(e){
  const tr=document.createElement('tr');
  const when=el('td',dayLabel(e.at)+', '+timeLabel(e.at),'nowrap');when.title=new Date(e.at).toLocaleString();when.dataset.label='When';
  const who=el('td',null,'nowrap');who.dataset.label='Who';
  const auto=e.actor==='scheduler'||e.actor==='system';
  who.append(el('span',auto?(e.actor==='scheduler'?'Scheduler':'System'):e.actor,'who-tag'+(auto?' auto':'')));
  const what=el('td',null,'full');
  what.append(el('span',AUDIT_KIND[e.action.split('.')[0]]||'Other','kind'),document.createTextNode(e.summary));
  tr.append(when,who,what);return tr;
}
async function loadAudit(older){
  const body=$('auditRows');
  if(!older){auditOldest=null;body.replaceChildren();const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=3;td.append(loadingRow('Loading the audit log…'));tr.append(td);body.append(tr)}
  const q=['api/audit?filter='+encodeURIComponent(auditFilter)];
  if(older&&auditOldest)q.push('before='+auditOldest);
  let j;
  try{j=await api(q.join('&'))}catch(e){const tr=document.createElement('tr');tr.append(Object.assign(el('td','Could not load the audit log: '+e.message,'empty'),{colSpan:3}));body.replaceChildren(tr);return}
  if(!older)body.replaceChildren();
  for(const e of j.entries){body.append(auditRow(e));auditOldest=e.id}
  if(!body.children.length){const tr=document.createElement('tr');tr.append(Object.assign(el('td',auditFilter?'Nothing of this kind has been recorded yet.':'Nothing has been recorded yet. Actions taken from now on will appear here.','empty'),{colSpan:3}));body.append(tr)}
  $('auditMore').hidden=!j.more;
}
for(const b of $('auditFilter').children)b.onclick=()=>{
  auditFilter=b.dataset.filter;
  for(const x of $('auditFilter').children)x.classList.toggle('on',x===b);
  loadAudit(false);
};
$('auditOlder').onclick=()=>loadAudit(true);

// ---- Configure page ----
let cfg=null;
const cfgRead=()=>({
  reviewChecker:$('cfgSource').value,
  reviewCheckerFallback:$('cfgFallback').value,
  reviewsPerLocation:$('cfgMax').value===''?NaN:Number($('cfgMax').value),
  syncFreshMinutes:$('cfgSyncFresh').value===''?NaN:Number($('cfgSyncFresh').value),
  dataforseoPriority:$('cfgDfsFast').checked,
  dailyCheckEnabled:$('cfgDaily').checked,
});
const cfgDirty=()=>{if(!cfg)return false;const now=cfgRead();return Object.keys(now).some(k=>now[k]!==cfg.settings[k]&&!(Number.isNaN(now[k])&&Number.isNaN(cfg.settings[k])))};
function cfgMessage(text,kind){const m=$('cfgMsg');m.textContent=text||'';m.className='banner'+(text?' show '+(kind||'note'):'')}
function scheduleText(c){
  const m=/^(\\d{1,2}) (\\d{1,2}) \\* \\* \\*$/.exec(c.schedule.cron);
  const when=m?'Every day at '+m[2].padStart(2,'0')+':'+m[1].padStart(2,'0'):'Schedule: '+c.schedule.cron;
  const next=c.schedule.nextCheckAt?' Next: '+dayLabel(c.schedule.nextCheckAt)+', '+timeLabel(c.schedule.nextCheckAt)+' your time.':' Currently turned off.';
  return when+' ('+c.schedule.timezone+' time).'+next;
}
function cfgFill(c){
  cfg=c;
  const fill=(sel,none)=>{
    const s=$(sel);s.replaceChildren();
    if(none){const o=el('option','No fallback');o.value='';s.append(o)}
    for(const x of c.sources){const o=el('option',x.label+(x.configured?'':' (not set up)'));o.value=x.id;o.disabled=!x.configured;s.append(o)}
  };
  fill('cfgSource',false);fill('cfgFallback',true);
  $('cfgSource').value=c.settings.reviewChecker;
  $('cfgFallback').value=c.settings.reviewCheckerFallback;
  $('cfgMax').value=c.settings.reviewsPerLocation;
  $('cfgSyncFresh').value=c.settings.syncFreshMinutes;syncFresh=c.settings.syncFreshMinutes;
  sharedDepth=takesDepth(c)?c.settings.reviewsPerLocation:null;renderRunOptions();
  $('cfgDfsFast').checked=c.settings.dataforseoPriority;
  $('cfgDaily').checked=c.settings.dailyCheckEnabled;
  $('cfgSchedule').textContent=scheduleText(c);
  $('cfgReset').hidden=!c.overridden;
  const box=$('cfgConnections');box.replaceChildren();
  for(const x of c.connections){const r=el('div',null,'r'+(x.ok?'':' bad'));r.append(el('span',x.label,'k'),el('span',x.detail,'v'));box.append(r)}
  for(const x of c.sources){const r=el('div',null,'r');r.append(el('span',x.label,'k'),el('span',x.configured?'Set up':'Not set up','v'));box.append(r)}
  $('cfgSave').disabled=true;
}
async function loadAccounts(){
  const box=$('cfgAccounts');box.replaceChildren(loadingRow('Reading balances…'));
  let list;
  try{list=await api('api/accounts')}catch(e){box.replaceChildren(el('div','Could not read the balances: '+e.message,'empty'));return}
  box.replaceChildren();
  for(const a of list){const r=el('div',null,'r'+(a.attention?' bad':''));r.append(el('span',a.service,'k'),el('span',a.detail,'v'));box.append(r)}
  if(!list.length)box.append(el('div','No paid review service is set up.','empty'));
}
async function loadConfig(){
  let c;
  try{c=await api('api/config')}catch(e){cfgMessage('Could not load the settings: '+e.message,'bad');return}
  if(!c.available){$('cfgBody').hidden=true;$('cfgSave').hidden=true;cfgMessage('Settings cannot be changed in this environment.','note');return}
  cfgFill(c);
  loadAccounts();
}
for(const id of ['cfgSource','cfgFallback','cfgMax','cfgSyncFresh','cfgDfsFast','cfgDaily'])$(id).addEventListener('input',()=>{$('cfgSave').disabled=!cfgDirty();cfgMessage('')});
async function cfgSend(path,method,body){
  const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!r.ok)throw new Error(r.status);
  return r.json();
}
$('cfgSave').onclick=async()=>{
  const btn=$('cfgSave');btn.disabled=true;setBtn(btn,'Saving…',true);
  try{
    const j=await cfgSend('api/config','PUT',cfgRead());
    if(!j.ok){cfgMessage(j.reason||'Could not save.','bad');btn.disabled=false}
    else{cfgFill(j);cfgMessage(j.changes.length?'Saved. '+j.changes.join('. ')+'.':'Nothing was changed.','good');loadSummary().catch(()=>{})}
  }catch(e){cfgMessage('Could not save: '+e.message,'bad');btn.disabled=false}
  setBtn(btn,'Save changes',false);
};
$('cfgReset').onclick=async()=>{
  const btn=$('cfgReset');btn.disabled=true;
  try{
    const j=await cfgSend('api/config/reset','POST');
    if(j.ok){cfgFill(j);cfgMessage('Settings are back to the values in the .env file.','good');loadSummary().catch(()=>{})}
    else cfgMessage(j.reason||'Could not reset.','bad');
  }catch(e){cfgMessage('Could not reset: '+e.message,'bad')}
  btn.disabled=false;
};

// ---- Pages: the rail switches between Insights, Audit and Configure ----
let currentView='insights';
function route(){
  const h=location.hash.slice(1);
  const view=h==='audit'||h==='configure'?h:'insights';
  $('viewInsights').hidden=view!=='insights';
  $('viewAudit').hidden=view!=='audit';
  $('viewConfig').hidden=view!=='configure';
  $('panel').classList.toggle('full',view!=='insights');
  for(const a of document.querySelectorAll('.rail a'))a.classList.toggle('active',a.dataset.view===view||(!a.dataset.view&&a.getAttribute('href')==='#'+h&&view==='insights'));
  if(view==='insights'&&!document.querySelector('.rail a.active'))document.querySelector('.rail a[data-view=insights]').classList.add('active');
  const opened=view!==currentView;currentView=view;
  if(view==='audit'&&opened)loadAudit(false);
  if(view==='configure'&&opened){cfgMessage('');loadConfig()}
  // Removed / Activity are sections of the Insights page.
  if(view==='insights'&&(h==='removedSection'||h==='activitySection')){const t=$(h);if(t)t.scrollIntoView()}
}
window.addEventListener('hashchange',route);

async function refresh(){await loadMonths();await Promise.all([loadSummary(),loadStatus(),loadLocations(),loadActivity()])}
route();
refresh().catch(e=>{$('schedule').textContent='Failed to load: '+e.message});
setInterval(refresh,60000);
</script></body></html>`;
