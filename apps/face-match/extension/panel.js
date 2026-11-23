import {
  BATCH_SIZE, MAX_PHOTO_BYTES, REVIEW_ORDER, buildMatchForm, chunk, classify, hubProblem, normalizeHubUrl,
  originOf, pickGalleryImages, referenceProblem, summarize,
} from './lib.js';

const $ = (id) => document.getElementById(id);
const state = { reference: null, running: false, rows: [], hub: null };

const PAGE_HELP = "Can't read this page. Open the profile page, click the Face Match icon on the toolbar, then try again.";

// ---- small helpers -------------------------------------------------------------------------------------

// Everything shown in the panel is put in with textContent, never as HTML: addresses and names come from the page.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function setStatus(kind, text, ...extra) {
  const box = $('status');
  if (!text) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.className = `status ${kind}`;
  box.replaceChildren(text, ...extra.filter(Boolean)); // an optional button may be null
}

async function activeTabId() {
  const forced = new URLSearchParams(location.search).get('tab'); // only the automated tests pass this
  if (forced) return Number(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

const send = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg);

async function ensureContent(tabId) {
  if (tabId == null) return false;
  try {
    if ((await send(tabId, { type: 'ping' }))?.ok) return true;
  } catch { /* not injected yet */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return Boolean((await send(tabId, { type: 'ping' }))?.ok);
  } catch {
    return false;
  }
}

async function ensureOrigins(origins) {
  if (!origins.length) return true;
  if (await chrome.permissions.contains({ origins })) return true;
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false; // the browser only asks after a click, and a long wait can use that click up
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function fetchPhoto(url, tabId) {
  let blob;
  if (url.startsWith('blob:')) {
    const read = await send(tabId, { type: 'read-blob', url });
    if (!read || !read.dataUrl) throw new Error('could not read the photo from the page');
    blob = await (await fetch(read.dataUrl)).blob();
  } else {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  }
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('photo is too large');
  return blob;
}

// ---- hub address -------------------------------------------------------------------------------------

async function loadHub() {
  const { hubUrl } = await chrome.storage.local.get('hubUrl');
  if (hubUrl) {
    const parsed = normalizeHubUrl(hubUrl);
    if (parsed.ok) { state.hub = parsed; $('hub').value = parsed.url; $('hub-host').textContent = new URL(parsed.url).host; return; }
  }
  $('settings').open = true; // first run: ask for the address
  setStatus('info', 'First, enter the Zawadie hub address below.');
}

$('save-hub').addEventListener('click', async () => {
  const parsed = normalizeHubUrl($('hub').value);
  $('hub-msg').textContent = parsed.ok ? 'Saved.' : parsed.error;
  if (!parsed.ok) return;
  state.hub = parsed;
  $('hub').value = parsed.url;
  $('hub-host').textContent = new URL(parsed.url).host;
  await chrome.storage.local.set({ hubUrl: parsed.url }); // the only thing this extension ever stores
  setStatus('', '');
});

// ---- step 1: pick the profile photo ----------------------------------------------------------------------

function showReference() {
  $('reference').hidden = !state.reference;
  $('check').disabled = !state.reference || state.running;
  if (!state.reference) return;
  $('ref-thumb').src = state.reference.url;
  let label = state.reference.url;
  try { const u = new URL(label); label = `${u.host}${u.pathname.slice(-24)}`; } catch { /* keep the raw value */ }
  $('ref-name').textContent = label;
}

$('pick').addEventListener('click', async () => {
  const tabId = await activeTabId();
  if (!(await ensureContent(tabId))) return setStatus('error', PAGE_HELP);
  await send(tabId, { type: 'pick-start' });
  setStatus('info', 'Now click the profile photo on the page. Press Esc to cancel.');
});

chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === 'picked' && sender.tab) {
    state.reference = { url: msg.url, tabId: sender.tab.id };
    showReference();
    setStatus('', '');
  } else if (msg.type === 'pick-cancelled') {
    setStatus('', '');
  }
});

// ---- step 2: check the gallery -----------------------------------------------------------------------

function rowBadgeText(row) {
  const score = row.score == null ? '' : ` ${row.score.toFixed(2)}`;
  return { match: `✓ Match${score}`, possible: `? Possible${score}`, no_match: `✕ No match${score}`, no_face: 'No face', unreadable: 'Unreadable' }[row.kind];
}

function renderRows() {
  const rows = [...state.rows].sort((a, b) => REVIEW_ORDER.indexOf(a.kind) - REVIEW_ORDER.indexOf(b.kind) || a.position - b.position);
  $('summary').textContent = summarize(rows.map((r) => r.kind));
  $('rows').replaceChildren(...rows.map((row) => {
    const meta = [`Photo ${row.position}`];
    if (row.score != null) meta.push(`score ${row.score.toFixed(2)}`);
    if (row.faces > 1) meta.push(`${row.faces} faces, best one used`);
    return el('li', { 'data-kind': row.kind },
      el('div', { class: 'top' }, el('span', { class: `pill ${row.kind}` }, row.label),
        el('button', { type: 'button', class: 'link', onclick: () => showOnPage(row.url) }, 'Show on page')),
      el('div', { class: 'meta' }, meta.join(' · ')),
      row.issues && row.issues.length
        ? el('div', { class: 'note' }, `Photo quality may affect this: ${row.issues.join('; ')}.${row.kind === 'no_match' ? ' A real match could be hidden.' : ''}`)
        : null);
  }));
  $('results').hidden = false;
}

async function showOnPage(url) {
  const tabId = state.reference ? state.reference.tabId : await activeTabId();
  try { await send(tabId, { type: 'scroll-to', url }); } catch { /* the page was closed or reloaded */ }
}

async function pushBadges(tabId) {
  const items = state.rows.map((row) => ({
    url: row.url,
    kind: row.kind,
    text: rowBadgeText(row),
    title: [row.label, row.score == null ? null : `score ${row.score.toFixed(2)}`, ...(row.issues || [])].filter(Boolean).join(' · '),
  }));
  try { await send(tabId, { type: 'badges', items }); } catch { /* the page changed; the list in this panel still stands */ }
}

function stop(kind, message, ...extra) {
  setStatus(kind, message, ...extra);
  throw Object.assign(new Error(message), { handled: true });
}

async function checkGallery() {
  if (state.running) return;
  if (!state.hub) {
    $('settings').open = true;
    return setStatus('error', 'Enter and save the hub address first.');
  }
  const tabId = await activeTabId();
  if (!state.reference || state.reference.tabId !== tabId) return setStatus('error', 'Pick the profile photo on this page first.');

  state.running = true;
  state.rows = [];
  $('results').hidden = true;
  $('check').disabled = true;
  $('bar').hidden = false;
  $('bar').value = 0;
  try {
    if (!(await ensureContent(tabId))) stop('error', PAGE_HELP);
    const { images } = await send(tabId, { type: 'list-images' });
    const gallery = pickGalleryImages(images, state.reference.url);
    if (!gallery.length) stop('error', 'No gallery photos found on this page. Photos smaller than 120 px, and the profile photo itself, are ignored. If the gallery loads as you scroll, scroll down first.');

    const origins = [...new Set([state.hub.origin, originOf(state.reference.url), ...gallery.map((g) => originOf(g.url))].filter(Boolean))].map((o) => `${o}/*`);
    if (!(await ensureOrigins(origins))) stop('error', 'The extension needs permission to read the photos and reach the hub. Press "Check the gallery" again and allow it.');

    setStatus('info', `Reading ${gallery.length} gallery photo${gallery.length === 1 ? '' : 's'}…`);
    let referenceBlob;
    try { referenceBlob = await fetchPhoto(state.reference.url, tabId); } catch (err) { stop('error', `Couldn't download the profile photo (${err.message}).`); }
    const fetched = await mapPool(gallery, 4, async (g, i) => {
      try { return { g, position: i + 1, blob: await fetchPhoto(g.url, tabId) }; } catch (err) { return { g, position: i + 1, error: err.message }; }
    });
    for (const f of fetched.filter((x) => !x.blob)) {
      state.rows.push({ url: f.g.url, position: f.position, kind: 'unreadable', label: `Couldn't download this photo (${f.error})`, score: null });
    }
    const readable = fetched.filter((x) => x.blob);

    $('bar').max = Math.max(readable.length, 1);
    let done = 0;
    for (const batch of chunk(readable, BATCH_SIZE)) {
      setStatus('info', `Comparing photos ${done + 1}–${done + batch.length} of ${readable.length}…`);
      let res;
      try {
        res = await fetch(`${state.hub.url}/match`, {
          method: 'POST', body: buildMatchForm(referenceBlob, batch.map((b) => b.blob)), credentials: 'include', redirect: 'manual',
        });
      } catch {
        stop('error', `Can't reach the hub at ${state.hub.origin}. Check the address and your connection.`);
      }
      const problem = hubProblem(res);
      if (problem) {
        stop('error', problem.message, problem.kind === 'login'
          ? el('button', { type: 'button', class: 'btn', onclick: () => chrome.tabs.create({ url: `${state.hub.origin}/login` }) }, 'Open the hub sign-in page')
          : null);
      }
      const body = await res.json();
      const refProblem = referenceProblem(body.reference);
      if (refProblem) stop('error', `${refProblem} Pick a clear photo with one face, or skip this profile.`);
      for (const r of body.results) {
        const f = batch[r.candidate_index];
        state.rows.push({ url: f.g.url, position: f.position, ...classify(r) });
      }
      done += batch.length;
      $('bar').value = done;
    }
    setStatus('', '');
    renderRows();
    await pushBadges(tabId);
  } catch (err) {
    if (!err.handled) setStatus('error', `Something went wrong: ${err.message}`);
    if (state.rows.length) renderRows();
  } finally {
    state.running = false;
    $('bar').hidden = true;
    $('check').disabled = !state.reference;
  }
}

$('check').addEventListener('click', checkGallery);

$('clear').addEventListener('click', async () => {
  state.rows = [];
  $('results').hidden = true;
  setStatus('', '');
  const tabId = state.reference ? state.reference.tabId : await activeTabId();
  try { await send(tabId, { type: 'clear-badges' }); } catch { /* nothing to clear */ }
});

loadHub();
