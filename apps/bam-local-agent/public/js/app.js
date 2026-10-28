(() => {
  'use strict';

  /* ---------- helpers ---------- */
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

  const session = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { /* private mode */ } }
  };

  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const TYPE_LABEL = { community: 'Community', demographic: 'Demographics', school: 'School', event: 'Event', culture: 'Culture' };

  function toast(message, type = 'info', ms = 4500) {
    const t = h('div', { class: `toast toast--${type}`, text: message });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  function setLoading(btn, loading, labelWhileLoading) {
    if (loading) { btn.dataset.label = btn.textContent; btn.classList.add('is-loading'); btn.disabled = true; if (labelWhileLoading) btn.textContent = labelWhileLoading; }
    else { btn.classList.remove('is-loading'); if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; }
  }

  const showError = (el, msg, input) => { el.textContent = msg; el.hidden = !msg; if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };

  /* ---------- state & API ---------- */
  const state = { key: session.get('bam_admin_key') || '', sso: false, overview: null, locationId: null, uploading: false, pollTimer: null, researchTimer: null, sbAbort: null };

  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

  async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = state.key ? { 'x-admin-key': state.key } : {};   // signed in through the Zawadie Hub: no key needed
    if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, { method, headers, body, signal }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError('Could not reach the server. Check your connection.', 0); }
    if (res.status === 401) {
      state.key = ''; session.del('bam_admin_key'); $('#signOut').hidden = true;
      openAuth('That admin key was not accepted.');
      throw new ApiError('Unauthorized', 401);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status);
    return data;
  }

  /* ---------- sign in ---------- */
  const authDialog = $('#authDialog');
  function openAuth(message) {
    showError($('#authError'), message || '', $('#authKey'));
    if (!authDialog.open) authDialog.showModal();
    $('#authKey').focus();
  }
  authDialog.addEventListener('cancel', (e) => { if (!state.key && !state.sso) e.preventDefault(); });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#authKey');
    if (!input.value.trim()) return showError($('#authError'), 'Enter the admin key to continue.', input);
    state.key = input.value.trim();
    const btn = $('#authBtn');
    setLoading(btn, true, 'Connecting…');
    try {
      await loadOverview();
      session.set('bam_admin_key', state.key);
      input.value = '';
      authDialog.close();
      $('#signOut').hidden = false;
      toast('Connected', 'ok', 2500);
    } catch (err) {
      if (err.status !== 401) showError($('#authError'), err.message, input);
    } finally { setLoading(btn, false); }
  });
  $('#signOut').addEventListener('click', () => {
    state.key = ''; session.del('bam_admin_key'); state.overview = null;
    $('#signOut').hidden = true; renderSignedOut(); openAuth();
  });

  /* ---------- health & header ---------- */
  function setHealth(kind, text) { $('#health .dot').className = `dot dot--${kind}`; $('#healthText').textContent = text; }
  async function pollHealth() {
    try {
      const d = await (await fetch('api/health', { cache: 'no-store' })).json();
      d.database === 'connected' ? setHealth('ok', 'Online · Database connected') : setHealth('warn', 'Online · Database unreachable');
    } catch { setHealth('bad', 'Offline · Server unreachable'); }
  }

  function renderPill() {
    const pill = $('#activePill');
    const active = state.overview?.playbooks.find((p) => p.is_active);
    if (!state.overview) { pill.className = 'pill pill--muted'; pill.textContent = 'Sign in to view'; }
    else if (active) { pill.className = 'pill pill--ok'; pill.textContent = `Active: Q${active.quarter} ${active.year} Playbook`; }
    else { pill.className = 'pill pill--warn'; pill.textContent = 'No active playbook'; }
  }

  /* ---------- overview loading ---------- */
  function skeleton(lines = 4) { return h('div', { 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => h('div', { class: i % 2 ? 'skel skel--short' : 'skel' }))); }

  async function loadOverview({ silent = false } = {}) {
    if (!silent) $('#storePanel').replaceChildren(skeleton(6));
    const data = await api('api/admin/overview');
    state.overview = data;
    if (!data.stores.some((s) => s.location_id === state.locationId)) state.locationId = data.stores[0]?.location_id ?? null;
    renderAll();
    schedulePoll();
    return data;
  }

  function renderSignedOut() {
    renderPill(); clear($('#pbRows')); $('#pbEmpty').hidden = true; clear($('#storeSelect'));
    $('#storePanel').replaceChildren(h('p', { class: 'empty', text: 'Sign in to view stores and local knowledge.' }));
    clear($('#sbResult'));
  }
  function renderAll() { renderPill(); renderPlaybooks(); renderStoreSelect(); renderStore(); renderSandboxHeader(); }

  /* ---------- playbook upload ---------- */
  let selectedFile = null;
  const fileInput = $('#fileInput'), dropzone = $('#dropzone');
  const MAX_BYTES = 15 * 1024 * 1024;

  (function fillYears() {
    const y = new Date().getFullYear();
    for (let i = y - 1; i <= y + 2; i++) $('#year').append(h('option', { value: i, text: String(i), selected: i === y }));
  })();

  function validateFile(f) {
    if (!f) return 'Choose a playbook file first.';
    if (!/\.(pdf|txt|md)$/i.test(f.name)) return 'Unsupported file type. Use a PDF, TXT or Markdown file.';
    if (f.size === 0) return 'That file is empty.';
    if (f.size > MAX_BYTES) return `That file is ${fmtSize(f.size)}. The limit is 15 MB.`;
    return '';
  }
  function setFile(f) {
    const err = f ? validateFile(f) : '';
    showError($('#fileError'), err, fileInput);
    if (!f || err) { selectedFile = null; $('#fileChip').hidden = true; }
    else { selectedFile = f; $('#fileName').textContent = f.name; $('#fileSize').textContent = fmtSize(f.size); $('#fileChip').hidden = false; }
    updateUploadBtn();
  }
  function updateUploadBtn() {
    $('#uploadBtn').disabled = state.uploading || !(selectedFile && $('#quarter').value && $('#year').value);
  }
  fileInput.addEventListener('change', () => fileInput.files[0] && setFile(fileInput.files[0]));
  $('#fileRemove').addEventListener('click', () => { fileInput.value = ''; setFile(null); });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
  dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) setFile(f); });
  $('#quarter').addEventListener('change', () => { showError($('#uploadError'), '', $('#quarter')); updateUploadBtn(); });
  $('#year').addEventListener('change', updateUploadBtn);

  const STEP_IDS = ['upload', 'extract', 'embed', 'active'];
  let currentStep = 0;
  function showSteps(current, { error = false } = {}) {
    currentStep = current;
    STEP_IDS.forEach((id, i) => {
      const li = $(`#steps [data-step="${id}"]`);
      li.className = i < current ? 'is-done' : i === current ? (error ? 'is-error' : 'is-active') : '';
      if (i === current && !error) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  function setBar(pct, mode) {
    const bar = $('.bar'); bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    $('#barFill').style.width = `${pct}%`;
    bar.classList.toggle('is-error', mode === 'error'); bar.classList.toggle('is-done', mode === 'done');
  }
  const setLabel = (text, isError) => { const el = $('#stepLabel'); el.textContent = text; el.classList.toggle('is-error', !!isError); };

  function endUpload() { state.uploading = false; setLoading($('#uploadBtn'), false); updateUploadBtn(); }
  function failUpload(message) {
    clearTimeout(state.pollTimer);
    showSteps(currentStep, { error: true }); setBar(parseFloat($('#barFill').style.width) || 5, 'error'); setLabel(message, true);
    toast(message, 'error', 7000); endUpload();
  }

  $('#uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fileErr = validateFile(selectedFile);
    showError($('#fileError'), fileErr, fileInput);
    const q = $('#quarter').value, y = $('#year').value;
    showError($('#uploadError'), q && y ? '' : 'Select a quarter and a year.', $('#quarter'));
    if (fileErr || !q || !y || state.uploading) return;

    state.uploading = true; updateUploadBtn(); setLoading($('#uploadBtn'), true, 'Processing…');
    $('#progress').hidden = false; showSteps(0); setBar(2); setLabel('Uploading PDF…');

    const fd = new FormData();
    fd.append('quarter', q); fd.append('year', y); fd.append('file', selectedFile);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/admin/playbooks');
    if (state.key) xhr.setRequestHeader('x-admin-key', state.key);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const f = ev.loaded / ev.total; setBar(2 + f * 18); setLabel(`Uploading ${selectedFile.name}… ${Math.round(f * 100)}%`);
    };
    xhr.onerror = () => failUpload('Could not reach the server. Check your connection and try again.');
    xhr.onload = () => {
      if (xhr.status === 401) { endUpload(); state.key = ''; openAuth('That admin key was not accepted.'); return; }
      if (xhr.status === 202 && xhr.response?.jobId) return pollJob(xhr.response.jobId);
      failUpload(xhr.response?.error || `Upload failed (${xhr.status}).`);
    };
    xhr.send(fd);
  });

  function pollJob(jobId) {
    const tick = async () => {
      try {
        const job = await api(`api/admin/jobs/${jobId}`);
        if (applyJob(job)) return;
        state.pollTimer = setTimeout(tick, 900);
      } catch (err) { if (err.status !== 401) failUpload(err.message); }
    };
    tick();
  }
  /** Returns true when the job has finished (successfully or not). */
  function applyJob(job) {
    if (job.status === 'error') { failUpload(job.error || 'Processing failed.'); return true; }
    if (job.status === 'done') {
      showSteps(4); setBar(100, 'done');
      setLabel(`Done. ${job.result?.chunks ?? ''} chunks stored and ${job.result?.quarter ?? 'the playbook'} is now active.`);
      toast('Playbook processed and activated', 'ok');
      endUpload(); loadOverview({ silent: true }).catch(() => {});
      setTimeout(() => { fileInput.value = ''; setFile(null); $('#quarter').value = ''; updateUploadBtn(); }, 1500);
      return true;
    }
    if (job.stage === 'activating') { showSteps(3); setBar(95); setLabel('Activating the playbook…'); }
    else if (job.stage === 'embedding') {
      showSteps(2); setBar(30 + (job.total ? job.done / job.total : 0) * 60);
      setLabel(`Generating OpenAI embeddings… ${job.done} of ${job.total} chunks`);
    } else { showSteps(1); setBar(25); setLabel(job.stage === 'chunking' ? 'Splitting the playbook into searchable chunks…' : 'Reading the file…'); }
    return false;
  }

  /* ---------- playbook history ---------- */
  function renderPlaybooks() {
    const rows = $('#pbRows'); clear(rows);
    const list = state.overview?.playbooks ?? [];
    $('#pbEmpty').hidden = list.length > 0;
    for (const p of list) {
      rows.append(h('tr', { class: p.is_active ? 'is-active' : '' },
        h('td', {}, h('strong', { text: `Q${p.quarter} ${p.year}` }), h('div', { class: 'muted small', text: `${p.chunk_count} chunks` })),
        h('td', { class: 'file', title: p.filename, text: p.filename }),
        h('td', { class: 'muted', text: fmtDate(p.uploaded_at) }),
        h('td', { class: 'act' }, p.is_active
          ? h('span', { class: 'badge badge--info', text: '● Active' })
          : h('button', { type: 'button', class: 'btn btn--sm', 'aria-label': `Set Q${p.quarter} ${p.year} playbook active`, onclick: () => setActive(p.id) }, 'Set active'))));
    }
  }
  async function setActive(id) {
    const before = state.overview.playbooks.map((p) => p.is_active);
    state.overview.playbooks.forEach((p) => { p.is_active = p.id === id ? 1 : 0; });   // optimistic
    renderPlaybooks(); renderPill();
    try { await api(`api/admin/playbooks/${id}/activate`, { method: 'POST' }); toast('Playbook activated', 'ok'); loadOverview({ silent: true }).catch(() => {}); }
    catch (err) {
      state.overview.playbooks.forEach((p, i) => { p.is_active = before[i]; });
      renderPlaybooks(); renderPill();
      if (err.status !== 401) toast(`Could not activate: ${err.message}`, 'error');
    }
  }

  /* ---------- stores ---------- */
  const currentStore = () => state.overview?.stores.find((s) => s.location_id === state.locationId);

  /** Store dropdown, grouped by state, so it keeps working as the admin adds more stores. */
  function renderStoreSelect() {
    const select = $('#storeSelect'); clear(select);
    const stores = [...(state.overview?.stores ?? [])].sort((x, y) => x.state.localeCompare(y.state) || x.city.localeCompare(y.city));
    const byState = new Map();
    for (const s of stores) { if (!byState.has(s.state)) byState.set(s.state, []); byState.get(s.state).push(s); }
    for (const [st, list] of byState) {
      select.append(h('optgroup', { label: st },
        list.map((s) => h('option', { value: s.location_id, text: `${s.city}, ${s.state} - ${s.name}`, selected: s.location_id === state.locationId }))));
    }
    select.disabled = !stores.length;
    if (state.locationId) select.value = state.locationId;
  }
  $('#storeSelect').addEventListener('change', (e) => selectStore(e.target.value));

  /* ---------- add store ---------- */
  const storeDialog = $('#storeDialog');
  const STORE_FIELDS = ['stName', 'stAddress', 'stCity', 'stState', 'stZip'];
  let editing = null;   // the store being edited, or null when adding a new one
  function openStoreDialog(store) {
    if (!state.key && !state.sso) return openAuth();
    editing = store || null;
    $('#storeForm').reset(); showError($('#stError'), '');
    for (const id of STORE_FIELDS) $(`#${id}`).setAttribute('aria-invalid', 'false');
    $('#storeDlgTitle').textContent = store ? `Edit ${store.name}` : 'Add a store';
    $('#stSubmit').textContent = store ? 'Save changes' : 'Add store';
    $('#stResearchRow').hidden = !store;
    $('#storeDlgIntro').hidden = !!store;
    if (store) {
      $('#stName').value = store.name || ''; $('#stAddress').value = store.address || ''; $('#stCity').value = store.city || '';
      $('#stState').value = store.state || ''; $('#stZip').value = store.zip || '';
    }
    storeDialog.showModal(); $('#stName').focus();
  }
  $('#addStoreBtn').addEventListener('click', () => openStoreDialog(null));
  // When the place itself changes, the old local research no longer fits, so suggest re-running it.
  for (const id of ['stCity', 'stState', 'stZip']) $(`#${id}`).addEventListener('input', () => {
    if (!editing) return;
    const orig = { stCity: editing.city, stState: editing.state, stZip: editing.zip };
    const now = { stCity: $('#stCity').value.trim(), stState: $('#stState').value.trim().toUpperCase(), stZip: $('#stZip').value.trim() };
    $('#stResearch').checked = Object.keys(orig).some((k) => (orig[k] || '') !== now[k]);
  });
  $('#stCancel').addEventListener('click', () => storeDialog.close());
  $('#storeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Every field is required: the AI researches the local community from exactly these details.
    const name = $('#stName').value.trim(), address = $('#stAddress').value.trim(), city = $('#stCity').value.trim();
    const st = $('#stState').value.trim().toUpperCase(), zip = $('#stZip').value.trim();
    for (const id of STORE_FIELDS) $(`#${id}`).setAttribute('aria-invalid', 'false');
    const bad = (msg, id) => { showError($('#stError'), msg, $(`#${id}`)); $(`#${id}`).focus(); };
    if (name.length < 3) return bad('Enter the store name.', 'stName');
    if (address.length < 5 || !/\d/.test(address)) return bad('Enter the full street address, including the number.', 'stAddress');
    if (city.length < 2) return bad('Enter the store city.', 'stCity');
    if (!/^[A-Z]{2}$/.test(st)) return bad('Enter the two-letter state, like GA.', 'stState');
    if (!/^\d{5}(-\d{4})?$/.test(zip)) return bad('Enter the ZIP code, like 30080.', 'stZip');
    showError($('#stError'), '');
    const btn = $('#stSubmit'); setLoading(btn, true, 'Adding…');
    try {
      if (editing) {
        const res = await api(`api/admin/stores/${encodeURIComponent(editing.location_id)}`, { method: 'PATCH', body: { name, address, city, state: st, zip, research: $('#stResearch').checked } });
        storeDialog.close();
        await loadOverview({ silent: true });
        toast(res.research_status === 'pending' ? 'Saved. The AI will re-research the local community shortly.' : 'Store details saved.', 'ok', 6000);
      } else {
        const res = await api('api/admin/stores', { method: 'POST', body: { name, address, city, state: st, zip } });
        storeDialog.close();
        state.locationId = res.store.location_id;
        await loadOverview({ silent: true });
        toast(`${res.store.city}, ${res.store.state} added. The AI will research its community, demographics, schools, events and culture within a few minutes.`, 'ok', 8000);
      }
    } catch (ex) {
      if (ex.status !== 401) showError($('#stError'), ex.message);
    } finally { setLoading(btn, false); }
  });

  function selectStore(id) {
    state.locationId = id; renderStoreSelect(); renderStore(); renderSandboxHeader(); clear($('#sbResult'));
  }

  /* ---------- automatic local research ---------- */
  const busy = (s) => s.research_status === 'pending' || s.research_status === 'running';   // waiting for, or in the middle of, research
  const signature = (o) => JSON.stringify((o?.stores ?? []).map((s) => [s.location_id, s.research_status, s.chunks.length]));

  /** While any store is being researched, check every few seconds and refresh only when something changed. */
  function schedulePoll() {
    clearTimeout(state.researchTimer);
    if (!(state.overview?.stores ?? []).some(busy)) return;
    state.researchTimer = setTimeout(async () => {
      try {
        const data = await api('api/admin/overview');
        const before = state.overview;
        for (const old of before.stores.filter(busy)) {
          const now = data.stores.find((s) => s.location_id === old.location_id);
          if (now?.research_status === 'done') toast(`Local research finished for ${now.city}, ${now.state}.`, 'ok', 7000);
          else if (now?.research_status === 'failed') toast(`Local research didn't finish for ${now.city}: ${now.research_error || 'please try again.'}`, 'error', 9000);
        }
        if (signature(data) !== signature(before)) {
          state.overview = data;
          if (!data.stores.some((s) => s.location_id === state.locationId)) state.locationId = data.stores[0]?.location_id ?? null;
          renderAll();
        }
      } catch { /* try again on the next tick */ }
      schedulePoll();
    }, 5000);
  }

  async function runResearch(s) {
    try {
      await api(`api/admin/stores/${encodeURIComponent(s.location_id)}/research`, { method: 'POST' });
      s.research_status = 'pending'; s.research_error = null; s.research_queued_at = new Date().toISOString();
      renderStore(); schedulePoll();
      toast(`${s.city}, ${s.state} is queued for research. It starts within a few minutes.`, 'ok', 5000);
    } catch (err) { if (err.status !== 401) toast(`Could not start the research: ${err.message}`, 'error', 7000); }
  }

  /** Edit details / delete this store. Delete asks twice (second click within a few seconds). */
  function storeActions(s) {
    const del = h('button', { type: 'button', class: 'btn btn--sm btn--danger-ghost', 'aria-label': `Delete ${s.name}` }, 'Delete store');
    let armed = null;
    del.addEventListener('click', async () => {
      if (!armed) {
        del.textContent = `Click again to delete it and its ${s.chunks.length} local entries`;
        armed = setTimeout(() => { armed = null; del.textContent = 'Delete store'; }, 5000);
        return;
      }
      clearTimeout(armed); armed = null; del.disabled = true;
      try {
        await api(`api/admin/stores/${encodeURIComponent(s.location_id)}`, { method: 'DELETE' });
        state.locationId = null; clear($('#sbResult'));
        await loadOverview({ silent: true });
        toast(`${s.name} was deleted.`, 'ok', 5000);
      } catch (err) { del.disabled = false; del.textContent = 'Delete store'; if (err.status !== 401) toast(`Could not delete: ${err.message}`, 'error', 7000); }
    });
    return h('div', { class: 'store-actions' },
      h('button', { type: 'button', class: 'btn btn--sm', onclick: () => openStoreDialog(s) }, 'Edit details'), del);
  }

  function researchBanner(s) {
    const again = (label, title) => h('button', { type: 'button', class: 'btn btn--sm', title, onclick: () => runResearch(s) }, label);
    switch (s.research_status) {
      case 'pending': {
        const waitedMin = s.research_queued_at ? (Date.now() - new Date(s.research_queued_at).getTime()) / 60000 : 0;
        return h('div', { class: `research ${waitedMin > 15 ? 'research--failed' : 'research--running'}`, role: 'status' }, h('span', { class: 'research__spin', 'aria-hidden': 'true' }),
          h('div', {}, h('strong', { text: waitedMin > 15 ? 'Still waiting to start' : 'Queued for research' }),
            h('p', { class: 'small', text: waitedMin > 15
              ? 'This has been waiting a while. Check that the scheduled job (scripts/runResearch.js) is set up in hPanel and running.'
              : `The scheduled job picks this up within a few minutes, then researches the community, demographics, schools, events and culture for ${s.city}, ${s.state}. It appears below on its own.` })));
      }
      case 'running':
        return h('div', { class: 'research research--running', role: 'status' }, h('span', { class: 'research__spin', 'aria-hidden': 'true' }),
          h('div', {}, h('strong', { text: 'Researching the local community…' }),
            h('p', { class: 'small', text: `The AI is gathering the community, demographics, schools, events and culture for ${s.city}, ${s.state}. It usually takes a minute or two and appears below on its own.` })));
      case 'failed':
        return h('div', { class: 'research research--failed', role: 'alert' },
          h('div', {}, h('strong', { text: "Automatic research didn't finish" }), h('p', { class: 'small', text: s.research_error || 'Something went wrong. Try again.' })),
          again('Try again'));
      case 'done': {
        const ai = s.chunks.filter((c) => c.auto), seen = ai.filter((c) => c.reviewed_at).length;
        return h('div', { class: 'research research--done' },
          h('div', {}, h('strong', { text: 'Researched automatically' }),
            h('p', { class: 'small', text: `${s.researched_at ? `${fmtDate(s.researched_at)}. ` : ''}${ai.length ? `${seen} of ${ai.length} AI entries checked by a person. ` : ''}Check the sources under each AI entry and mark it reviewed. Re-running replaces the AI entries (reviewed ones too) and keeps yours.` })),
          again('Re-run research', 'Replaces the AI-researched entries; entries you added by hand are kept'));
      }
      default:
        return h('div', { class: 'research research--none' },
          h('div', {}, h('strong', { text: 'No automatic research yet' }), h('p', { class: 'small', text: 'Let the AI gather the community, demographics, schools, events and culture for this store.' })),
          again('Research now'));
    }
  }

  function breakInfo(chunks) {
    for (const c of chunks.filter((x) => x.chunk_type === 'school')) {
      const m = c.content.match(/Spring Break(?: Schedule)?:\s*([^.]*?\d{4})(?:\s*[–-]\s*([^.]*?\d{4}))?/i);
      if (!m) continue;
      const clean = (s) => s.replace(/^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*/i, '').trim();
      const district = (c.content.match(/^([A-Z][A-Za-z.\s]+?(?:School District|Public Schools))/) || [])[1];
      return { dates: m[2] ? `${clean(m[1])} – ${clean(m[2])}` : clean(m[1]), district };
    }
    return null;
  }

  function infoBox(label, chunks, { wide = false } = {}) {
    return h('div', { class: `info${wide ? ' info--wide' : ''}` },
      h('span', { class: 'info__label', text: label }),
      chunks.length
        ? chunks.map((c) => h('p', { class: 'info__value clamp', text: c.content }))
        : h('p', { class: 'info__value muted', text: 'Nothing added yet.' }));
  }

  function renderStore() {
    const panel = $('#storePanel'); const s = currentStore();
    if (!s) return panel.replaceChildren(h('p', { class: 'empty', text: 'No stores found.' }));
    panel.setAttribute('aria-label', `${s.name} - local knowledge`);
    const by = (t) => s.chunks.filter((c) => c.chunk_type === t);
    const brk = breakInfo(s.chunks);
    const address = [s.address, `${s.city}, ${s.state}${s.zip ? ` ${s.zip}` : ''}`].filter(Boolean).join(' · ');

    panel.replaceChildren(
      h('div', { class: 'store-head' },
        h('div', {}, h('h3', { text: s.name }), h('p', { class: 'muted', text: address || 'No address on file' })),
        brk
          ? h('span', { class: 'badge badge--info', text: `🗓 Spring break ${brk.dates}` })
          : h('span', { class: 'badge badge--warn', text: 'No school break on file' })),
      storeActions(s),
      researchBanner(s),
      h('div', { class: 'chips mt-12', role: 'group', 'aria-label': 'Knowledge counts' },
        ['community', 'demographic', 'school', 'event', 'culture'].map((t) => h('span', { class: 'badge badge--neutral', text: `${TYPE_LABEL[t]}: ${by(t).length}` }))),
      h('div', { class: 'info-grid' },
        infoBox('Community', by('community'), { wide: true }),
        infoBox('Demographic summary', by('demographic')),
        infoBox(`School calendar${brk?.district ? ` · ${brk.district}` : ''}`, by('school')),
        infoBox('Local culture', by('culture')),
        infoBox('Local events', by('event'), { wide: true })),
      h('div', { class: 'section-head mt-8' }, h('h3', { text: `All local knowledge (${s.chunks.length})` })),
      knowledgeList(s),
      addKnowledgeForm(s));
  }

  function knowledgeList(s) {
    if (!s.chunks.length) return h('p', { class: 'empty', text: 'No local knowledge yet. Add the first entry below.' });
    return h('ul', { class: 'klist' }, s.chunks.map((c) => {
      const text = h('div', { class: 'kitem__text', tabindex: '0', role: 'button', 'aria-expanded': 'false', title: 'Click to expand', text: c.content });
      const toggle = () => text.setAttribute('aria-expanded', String(text.classList.toggle('is-open')));
      text.addEventListener('click', toggle);
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      const idleLabel = `Delete this ${TYPE_LABEL[c.chunk_type]} entry`;
      const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': idleLabel, text: '🗑', disabled: !!c.pending });
      let armed = null;
      del.addEventListener('click', () => {
        if (!armed) {
          del.textContent = 'Delete?'; del.classList.add('btn--danger-ghost'); del.setAttribute('aria-label', 'Confirm delete');
          armed = setTimeout(() => { armed = null; del.textContent = '🗑'; del.classList.remove('btn--danger-ghost'); del.setAttribute('aria-label', idleLabel); }, 3500);
          return;
        }
        clearTimeout(armed); removeChunk(s, c);
      });
      return h('li', { class: 'kitem' },
        h('span', { class: `badge ${c.pending ? 'badge--warn' : 'badge--info'}`, text: c.pending ? 'Saving…' : `${TYPE_LABEL[c.chunk_type]}${c.auto ? ' · AI' : ''}` }),
        h('div', { class: 'kitem__body' }, text, c.auto && !c.pending && aiMeta(c)), del);
    }));
  }

  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

  /** Under an AI entry: where it came from, and whether a person has checked it. */
  function aiMeta(c) {
    const src = c.sources?.length
      ? h('span', { class: 'kmeta__src' }, 'Sources: ', c.sources.flatMap((u, i) => [i ? ', ' : '', /^https?:\/\//i.test(u) ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: hostOf(u) }) : u]))
      : h('span', { class: 'kmeta__src', text: c.web ? 'Web search was used; no source links were returned.' : "No web sources: written from the AI's own knowledge, so verify it." });
    const reviewed = !!c.reviewed_at;
    const btn = h('button', { type: 'button', class: 'link-btn', text: reviewed ? 'Undo' : 'Mark as reviewed' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await api(`api/admin/knowledge/${c.id}/review`, { method: 'PATCH', body: { reviewed: !reviewed } });
        if (!res.ok) throw new Error('Entry not found.');
        c.reviewed_at = reviewed ? null : new Date().toISOString(); c.reviewed_by = reviewed ? null : 'you';
        renderStore();
      } catch (err) { btn.disabled = false; if (err.status !== 401) toast(`Could not update: ${err.message}`, 'error', 6000); }
    });
    return h('div', { class: 'kmeta' }, src,
      h('span', { class: reviewed ? 'kmeta__ok' : 'kmeta__todo' }, reviewed ? `✓ Reviewed by ${c.reviewed_by || 'someone'} · ${fmtDate(c.reviewed_at)}` : 'Not reviewed yet', ' ', btn));
  }

  async function removeChunk(s, chunk) {
    const idx = s.chunks.indexOf(chunk);
    s.chunks.splice(idx, 1); renderStore();                                  // optimistic
    try { await api(`api/admin/knowledge/${chunk.id}`, { method: 'DELETE' }); toast('Entry deleted', 'ok', 2500); }
    catch (err) { s.chunks.splice(idx, 0, chunk); renderStore(); if (err.status !== 401) toast(`Could not delete: ${err.message}`, 'error'); }
  }

  function addKnowledgeForm(s) {
    const type = h('select', { id: 'kType' },
      h('option', { value: 'community', text: 'Community' }), h('option', { value: 'demographic', text: 'Demographics' }), h('option', { value: 'school', text: 'School calendar' }),
      h('option', { value: 'event', text: 'Local event' }), h('option', { value: 'culture', text: 'Culture' }));
    const content = h('textarea', { id: 'kContent', rows: '4', maxlength: '2000', 'aria-describedby': 'kError', placeholder: 'e.g. Cobb County School District 2026 spring break: April 6–10, 2026.' });
    const err = h('p', { class: 'field-error', id: 'kError', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Add to knowledge base');
    const form = h('form', { novalidate: true },
      h('div', {}, h('label', { for: 'kType', text: 'Type' }), type),
      h('div', {}, h('label', { for: 'kContent', text: 'What should the agent know?' }), content), err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = content.value.trim();
      if (text.length < 20) return showError(err, 'Add a little more detail (at least 20 characters).', content);
      showError(err, '', content);
      const tmp = { id: `tmp${Date.now()}`, location_id: s.location_id, chunk_type: type.value, content: text, pending: true };
      s.chunks.push(tmp); renderStore();                                      // optimistic
      try {
        const res = await api('api/admin/knowledge', { method: 'POST', body: { location_id: s.location_id, chunk_type: tmp.chunk_type, content: text } });
        tmp.id = res.id; tmp.pending = false; renderStore(); toast('Added to the knowledge base', 'ok');
      } catch (ex) {
        s.chunks.splice(s.chunks.indexOf(tmp), 1); renderStore();
        if (ex.status !== 401) toast(`Could not save: ${ex.message}`, 'error', 7000);
      }
    });
    return h('details', { class: 'add' }, h('summary', { text: 'Add local knowledge' }), form);
  }

  /* ---------- sandbox ---------- */
  const SAMPLE_PROMPTS = ['What should we run for Spring Break?', "Plan our Mother's Day promotion", 'How should we launch the BAM Passport?'];
  const sbPrompt = $('#sbPrompt');

  function renderSandboxHeader() {
    const s = currentStore();
    $('#sbStore').textContent = s ? `${s.city}, ${s.state}` : 'this store';
    const chips = $('#sbChips'); clear(chips);
    SAMPLE_PROMPTS.forEach((t) => chips.append(h('button', { type: 'button', class: 'chip', text: t, onclick: () => { sbPrompt.value = t; sbPrompt.dispatchEvent(new Event('input')); sbPrompt.focus(); } })));
  }
  sbPrompt.addEventListener('input', () => { $('#sbCount').textContent = `${sbPrompt.value.length} / 500`; if (sbPrompt.value.trim().length >= 5) showError($('#sbError'), '', sbPrompt); });

  $('#sandboxForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = sbPrompt.value.trim();
    if (question.length < 5) return showError($('#sbError'), 'Type a question of at least 5 characters.', sbPrompt);
    if (!currentStore()) return showError($('#sbError'), 'Sign in first to choose a store.', sbPrompt);
    showError($('#sbError'), '', sbPrompt);

    const btn = $('#sbRun'); setLoading(btn, true, 'Generating…');
    $('#sbResult').replaceChildren(h('div', { class: 'result' }, h('div', { class: 'result__body' }, skeleton(7))));
    if (state.sbAbort) state.sbAbort.abort();
    const ctrl = (state.sbAbort = new AbortController());
    const timer = setTimeout(() => ctrl.abort(), 105000);
    try {
      const res = await api('api/admin/query', { method: 'POST', body: { location_id: state.locationId, question }, signal: ctrl.signal });
      renderResult(res);
    } catch (err) {
      clear($('#sbResult'));
      if (err.status !== 401) showError($('#sbError'), err.name === 'AbortError' ? 'That took too long. Please try again.' : `Test failed: ${err.message}`);
    } finally { clearTimeout(timer); setLoading(btn, false); }
  });

  function planText(res) {
    const a = res.answer; if (a.raw) return a.raw;
    const out = [`${res.store.city}, ${res.store.state} - marketing plan`, ''];
    if (a.audience) out.push('WHO TO TARGET', a.audience, '');
    if (a.playbook_rules.length) out.push('PLAYBOOK CAMPAIGN RULES', ...a.playbook_rules.map((r) => `- ${r.campaign}${r.dates ? ` (${r.dates})` : ''}: ${r.rule}`), '');
    if (a.local_plays.length) out.push('LOCAL STORE ADAPTATION', ...a.local_plays.flatMap((p, i) => [`${i + 1}. ${p.action}`, p.local_hook && `   Local: ${p.local_hook}`, p.playbook_support && `   Playbook: ${p.playbook_support}`].filter(Boolean)), '');
    if (a.heads_up) out.push(`HEADS-UP: ${a.heads_up}`);
    return out.join('\n').trim();
  }

  const KIND = { local: ['badge--info', 'Local data'], facts: ['badge--ok', 'Verified fact'], excerpt: ['badge--neutral', 'Playbook excerpt'] };

  function renderResult(res) {
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

    const copy = h('button', { type: 'button', class: 'btn btn--sm' }, 'Copy plan');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(planText(res)); toast('Plan copied to clipboard', 'ok', 2500); }
      catch { toast('Copy is blocked by the browser. Select the text and copy it manually.', 'error'); }
    });

    const c = res.counts;
    const ctx = h('details', { class: 'ctx' },
      h('summary', { text: `Retrieved context (${c.total}) — ${c.local} local · ${c.facts} verified facts · ${c.excerpt} excerpts` }),
      h('ul', { class: 'ctx__list' }, res.sources.map((src) => {
        const [cls, label] = KIND[src.kind] ?? KIND.excerpt;
        const fill = h('span', { class: 'score__fill' }); fill.style.width = `${Math.min(100, Math.round(src.score * 100))}%`;
        const text = h('div', { class: 'ctx__text', tabindex: '0', role: 'button', 'aria-expanded': 'false', text: src.content });
        const toggle = () => text.setAttribute('aria-expanded', String(text.classList.toggle('is-open')));
        text.addEventListener('click', toggle);
        text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        return h('li', { class: 'ctx__item' },
          h('div', { class: 'ctx__top' }, h('span', { class: `badge ${cls}`, text: label }), src.heading && h('span', { class: 'muted', text: src.heading }),
            h('span', { class: 'score', 'aria-label': `Similarity ${src.score}` }, h('span', { class: 'score__bar' }, fill), src.score.toFixed(2))), text);
      })));

    $('#sbResult').replaceChildren(h('div', { class: 'result' },
      h('div', { class: 'result__head' },
        h('span', { class: 'muted', text: `${res.store.city}, ${res.store.state} · ${res.playbook ? `Playbook ${res.playbook.label}` : 'No active playbook'} · ${res.model}` }), copy),
      body, ctx));
  }

  /* ---------- boot ---------- */
  renderSignedOut();
  pollHealth(); setInterval(pollHealth, 30000);
  (async function boot() {
    let hub = {};
    try { hub = await (await fetch('api/session', { cache: 'no-store' })).json(); } catch { /* fall back to the admin key */ }
    if (hub.canAdmin) {
      state.sso = true;                                          // already signed in at the Zawadie Hub as an admin
      const who = $('#who'); who.textContent = hub.email; who.hidden = false;
    }
    if (state.sso || state.key) {
      $('#signOut').hidden = state.sso;
      loadOverview().catch((err) => {
        if (err.status === 401) return;
        toast(err.message, 'error', 8000);
        $('#storePanel').replaceChildren(h('p', { class: 'empty', text: 'Could not load data. Refresh to try again.' }));
      });
    } else openAuth(hub.sso ? 'Your hub account can use the Marketing Planner. The admin portal needs the admin key.' : undefined);
  })();
})();
