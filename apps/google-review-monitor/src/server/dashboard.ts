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
  .helpbtn{font-weight:700;font-size:15px}
  .topbar .helpbtn+.themebtn{margin-left:0}
  /* "How to use it for now": shown on arrival until ticked off, and from the ? button. */
  .howto{width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 60px rgba(15,23,42,.35)}
  .howto::backdrop{background:rgba(15,23,42,.5)}
  .howto[open]{animation:popin .18s ease-out;display:flex;flex-direction:column}
  .howto .hd{display:flex;gap:12px;align-items:flex-start;padding:20px 22px 0}
  .howto .ic{flex:none;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--magenta-tint);color:var(--magenta-ink);font-size:19px}
  .howto h2{margin:0;font-size:17px;letter-spacing:-.01em}
  .howto .lead{margin:3px 0 0;font-size:13px;color:var(--muted)}
  .howto .bd{padding:14px 22px 4px;overflow-y:auto}
  .howto ol{margin:0;padding:0;list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:10px}
  .howto li{counter-increment:s;display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;font-size:13.5px}
  .howto li::before{content:counter(s);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--magenta-ink);background:var(--magenta-tint)}
  .howto li b{font-weight:600}
  .howto li .d{display:block;color:var(--muted);font-size:12.5px;margin-top:1px}
  .howto li .w{display:block;margin-top:4px;padding:5px 8px;border-radius:7px;background:var(--hover);font-size:12px;color:var(--text)}
  .howto li .w i,.guide-pg i.ui{font-style:normal;font-weight:600;color:var(--magenta-ink)}
  .howto .ft-r{display:flex;align-items:center;gap:14px;margin-left:auto}
  .howto .guide{font-size:13px;font-weight:600;color:var(--magenta-ink);text-decoration:none}
  .howto .guide:hover{text-decoration:underline}
  .howto .ok{margin:14px 0 0;padding:10px 12px;border-radius:10px;font-size:12.5px;background:var(--green-tint);color:var(--green-dark)}
  .howto .ft{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 22px 18px}
  .howto .ft label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer}
  .howto .ft input{width:16px;height:16px;margin:0;accent-color:var(--magenta)}
  @media (prefers-reduced-motion:reduce){.howto[open]{animation:none}}
  /* ---- Help: the user guide ---- */
  .guide{display:grid;grid-template-columns:200px minmax(0,1fr);gap:24px;align-items:start}
  .toc{position:sticky;top:0;display:flex;flex-direction:column;gap:2px}
  .toc button{font:inherit;font-size:13px;font-weight:500;text-align:left;color:var(--muted);background:none;border:0;border-left:2px solid var(--border);padding:7px 12px;cursor:pointer}
  .toc button:hover{color:var(--text);border-left-color:var(--muted)}
  .toc button.on{color:var(--magenta-ink);border-left-color:var(--magenta);font-weight:600}
  .gbody{display:flex;flex-direction:column;gap:16px;min-width:0;max-width:760px}
  .gbody .card{padding:20px 22px;scroll-margin-top:12px}
  .gbody h2{font-size:17px;margin:0 0 6px;letter-spacing:-.01em}
  .gbody h3{font-size:14px;margin:18px 0 6px}
  .gbody p,.gbody li,.gbody dd{font-size:13.5px;line-height:1.6}
  .gbody p{margin:6px 0}
  .gbody ul,.gbody ol{margin:6px 0;padding-left:20px;display:flex;flex-direction:column;gap:5px}
  .gbody b{font-weight:600}
  .gbody .chip{vertical-align:1px}
  .gbody dl{margin:6px 0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px;align-items:baseline}
  .gbody dt{font-weight:600;font-size:13.5px}
  .gbody dd{margin:0}
  .gbody dl.faq{grid-template-columns:minmax(0,1fr);gap:2px}
  .gbody dl.faq dt{margin-top:10px}
  .gbody dl.faq dt:first-child{margin-top:0}
  .gbody dl.faq dd{color:var(--muted)}
  .gnote{margin-top:12px!important;padding:10px 12px;border-radius:10px;background:var(--magenta-tint);color:var(--magenta-ink);font-weight:500}
  @media (max-width:900px){
    .guide{grid-template-columns:minmax(0,1fr)}
    .toc{position:static;flex-direction:row;flex-wrap:wrap;gap:6px}
    .toc button{border:1px solid var(--border);border-radius:999px;padding:5px 11px;background:var(--surface)}
    .toc button.on{border-color:var(--magenta)}
  }
  @media (max-width:640px){
    .gbody .card{padding:16px}
    .gbody dl{grid-template-columns:minmax(0,1fr);gap:2px}
    .gbody dl dd{margin-bottom:8px}
  }
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
  /* Removed list tools: who worked on it, the order, and how many are shown. */
  .rtools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
  /* Worked on by: a pill button opening a menu (the month picker's look); sort: a three-way toggle. */
  .rwho{position:relative;min-width:0}
  .rwho-btn{display:inline-flex;align-items:center;gap:8px;max-width:100%;height:34px;padding:0 10px 0 5px;font:inherit;font-size:13px;font-weight:600;color:var(--text);background:var(--surface);border:1px solid var(--red-line);border-radius:999px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
  .rwho-btn:hover,.rwho-btn[aria-expanded="true"]{border-color:var(--red);box-shadow:0 1px 4px rgba(153,27,27,.12)}
  .rwho-btn .lbl{color:var(--muted);font-weight:500}
  .rwho-btn .val{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rwho-btn .chev{flex:none;width:13px;height:13px;fill:none;stroke:var(--muted);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s}
  .rwho-btn[aria-expanded="true"] .chev{transform:rotate(180deg)}
  .av{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:700;letter-spacing:.02em;color:var(--magenta-ink);background:var(--magenta-tint)}
  .av.all{color:var(--text);background:var(--hover)}
  .av.none{color:var(--muted);background:var(--hover)}
  .av svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .rwho .mb-pop{left:0;width:min(320px,calc(100vw - 32px));max-height:min(420px,60vh);overflow:auto;overscroll-behavior:contain}
  .rwho .mb-item .n{margin-left:auto;padding-left:8px;font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
  .rwho .mb-item[aria-checked="true"] .n{color:var(--magenta-ink)}
  .rwho .mb-item .check{margin-left:6px}
  .rwho .mb-item.zero .name{color:var(--muted);font-weight:500}
  .rwho .mb-item.zero .n{font-weight:500}
  .rwho .mb-item.zero:disabled{opacity:.8}
  .rseg{display:inline-flex;height:34px;padding:2px;gap:2px;background:var(--surface);border:1px solid var(--red-line);border-radius:999px}
  .rseg button{font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);background:none;border:0;border-radius:999px;padding:0 12px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
  .rseg button:hover{color:var(--text)}
  .rseg button[aria-pressed="true"]{color:#fff;background:var(--magenta)}
  /* The friendly note about people with nothing removed yet. */
  .rnote{display:flex;gap:10px;align-items:flex-start;margin-top:10px;padding:10px 12px;background:var(--surface);border:1px dashed var(--green-line);border-radius:10px;font-size:12.5px;color:var(--text)}
  .rnote .ic{flex:none;font-size:15px;line-height:1.3}
  .rnote b{font-weight:600}
  .rnote .sub{color:var(--muted)}
  .rtools .shown{margin-left:auto;font-size:12.5px;color:var(--red);opacity:.85;white-space:nowrap;font-variant-numeric:tabular-nums}
  .pager{display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;margin-top:12px}
  .pager button{font:inherit;font-size:13px;font-weight:600;min-width:34px;height:34px;padding:0 10px;color:var(--text);background:var(--surface);border:1px solid var(--red-line);border-radius:8px;cursor:pointer;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;justify-content:center;gap:4px}
  .pager button:hover:not(:disabled){border-color:var(--red)}
  .pager button[aria-current="page"]{color:#fff;background:var(--magenta);border-color:var(--magenta)}
  .pager button:disabled{opacity:.45;cursor:default}
  .pager .gap{min-width:20px;text-align:center;color:var(--muted)}
  .pager svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
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
    .rail{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:0 10px 8px}
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
    .rtools .shown{margin-left:0;width:100%;order:3}
    .rseg{flex:1}
    .rseg button{flex:1;padding:0 6px}
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
<!-- Temporary: while the scraper runs on Vercel's free plan. Edit or remove once it moves to ngrok. -->
<dialog class="howto" id="howto" aria-labelledby="howtoTitle">
  <div class="hd">
    <span class="ic" aria-hidden="true">💡</span>
    <div>
      <h2 id="howtoTitle">How to use the monitor for now</h2>
      <p class="lead">Reviews are checked by our scraper on Vercel's free plan, which allows only a limited number of checks a month. Until we move it to ngrok, please:</p>
    </div>
  </div>
  <div class="bd">
    <ol>
      <li><span><b>Check one location at a time.</b><span class="d">That's about 4 checks.</span><span class="w">Where: pick the location in the <i>Locations</i> list on the left (on a phone, tap <i>Locations</i> at the top), then press <i>Check now</i> on its card.</span></span></li>
      <li><span><b>Run a Managed month in parts.</b><span class="d">A whole Managed month is about 4,000 checks, so do the first 1,000, then the last 1,000 another day.</span><span class="w">Where: <i>Run options</i>, next to <i>Run now</i> at the top of Insights → choose <i>The first</i> or <i>The last</i>, type 1000, press <i>Done</i>, then press the Run button.</span></span></li>
      <li><span><b>Legacy months can run in full.</b><span class="d">They're about 220 checks each.</span><span class="w">Where: open the month menu in the top bar; Legacy months have a <i>Legacy</i> chip. The filter icon on its left shows Legacy months only.</span></span></li>
      <li><span><b>Look at "Last check" before pressing Run now.</b><span class="d">Don't re-run reviews checked in the last 7 days.</span><span class="w">Where: the line under the <i>Insights</i> heading, e.g. "Last check: Today, 9:01 PM".</span></span></li>
      <li><span><b>One person runs the month checks.</b><span class="d">Everyone else uses Check now on single locations.</span></span></li>
    </ol>
    <p class="ok">"Could not be checked" isn't lost. Those reviews are tried again on the next run of that month.</p>
  </div>
  <div class="ft">
    <label><input type="checkbox" id="howtoHide">Don't show this again</label>
    <span class="ft-r"><a class="guide" href="#help" id="howtoGuide">Full user guide</a><button class="btn" id="howtoClose" type="button">Got it</button></span>
  </div>
</dialog>
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
    <button class="themebtn helpbtn" id="howtoOpen" type="button" aria-label="How to use the monitor for now" title="How to use the monitor for now">?</button>
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
    <a href="#help" data-view="help"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/></svg>Help</a>
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

    <main class="main guide-pg" id="viewHelp" hidden>
      <div class="pagehead">
        <div>
          <h1>User guide</h1>
          <div class="schedule">How to check reviews, read the results and who gets the removal alerts.</div>
        </div>
        <div class="runactions"><button class="btn ghost" id="helpTips" type="button">Show the quick tips</button></div>
      </div>
      <div class="guide">
        <nav class="toc" aria-label="Guide sections">
          <button type="button" data-to="g-start">Getting started</button>
          <button type="button" data-to="g-limits">The free-plan limit</button>
          <button type="button" data-to="g-check">Checking reviews</button>
          <button type="button" data-to="g-results">Reading the results</button>
          <button type="button" data-to="g-alerts">Removal alerts</button>
          <button type="button" data-to="g-asana">Working in Asana</button>
          <button type="button" data-to="g-pages">Audit and Configure</button>
          <button type="button" data-to="g-phone">On a phone</button>
          <button type="button" data-to="g-faq">Questions</button>
        </nav>
        <div class="gbody">
          <section class="card" id="g-start">
            <h2>Getting started</h2>
            <p>The monitor reads every disputed review from Asana and checks on Google whether it is still there. When one is gone, the right people get a Slack message.</p>
            <h3>Find your way around</h3>
            <ul>
              <li><b>Pick a month</b> in the bar at the top. Months are listed newest first. Legacy months have a <span class="chip legacy">Legacy</span> chip, and the filter icon on the left of the bar shows Managed or Legacy months only.</li>
              <li><b>Pick a location</b> in the <i class="ui">Locations</i> list on the left. Type in the search box to find one quickly.</li>
              <li><b>Use the menu</b> on the far left: <i class="ui">Insights</i> is the main page, <i class="ui">Removed</i> and <i class="ui">Activity</i> jump to those sections of it, then <i class="ui">Audit</i>, <i class="ui">Help</i> and <i class="ui">Configure</i>.</li>
              <li>The moon button in the top bar switches to dark mode. The <i class="ui">?</i> button opens the quick tips.</li>
            </ul>
            <p class="gnote">Nothing runs on a timer. Reviews are only checked when someone presses <i class="ui">Check now</i> or <i class="ui">Run now</i>.</p>
          </section>

          <section class="card" id="g-limits">
            <h2>The free-plan limit</h2>
            <p>Reviews are checked by our scraper on Vercel's free plan, which allows only a limited number of checks a month. Each review checked is one check. Until the scraper moves to ngrok:</p>
            <ul>
              <li><b>Check one location at a time</b> with <i class="ui">Check now</i>. That's about 4 checks.</li>
              <li><b>Run a Managed month in parts</b>: about 4,000 checks for the whole month, so use <i class="ui">Run options</i> to do 1,000 at a time.</li>
              <li><b>Legacy months can run in full</b>: about 220 checks each.</li>
              <li><b>Look at "Last check"</b> under the Insights heading before pressing Run now. Don't re-run reviews checked in the last 7 days.</li>
              <li><b>One person runs the month checks.</b> Everyone else uses Check now on single locations.</li>
            </ul>
          </section>

          <section class="card" id="g-check">
            <h2>Checking reviews</h2>
            <h3>One location: Check now</h3>
            <ol>
              <li>Pick the month in the top bar.</li>
              <li>Pick the location in the <i class="ui">Locations</i> list.</li>
              <li>Press <i class="ui">Check now</i> on the location's card. The result shows under it in a minute or so.</li>
            </ol>
            <h3>Part of a month: Run options</h3>
            <ol>
              <li>Press <i class="ui">Run options</i>, next to <i class="ui">Run now</i> at the top of Insights.</li>
              <li>Choose <i class="ui">The first</i> or <i class="ui">The last</i> and type how many reviews, e.g. 1000. They're counted in the order of the Locations list, and a location is never split.</li>
              <li>Press <i class="ui">Done</i>, then the Run button, which now says e.g. <i class="ui">Run first 1,000</i>.</li>
            </ol>
            <p>Your choice is remembered in your browser. <i class="ui">Back to defaults</i> in Run options returns to all reviews.</p>
            <h3>A whole month: Run now</h3>
            <p>With <i class="ui">All of this month's reviews</i> chosen in Run options, <i class="ui">Run now</i> checks every review in the month. A bar shows which location is being checked and how far along it is. <i class="ui">Cancel</i> stops it after the current review; anything already found removed is still alerted.</p>
            <h3>Sync from Asana</h3>
            <p><i class="ui">Sync from Asana</i> brings in new and changed dispute tasks for the month without checking Google. Use it after the team adds disputes in Asana. Run now also syncs first, unless the month was synced recently (how recently is set on Configure). Tick <i class="ui">Sync from Asana first anyway</i> in Run options to always sync.</p>
          </section>

          <section class="card" id="g-results">
            <h2>Reading the results</h2>
            <h3>The stats card</h3>
            <ul>
              <li><b>Reviews monitored</b>: disputes in the chosen month, split into <i class="ui">Still available</i>, <i class="ui">Removed</i>, <i class="ui">Could not be checked</i>, and <i class="ui">Removed in Asana</i> (tagged "Successfully removed" by the team).</li>
              <li><b>Disputes synced from Asana</b>: the total across every synced month, with rings showing how many months are synced (all, Managed, Legacy).</li>
            </ul>
            <h3>What each status means</h3>
            <dl>
              <dt><span class="tag sent">Still available</span></dt><dd>The review is still on Google.</dd>
              <dt><span class="tag failed">Removed</span></dt><dd>Google no longer shows it. Every removal is checked twice before it counts.</dd>
              <dt><span class="tag pending">Could not be checked</span></dt><dd>The scraper didn't get an answer from Google this time. It's tried again on the next run.</dd>
            </dl>
            <h3>Review status: the removed list</h3>
            <ul>
              <li><b>Worked on by</b>: show one person's removed reviews, or those not assigned in Asana. People with nothing removed yet are listed at the bottom with a 0.</li>
              <li><b>Newest · Reviewer A–Z · Location A–Z</b>: change the order.</li>
              <li>Long lists are split into pages of 10. Use <i class="ui">Prev</i>, the page numbers and <i class="ui">Next</i> under the list.</li>
              <li>Each removed review shows whether its alert was sent: <span class="tag pending">Pending</span>, <span class="tag sent">Notified</span>, <span class="tag failed">Failed, will retry</span> or <span class="tag sent">Already tagged in Asana</span>.</li>
            </ul>
          </section>

          <section class="card" id="g-alerts">
            <h2>Removal alerts</h2>
            <p>When a check finds reviews removed, a Slack message is sent with each review's location, reviewer, who worked on it, the Asana task and the Google link.</p>
            <ul>
              <li><b>Vanessa</b> gets every removal. Reviews nobody is assigned to come last, under <i class="ui">Not assigned in Asana</i>.</li>
              <li><b>Jessica, Papy and Manasse</b> each get a message with only the removals they worked on.</li>
              <li>A review is alerted <b>once</b>. Reviews already tagged "Successfully removed" in Asana are never alerted.</li>
              <li>If Slack fails, the alert is tried again on the next run. Who got what is on the <i class="ui">Audit</i> page.</li>
            </ul>
          </section>

          <section class="card" id="g-asana">
            <h2>Working in Asana</h2>
            <ul>
              <li><b>Assign every dispute</b> (or its location task) to the person working on it. That's the "Worked on by" name, and it decides who gets the alert.</li>
              <li><b>Tag confirmed removals "Successfully removed".</b> They then count as Removed in Asana and are never alerted.</li>
              <li>After changing tasks in Asana, press <i class="ui">Sync from Asana</i> so the monitor sees the change.</li>
            </ul>
          </section>

          <section class="card" id="g-pages">
            <h2>Audit and Configure</h2>
            <p><b>Audit</b> lists who did what and when: checks started, finished or cancelled, single-location checks, settings changes and who was sent an alert. Filter it with <i class="ui">All · Checks · Settings · System</i>.</p>
            <p><b>Configure</b> holds the settings: the review source (Scrape mode), how many Google reviews to look through per location, and how long an Asana sync counts as fresh. Changes apply from the next check. Please leave these to the person who looks after the monitor.</p>
          </section>

          <section class="card" id="g-phone">
            <h2>On a phone</h2>
            <ul>
              <li>The month bar sits on its own row at the top, and the menu becomes a row of tabs under it.</li>
              <li>The Locations list is folded away: tap <i class="ui">Locations</i> to open it. Picking a location closes it and jumps to that location's reviews.</li>
              <li><i class="ui">Run options</i> opens from the bottom of the screen.</li>
            </ul>
          </section>

          <section class="card" id="g-faq">
            <h2>Questions</h2>
            <dl class="faq">
              <dt>I can't find a month.</dt><dd>Check the filter icon in the month bar: it may be set to Managed or Legacy only. A month that says <i class="ui">Not synced</i> needs <i class="ui">Sync from Asana</i> first.</dd>
              <dt>Lots of reviews say "Could not be checked".</dt><dd>The scraper may be starting up, blocked by Google for a moment, or out of free-plan checks for the month. They're retried on the next run; nothing is lost.</dd>
              <dt>Someone's name isn't in the Worked on by filter.</dt><dd>They have no removed reviews this month yet, so they're listed at the bottom under <i class="ui">No removals yet</i>.</dd>
              <dt>A review shows the wrong person.</dt><dd>Fix the assignee in Asana, then press <i class="ui">Sync from Asana</i>.</dd>
              <dt>Someone didn't get their Slack alert.</dt><dd>Look on the <i class="ui">Audit</i> page for "Sent … their removal alert" or "Could not send …", and tell the person who looks after the monitor.</dd>
            </dl>
          </section>
        </div>
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
            <div class="hint">Applies to Run now. 0 means always sync from Asana first. The Sync from Asana button always syncs.</div></div>
          <div class="field"><label class="switch"><input id="cfgDfsFast" type="checkbox"><span><span class="t">Use DataForSEO's fast queue for full runs</span><span class="d">About a minute per request at double the price. Single-location checks always use it.</span></span></label></div>
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
// "How to use it for now": opens on arrival until "Don't show this again" is ticked; the ? button reopens it.
// Bump the key when the text changes, so everyone sees the new version once.
const HOWTO_KEY='grm.howto.v1';
function openHowto(){const d=$('howto');if(d.open)return;try{$('howtoHide').checked=localStorage.getItem(HOWTO_KEY)==='hide'}catch(e){}d.showModal();$('howtoClose').focus()}
$('howto').addEventListener('close',()=>{try{if($('howtoHide').checked)localStorage.setItem(HOWTO_KEY,'hide');else localStorage.removeItem(HOWTO_KEY)}catch(e){}});
$('howtoClose').onclick=()=>$('howto').close();
$('howtoGuide').onclick=()=>$('howto').close();
$('helpTips').onclick=openHowto;
// Guide contents: jump to a section, and mark the one being read. Buttons, not #links, because the hash picks the page.
for(const b of document.querySelectorAll('.toc button'))b.onclick=()=>{const t=$(b.dataset.to);if(t)t.scrollIntoView({behavior:reduceMotionNow()?'auto':'smooth',block:'start'})};
function reduceMotionNow(){return matchMedia('(prefers-reduced-motion:reduce)').matches}
if('IntersectionObserver' in window){
  const seen=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting)for(const b of document.querySelectorAll('.toc button'))b.classList.toggle('on',b.dataset.to===e.target.id)},{rootMargin:'0px 0px -70% 0px'});
  for(const s of document.querySelectorAll('.gbody section'))seen.observe(s);
}
$('howto').addEventListener('click',e=>{if(e.target===$('howto'))$('howto').close()});
$('howtoOpen').onclick=openHowto;
{let hidden=false;try{hidden=localStorage.getItem(HOWTO_KEY)==='hide'}catch(e){}if(!hidden)openHowto()}

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

  $('schedule').textContent='Last check: '+(s.lastCheckAt?dayLabel(s.lastCheckAt)+', '+timeLabel(s.lastCheckAt):'never');

  const fail=$('failBanner');
  if(s.notificationsFailing){fail.textContent=s.notificationsFailing+' removal notification(s) could not be emailed. They will be retried at the next run.';fail.classList.add('show')}
  else fail.classList.remove('show');

  const unk=$('unknownBanner');
  if(s.unknown){unk.textContent='⚠ '+s.unknown+' review(s) could not be checked. They will be tried again the next time this month is run.';unk.classList.add('show')}
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

// ---- Review status: the month's removed reviews, filtered by who worked on them, sorted and paged ----
const PAGE_SIZE=10, NOBODY='__nobody__';
const SORTS={newest:'Newest',reviewer:'Reviewer A–Z',location:'Location A–Z'};
let removedRows=[], removedWorkers=[], removedKey='', removedWho='all', removedSort='newest', removedPage=1;
try{removedWho=localStorage.getItem('grm.removedWho')||'all';removedSort=localStorage.getItem('grm.removedSort')||'newest'}catch(e){}
const byText=(a,b)=>(a||'\\uffff').localeCompare(b||'\\uffff',undefined,{sensitivity:'base'});
const CHEV='<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const PEOPLE_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M18 19a5 5 0 0 0-2.5-4.3"/></svg>';
const NOBODY_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/></svg>';

/** Initials for a person's circle: "Jessica Kabemba" -> "JK"; an email shows its first two letters. */
function initials(name){
  const parts=name.split('@')[0].split(/[\\s._-]+/).filter(Boolean);
  return ((parts[0]||'?')[0]+(parts.length>1?parts[parts.length-1][0]:(parts[0]||'')[1]||'')).toUpperCase();
}
function avatar(kind,name){
  const a=el('span',null,'av'+(kind==='person'?'':' '+kind));a.setAttribute('aria-hidden','true');
  if(kind==='person')a.textContent=initials(name);else a.innerHTML=kind==='all'?PEOPLE_SVG:NOBODY_SVG;
  return a;
}
/** "A", "A and B", "A, B and C", "A, B, C and 4 others". */
function nameList(names){
  if(names.length<=3)return names.length<2?names.join(''):names.slice(0,-1).join(', ')+' and '+names[names.length-1];
  return names.slice(0,3).join(', ')+' and '+(names.length-3)+' other'+(names.length-3===1?'':'s');
}

/** The Worked on by pill and its menu. items: {value, label, count, kind, zero}. */
function whoPicker(items,value,onPick){
  const wrap=el('div',null,'rwho'), b=el('button',null,'rwho-btn'), pop=el('div',null,'mb-pop');
  const cur=items.find(i=>i.value===value)||items[0];
  b.type='button';b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');
  b.append(avatar(cur.kind,cur.label),el('span','Worked on by','lbl'),el('span',cur.label,'val'));
  b.insertAdjacentHTML('beforeend',CHEV);
  pop.setAttribute('role','menu');pop.hidden=true;
  const open=on=>{pop.hidden=!on;b.setAttribute('aria-expanded',String(on));if(on){const f=pop.querySelector('[aria-checked="true"]')||pop.querySelector('.mb-item:not(:disabled)');if(f)f.focus()}};
  let zeroHead=false;
  pop.append(el('div','Worked on by','mb-head'));
  for(const i of items){
    if(i.zero&&!zeroHead){pop.append(el('div','No removals yet','mb-head'));zeroHead=true}
    const it=el('button',null,'mb-item'+(i.zero?' zero':''));it.type='button';it.setAttribute('role','menuitemradio');
    it.setAttribute('aria-checked',String(i.value===cur.value));it.disabled=!!i.zero;
    it.append(avatar(i.kind,i.label),el('span',i.label,'name'),el('span',String(i.count),'n'));
    it.insertAdjacentHTML('beforeend',CHECK_SVG);
    it.onclick=()=>{open(false);b.focus();if(i.value!==cur.value)onPick(i.value)};
    pop.append(it);
  }
  b.onclick=()=>open(pop.hidden);
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!pop.hidden){e.preventDefault();open(false);b.focus();return}
    if(pop.hidden||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    e.preventDefault();
    const list=[...pop.querySelectorAll('.mb-item:not(:disabled)')], k=list.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?list.length-1:Math.max(0,Math.min(list.length-1,k+(e.key==='ArrowDown'?1:-1)));
    if(list[next])list[next].focus();
  });
  wrap.append(b,pop);return wrap;
}
// One listener for every redraw of the picker: a click anywhere else closes its menu.
document.addEventListener('pointerdown',e=>{
  for(const w of document.querySelectorAll('.rwho'))if(!w.contains(e.target)){const p=w.querySelector('.mb-pop');if(p&&!p.hidden){p.hidden=true;w.querySelector('.rwho-btn').setAttribute('aria-expanded','false')}}
});
/** Newest | Reviewer A–Z | Location A–Z */
function sortToggle(value,onPick){
  const g=el('div',null,'rseg');g.setAttribute('role','group');g.setAttribute('aria-label','Sort removed reviews');
  for(const [k,label] of Object.entries(SORTS)){
    const b=el('button',label);b.type='button';b.setAttribute('aria-pressed',String(k===value));
    b.onclick=()=>{if(k!==value)onPick(k)};g.append(b);
  }
  return g;
}
/** Page numbers to show: the first, the last, and the current one with its neighbours; null marks a gap. */
function pageList(cur,total){
  const keep=new Set([1,total,cur-1,cur,cur+1].filter(p=>p>=1&&p<=total)), out=[];
  // A gap of a single page shows that page instead of "…".
  for(let p=1;p<=total;p++){if(keep.has(p)||keep.has(p-1)&&keep.has(p+1))out.push(p);else if(out[out.length-1]!==null)out.push(null)}
  return out;
}

async function loadStatus(){
  const [rows,workers]=await Promise.all([api(withProject('api/removed')),api(withProject('api/workers')).catch(()=>[])]);
  // The 60-second refresh redraws only when something changed, so the page and an open menu stay put.
  const key=JSON.stringify([rows.map(r=>[r.id,r.notification_sent,r.last_notification_error,r.asana_tagged_removed]),workers]);
  if(key===removedKey&&$('status').firstChild)return;
  removedKey=key;removedRows=rows;removedWorkers=workers;renderRemoved();
}

function renderRemoved(){
  const rows=removedRows, box=$('status');box.replaceChildren();
  if(!rows.length){
    const c=el('div',null,'card ok');
    c.append(el('p','🟢 No new reviews have been removed.','headline'),el('p','Everything is working normally.','subline'));
    box.append(c);return;
  }
  const c=el('div',null,'card attn');
  c.append(el('p','🔴 '+rows.length+' review'+(rows.length>1?'s':'')+' removed','headline'),
    el('p','These reviews were detected as removed during the most recent check.','subline'));

  // Everyone who appears in this month's removed reviews, most removals first.
  const people=new Map();let nobody=0;
  for(const r of rows){const w=workedOnBy(r);if(w)people.set(w,(people.get(w)||0)+1);else nobody++}
  if(removedWho!=='all'&&!(removedWho===NOBODY?nobody:people.has(removedWho)))removedWho='all';
  // People with disputes this month but nothing removed yet: listed last in the menu, and in a friendly note.
  const notYet=removedWorkers.map(w=>w.name).filter(n=>!people.has(n)).sort(byText);
  const whoItems=[{value:'all',label:'Everyone',count:rows.length,kind:'all'},
    ...[...people].sort((a,b)=>b[1]-a[1]||byText(a[0],b[0])).map(([n,k])=>({value:n,label:n,count:k,kind:'person'}))];
  if(nobody)whoItems.push({value:NOBODY,label:'Not assigned in Asana',count:nobody,kind:'none'});
  for(const n of notYet)whoItems.push({value:'zero:'+n,label:n,count:0,kind:'person',zero:true});
  if(!SORTS[removedSort])removedSort='newest';

  const shown=rows.filter(r=>removedWho==='all'||(removedWho===NOBODY?!workedOnBy(r):workedOnBy(r)===removedWho));
  if(removedSort==='reviewer')shown.sort((a,b)=>byText(a.reviewer_name,b.reviewer_name));
  else if(removedSort==='location')shown.sort((a,b)=>byText(a.location,b.location)||byText(a.reviewer_name,b.reviewer_name));
  const pages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));
  removedPage=Math.min(Math.max(1,removedPage),pages);
  const from=(removedPage-1)*PAGE_SIZE, page=shown.slice(from,from+PAGE_SIZE);

  const remember=()=>{try{localStorage.setItem('grm.removedWho',removedWho);localStorage.setItem('grm.removedSort',removedSort)}catch(e){}};
  const tools=el('div',null,'rtools');
  tools.append(
    whoPicker(whoItems,removedWho,v=>{removedWho=v;removedPage=1;remember();renderRemoved();const b=$('status').querySelector('.rwho-btn');if(b)b.focus()}),
    sortToggle(removedSort,v=>{removedSort=v;removedPage=1;remember();renderRemoved();const b=$('status').querySelector('.rseg [aria-pressed="true"]');if(b)b.focus()}),
    el('span',shown.length===rows.length&&pages===1?shown.length+' shown':(shown.length?(from+1)+'–'+(from+page.length)+' of '+shown.length:'0 of '+rows.length),'shown'));
  c.append(tools);
  if(removedWho==='all'&&notYet.length){
    const note=el('div',null,'rnote');
    const t=el('div');
    t.append(document.createTextNode('No removals yet for '),el('b',nameList(notYet)),document.createTextNode('.'),
      el('div','Their disputes are still being worked on, and they’ll show up here as soon as Google takes one down. Keep going!','sub'));
    note.append(el('span','🌱','ic'),t);
    c.append(note);
  }

  const list=el('ul',null,'removed-list');
  for(const r of page){
    const li=document.createElement('li');
    const left=el('div',null,'left');left.append(el('span',r.reviewer_name||'Unknown reviewer','who'),el('span',(r.location||'Unknown location')+'  ·  '+(workedOnBy(r)?'Worked on by '+workedOnBy(r):'Nobody assigned in Asana'),'where'));
    const [tagText,tagCls]=notifTag(r);
    const right=el('div',null,'right');
    right.append(el('span','Removed '+dayLabel(r.removed_at),'when'), el('span',tagText,'tag '+tagCls));
    right.append(logoLink('google',r.google_review_url),logoLink('asana',r.asana_task_url));
    li.append(left,right);
    list.append(li);
  }
  c.append(list);

  // ‹ Prev 1 2 … 9 Next ›, only when there is more than one page.
  if(pages>1){
    const nav=el('nav',null,'pager');nav.setAttribute('aria-label','Removed reviews pages');
    const go=p=>{removedPage=p;renderRemoved();const t=$('status').querySelector('.rtools');if(t)t.scrollIntoView({block:'nearest'});const cur=$('status').querySelector('.pager [aria-current]');if(cur)cur.focus()};
    const btn=(html,label,p,disabled)=>{const b=document.createElement('button');b.type='button';b.innerHTML=html;b.setAttribute('aria-label',label);b.disabled=disabled;b.onclick=()=>go(p);return b};
    nav.append(btn('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Prev','Previous page',removedPage-1,removedPage===1));
    for(const p of pageList(removedPage,pages)){
      if(p===null){nav.append(el('span','…','gap'));continue}
      const b=btn(String(p),'Page '+p,p,false);
      if(p===removedPage)b.setAttribute('aria-current','page');
      nav.append(b);
    }
    nav.append(btn('Next<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>','Next page',removedPage+1,removedPage===pages));
    c.append(nav);
  }
  box.append(c);
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
});
const cfgDirty=()=>{if(!cfg)return false;const now=cfgRead();return Object.keys(now).some(k=>now[k]!==cfg.settings[k]&&!(Number.isNaN(now[k])&&Number.isNaN(cfg.settings[k])))};
function cfgMessage(text,kind){const m=$('cfgMsg');m.textContent=text||'';m.className='banner'+(text?' show '+(kind||'note'):'')}
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
for(const id of ['cfgSource','cfgFallback','cfgMax','cfgSyncFresh','cfgDfsFast'])$(id).addEventListener('input',()=>{$('cfgSave').disabled=!cfgDirty();cfgMessage('')});
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
  const view=h==='audit'||h==='configure'||h==='help'?h:'insights';
  $('viewInsights').hidden=view!=='insights';
  $('viewAudit').hidden=view!=='audit';
  $('viewConfig').hidden=view!=='configure';
  $('viewHelp').hidden=view!=='help';
  if(view==='help'&&view!==currentView)$('viewHelp').scrollTop=0;
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
