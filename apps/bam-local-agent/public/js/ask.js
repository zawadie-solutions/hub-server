(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const clear = (el) => el.replaceChildren();
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const store = (area) => ({
    get: (k) => { try { return area().getItem(k); } catch { return null; } },
    set: (k, v) => { try { area().setItem(k, v); } catch { /* storage unavailable */ } },
    del: (k) => { try { area().removeItem(k); } catch { /* storage unavailable */ } }
  });
  const session = store(() => sessionStorage), local = store(() => localStorage);

  function toast(message, type = 'info', ms = 4500) {
    const t = h('div', { class: `toast toast--${type}`, text: message });
    $('#toasts').append(t); setTimeout(() => t.remove(), ms);
  }
  function setLoading(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.classList.add('is-loading'); btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.classList.remove('is-loading'); if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; }
  }
  const showError = (el, msg, input) => { el.textContent = msg; el.hidden = !msg; if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };

  /* ---------- state & API ---------- */
  const state = { key: session.get('bam_team_key') || '', sso: false, canAdmin: false, stores: [], playbook: null, busy: false, last: null, retry: null };
  class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }

  async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = state.key ? { 'x-team-key': state.key } : {};   // signed in through the Zawadie Hub: no key needed
    if (body) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, { method, headers, body, signal }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError('Could not reach the server. Check your connection and try again.', 0); }
    if (res.status === 401) { signOut(); openAuth('That access code was not accepted.'); throw new ApiError('Unauthorized', 401); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status);
    return data;
  }

  /* ---------- sign in ---------- */
  const dialog = $('#authDialog');
  function openAuth(message) {
    showError($('#authError'), message || '', $('#authKey'));
    if (!dialog.open) dialog.showModal();
    $('#authKey').focus();
  }
  function signOut() { state.key = ''; session.del('bam_team_key'); $('#signOut').hidden = true; }
  async function hubSession() {
    try { return await (await fetch('api/session', { cache: 'no-store' })).json(); } catch { return {}; }
  }
  dialog.addEventListener('cancel', (e) => { if (!state.key && !state.sso) e.preventDefault(); });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#authKey');
    if (!input.value.trim()) return showError($('#authError'), 'Enter the access code to continue.', input);
    state.key = input.value.trim();
    const btn = $('#authBtn'); setLoading(btn, true, 'Checking…');
    try {
      await loadMeta();
      session.set('bam_team_key', state.key); input.value = ''; dialog.close(); $('#signOut').hidden = false;
      // Signed in because a question was turned away: send it again instead of leaving an empty page.
      if (state.retry) { const rerun = state.retry === 'rerun'; state.retry = null; ask(rerun); }
    } catch (err) {
      if (err.status !== 401) showError($('#authError'), err.message, input);
    } finally { setLoading(btn, false); }
  });
  $('#signOut').addEventListener('click', () => { signOut(); clear($('#answer')); openAuth(); });

  /* ---------- stores, suggestions, recent ---------- */
  async function loadMeta() {
    const meta = await api('api/ask/meta');
    state.stores = meta.stores; state.playbook = meta.playbook;
    const pill = $('#activePill');
    pill.className = `pill ${meta.playbook ? 'pill--ok' : 'pill--warn'}`;
    pill.textContent = meta.playbook ? `Playbook: ${meta.playbook.label}` : 'No active playbook';
    renderStores();
  }

  /** Store dropdown: grouped by state so it stays easy to scan as the admin adds more stores. */
  function renderStores() {
    const select = $('#storeSelect'); clear(select);
    const saved = local.get('bam_store');
    select.append(h('option', { value: '', text: state.stores.length ? 'Choose a store…' : 'No stores yet - ask an admin to add one' }));
    const byState = new Map();
    for (const s of [...state.stores].sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city))) {
      if (!byState.has(s.state)) byState.set(s.state, []);
      byState.get(s.state).push(s);
    }
    for (const [st, list] of byState) {
      select.append(h('optgroup', { label: st },
        list.map((s) => h('option', { value: s.location_id, text: `${s.city}, ${s.state} - ${s.name}`, selected: saved === s.location_id }))));
    }
    if (state.stores.length === 1 && !select.value) select.value = state.stores[0].location_id;
    select.disabled = !state.stores.length;
    // Nothing to plan for yet: show a short explanation instead of an empty form.
    $('#askCard').hidden = !state.stores.length;
    $('#noStores').hidden = !!state.stores.length;
    $('#adminLink').hidden = !state.canAdmin;
    showStoreDetail();
  }
  const selectedStore = () => $('#storeSelect').value || '';

  /** Address line under the dropdown, plus a heads-up while a new store's local research is still running. */
  function showStoreDetail() {
    const s = state.stores.find((x) => x.location_id === selectedStore());
    const el = $('#storeDetail'); el.className = 'store-detail small';
    if (!s) { el.textContent = ''; return; }
    const where = [s.address, `${s.city}, ${s.state}${s.zip ? ` ${s.zip}` : ''}`].filter(Boolean).join(' · ');
    if (s.research_status === 'running' || s.research_status === 'pending') { el.classList.add('is-warn'); el.textContent = `${where}. Still gathering local info for this store; plans get richer once it finishes.`; }
    else if (!s.knowledge_count) { el.classList.add('is-warn'); el.textContent = `${where}. No local info saved for this store yet, so plans will lean on the playbook only.`; }
    else el.textContent = `${where} · ${s.knowledge_count} local facts on file`;
  }
  $('#storeSelect').addEventListener('change', () => { showError($('#storeError'), '', $('#storeSelect')); local.set('bam_store', selectedStore()); showStoreDetail(); });
  const SUGGESTIONS = [
    'Create a spring break event plan',
    'Draft a partnership email to a local elementary school',
    'Write an Instagram post for our next build event',
    'What should we run for Spring Break?',
    'When is the local school spring break?'
  ];
  const q = $('#q');
  SUGGESTIONS.forEach((t) => $('#suggest').append(h('button', { type: 'button', class: 'chip', text: t, onclick: () => { q.value = t; q.dispatchEvent(new Event('input')); q.focus(); } })));
  q.addEventListener('input', () => { $('#qCount').textContent = `${q.value.length} / 500`; if (q.value.trim().length >= 5) showError($('#qError'), '', q); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); } });

  /* ---------- asking ---------- */
  const STATUS = ['Understanding your request…', 'Reading the playbook and local data…', 'Checking local schools, dates and events…', 'Writing it up…'];
  let statusTimer = null;

  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); ask(); });

  /** A "Keep going" suggestion: asked straight away for the same store, building on the result on screen. */
  function followUp(text) {
    if (state.busy || !state.last) return;
    q.value = text; q.dispatchEvent(new Event('input'));
    const sel = $('#storeSelect'); if (sel.value !== state.last.storeId) { sel.value = state.last.storeId; showStoreDetail(); }
    ask();
  }

  async function ask(rerun) {
    if (state.busy) return;
    const storeId = rerun ? state.last.storeId : selectedStore();
    const question = rerun ? state.last.question : q.value.trim();
    if (!storeId) { showError($('#storeError'), 'Choose a store first.', $('#storeSelect')); return $('#storeSelect').focus(); }
    if (question.length < 5) return showError($('#qError'), 'Type a request of at least 5 characters.', q);
    showError($('#storeError'), '', $('#storeSelect')); showError($('#qError'), '', q);
    // The result on screen goes along so a request can build on it ("now write the email for this event"); the server
    // only uses it when the request refers to it. Regenerate reuses the context the original request had.
    const previous = rerun ? state.last.previous
      : state.last && state.last.storeId === storeId && state.last.text ? { question: state.last.question, text: state.last.text.slice(0, 4000) } : null;

    state.busy = true;
    const btn = $('#askBtn'); setLoading(btn, true, 'Working on it…');
    let i = 0;
    const status = h('div', { class: 'status-line', role: 'status', text: STATUS[0] });
    $('#answer').replaceChildren(h('div', { class: 'result' }, h('div', { class: 'result__body' }, status, h('div', { class: 'skel' }), h('div', { class: 'skel skel--short' }), h('div', { class: 'skel' }), h('div', { class: 'skel skel--short' }))));
    statusTimer = setInterval(() => { i = Math.min(i + 1, STATUS.length - 1); status.textContent = STATUS[i]; }, 3200);
    const ctrl = new AbortController(); const timeout = setTimeout(() => ctrl.abort(), 105000);
    try {
      const res = await api('api/ask', { method: 'POST', body: { location_id: storeId, question, ...(previous ? { previous } : {}) }, signal: ctrl.signal });
      state.last = { storeId, question, previous, res, text: res.text || (res.answer ? planText(res) : '') };
      renderAnswer(res, question);
      $('#answer').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      clear($('#answer'));
      if (err.status === 401) state.retry = rerun ? 'rerun' : 'form';
      else {
        const msg = err.name === 'AbortError' ? 'That took too long. Please try again.' : err.message;
        $('#answer').replaceChildren(h('div', { class: 'callout', role: 'alert', text: msg }));
      }
    } finally { clearInterval(statusTimer); clearTimeout(timeout); state.busy = false; setLoading(btn, false); }
  }

  /* ---------- answer ---------- */
  function planText(res) {
    const a = res.answer; if (a.raw) return a.raw;
    const out = [`${res.store.city}, ${res.store.state} - marketing plan`, ''];
    if (a.audience) out.push('WHO TO TARGET', a.audience, '');
    if (a.playbook_rules.length) out.push('PLAYBOOK CAMPAIGN RULES', ...a.playbook_rules.map((r) => `- ${r.campaign}${r.dates ? ` (${r.dates})` : ''}: ${r.rule}`), '');
    if (a.local_plays.length) out.push('LOCAL STORE ADAPTATION', ...a.local_plays.flatMap((p, i) => [`${i + 1}. ${p.action}`, p.local_hook && `   Local: ${p.local_hook}`, p.playbook_support && `   Playbook: ${p.playbook_support}`].filter(Boolean)), '');
    if (a.heads_up) out.push(`HEADS-UP: ${a.heads_up}`);
    if (res.pieces?.length) out.push('', '', window.BAMResults.piecesText(res.pieces));
    return out.join('\n').trim();
  }

  function renderAnswer(res, question) {
    const meta = `${res.store.city}, ${res.store.state} · ${res.playbook ? `Playbook ${res.playbook.label}` : 'No active playbook'} · “${question.length > 60 ? `${question.slice(0, 60)}…` : question}”`;
    const consulted = (cls) => (res.consulted?.length ? h('p', { class: cls, text: `Consulted: ${res.consulted.join(' · ')}` }) : null);
    const opts = { meta, toast, regenerate: () => ask(true), onFollowUp: followUp, extra: consulted('consulted ep-consulted') };
    if (res.type === 'event_plan') return $('#answer').replaceChildren(window.BAMEventPlan.render(res, opts));
    if (res.type === 'content') return $('#answer').replaceChildren(window.BAMResults.content(res, opts));
    if (res.type === 'answer') return $('#answer').replaceChildren(window.BAMResults.answer(res, opts));

    const a = res.answer;
    const body = h('div', { class: 'result__body' });
    if (a.raw) body.append(h('p', { text: a.raw }));
    else {
      if (a.audience) body.append(h('div', {}, h('div', { class: 'block-title', text: 'Who to target' }), h('p', { text: a.audience })));
      if (a.playbook_rules.length) body.append(h('div', {}, h('div', { class: 'block-title', text: 'Playbook campaign rules' }),
        a.playbook_rules.map((r) => h('div', { class: 'rule' }, h('strong', { text: r.campaign || 'Playbook' }), r.dates ? ` (${r.dates})` : '', ' — ', r.rule))));
      if (a.local_plays.length) body.append(h('div', {}, h('div', { class: 'block-title', text: `Local store adaptation — ${res.store.city}, ${res.store.state}` }),
        a.local_plays.map((p, i) => h('div', { class: 'play' }, h('strong', { text: `${i + 1}. ${p.action}` }),
          p.local_hook && h('span', {}, h('span', { class: 'play__tag' }, 'Local'), p.local_hook),
          p.playbook_support && h('span', { class: 'muted' }, h('span', { class: 'play__tag' }, 'Playbook'), p.playbook_support)))));
      if (a.heads_up) body.append(h('div', { class: 'callout' }, h('strong', {}, 'Heads-up: '), a.heads_up));
    }
    if (res.pieces?.length) body.append(h('div', {}, h('div', { class: 'block-title', text: res.pieces.length > 1 ? 'Drafts' : 'Draft' }), window.BAMResults.pieceList(res.pieces, res.notes, { toast })));
    const sources = consulted('consulted'); if (sources) body.append(sources);

    const copy = h('button', { type: 'button', class: 'btn btn--sm' }, 'Copy plan');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(planText(res)); toast('Plan copied to clipboard', 'ok', 2500); }
      catch { toast('Your browser blocked copying. Select the text and copy it manually.', 'error'); }
    });
    const again = h('button', { type: 'button', class: 'btn btn--sm', onclick: () => ask(true) }, 'Regenerate');

    $('#answer').replaceChildren(h('article', { class: 'result', 'aria-label': 'Your marketing plan' },
      h('div', { class: 'result__head' },
        h('span', { class: 'muted', text: `${res.store.city}, ${res.store.state} · ${res.playbook ? `Playbook ${res.playbook.label}` : 'No active playbook'} · “${question.length > 60 ? `${question.slice(0, 60)}…` : question}”` }),
        h('div', { class: 'result__actions' }, again, copy)),
      body, window.BAMResults.followUps(res.follow_ups, followUp)));
  }

  /* ---------- boot ---------- */
  local.del('bam_recent');   // past requests are no longer kept; clear what older versions of this page saved
  (async function boot() {
    const hub = await hubSession();
    if (hub.canPlan) {
      state.sso = true;                                          // already signed in at the Zawadie Hub with access to this project
      state.canAdmin = !!hub.canAdmin;
      const who = $('#who'); who.textContent = hub.email; who.hidden = false;
      $('#adminTop').hidden = !state.canAdmin;
    }
    if (state.sso || state.key) {
      $('#signOut').hidden = state.sso;
      loadMeta().catch((err) => { if (err.status !== 401) toast(err.message, 'error', 8000); });
    } else openAuth();
  })();
})();
