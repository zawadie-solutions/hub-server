const state = {
  meetings: [],
  activity: [],
  knowledge: null,
  currentMeetingId: null,
  currentKnowledgeDocId: null,
  chatHistory: [],
  meetingChatHistories: {}, // { [meetingId]: [{role, content}, ...] } — per-meeting "Ask Ombeni" threads
  pendingAttachment: null,
  currentUser: null,
  isAdmin: false,
  calendarConnected: false,
  meetingTab: 'today',
  upcomingCalendar: { calendarAvailable: false, today: [], tomorrow: [] },
  selectedMeetings: new Set() // ids checked in the "Earlier" meetings tab (admin bulk actions)
};

const MEETING_TABS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'earlier', label: 'Earlier' }
];

// Meeting dates come from Notetaker as a UTC calendar date (start_time sliced
// to YYYY-MM-DD), so "yesterday/today/tomorrow" must be computed in UTC too —
// shifting the *local* calendar day and then reading it back via toISOString()
// silently rolls to the wrong UTC date near midnight in any non-UTC timezone,
// which is why a real meeting could go missing from the "Yesterday" tab.
function dateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday's Notetaker API only exposes completed recordings, not a schedule of
// upcoming meetings — so "Tomorrow" will only ever fill in once a meeting from
// tomorrow has actually happened and finished processing. "Earlier" exists so
// meetings older than yesterday (most of what's recorded so far) aren't hidden.
function meetingBucket(m) {
  const yesterday = dateOffset(-1);
  const today = dateOffset(0);
  const tomorrow = dateOffset(1);
  if (m.date === yesterday) return 'yesterday';
  if (m.date === today) return 'today';
  if (m.date === tomorrow) return 'tomorrow';
  return 'earlier';
}

// Notetaker recordings are keyed by id, but the same recording can otherwise
// show up twice (e.g. a re-fetch merged with a stale entry) with the same
// title+date — collapse those so panels show one card per real meeting.
function dedupeMeetings(meetings) {
  const seen = new Set();
  return meetings.filter(m => {
    const key = m.id || `${(m.title || '').toLowerCase()}|${m.date || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PAGE_META = {
  home: { title: 'Home', subtitle: "Zawadie Solutions' company AI assistant" },
  ask: { title: 'Ask Ombeni', subtitle: 'Grounded in the Zawadie knowledge base and every recorded meeting' },
  knowledge: { title: 'Knowledge', subtitle: 'Zawadie knowledge base and recorded meetings' },
  meetings: { title: 'Meetings', subtitle: 'All recorded meetings Ombeni AI has access to' },
  'meeting-detail': { title: 'Meeting', subtitle: '' },
  'meeting-restricted': { title: 'Meeting', subtitle: '' },
  activity: { title: 'Activity', subtitle: 'History of AI actions and integration events' },
  settings: { title: 'Settings', subtitle: 'Integrations and knowledge source' }
};

// ---------------- Routing ----------------

function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  const target = document.getElementById(`view-${name}`);
  if (target) target.hidden = false;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name || (name === 'meeting-detail' && btn.dataset.view === 'meetings'));
  });

  const meta = PAGE_META[name] || { title: '', subtitle: '' };
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSubtitle').textContent = meta.subtitle;

  if (name === 'home') refreshHome();
  if (name === 'knowledge') refreshKnowledge();
  if (name === 'meetings') refreshMeetings();
  if (name === 'activity') refreshActivity();
  if (name === 'settings') refreshSettings();
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.view));
});
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-view-link]');
  if (link) goToView(link.dataset.viewLink);
});

// ---------------- API helpers ----------------

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`api${path}`, {
    ...options,
    headers: isFormData ? undefined : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401) {
    // Session expired or signed out elsewhere — re-show the login gate.
    showLoginScreen();
    throw new Error('Not signed in');
  }
  const result = await res.json();
  if (!result.success) {
    const err = new Error(result.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return result;
}

// ---------------- Auth ----------------

function showLoginScreen() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
}

function showApp() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
}

function renderUserProfile(user) {
  const profile = document.getElementById('userProfile');
  if (!user) { profile.hidden = true; return; }
  profile.hidden = false;
  // Initials on a solid badge — simpler and more reliable than the Google
  // profile photo, which can silently fail to load (broken-image icon).
  document.getElementById('userAvatar').textContent = escapeHtml((user.name || user.email || '?').slice(0, 1).toUpperCase());
  document.getElementById('userName').textContent = user.name || user.email;
}

document.getElementById('signOutBtn').addEventListener('click', async () => {
  // There's only one real sign-out now: the hub's. Clear this app's local
  // session (Calendar connection included) first, then sign out of the hub
  // itself so re-entering any solution asks for a fresh hub login.
  await fetch('auth/logout', { method: 'POST' });
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/';
});

async function initAuth() {
  const meRes = await fetch('auth/me');
  const me = await meRes.json();
  if (!me.data.user) { showLoginScreen(); return false; }
  state.currentUser = me.data.user;
  state.isAdmin = Boolean(me.data.isAdmin);
  state.calendarConnected = Boolean(me.data.calendarConnected);
  renderUserProfile(me.data.user);
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !state.isAdmin; });
  document.getElementById('calendarConnectBanner').hidden = state.calendarConnected || !me.data.googleConfigured;
  showApp();
  return true;
}

// ---------------- Status / sidebar ----------------

async function loadStatus() {
  try {
    const { data } = await api('/status');
    setDot('dotOpenai', data.openai);
    setDot('dotMonday', data.monday);
    setDot('dotSlack', data.slack);
    // Per-user Calendar connection, not the app-wide Google config — see
    // state.calendarConnected (set from /auth/me in initAuth).
    setDot('dotGoogle', state.calendarConnected);
    return data;
  } catch (err) {
    console.error(err);
  }
}

function setDot(id, on) {
  const el = document.getElementById(id);
  if (el) el.className = `dot ${on ? 'on' : 'off'}`;
}

// ---------------- Home ----------------

async function refreshHome() {
  const meetings = await api('/meetings').then(r => r.data);
  state.meetings = meetings;

  const analyzed = meetings.filter(m => m.analysis).length;
  const allActionItems = meetings.flatMap(m => (m.analysis && m.analysis.actionItems) || []);
  const syncedToMonday = allActionItems.filter(ai => ai.mondayResult && ai.mondayResult.created).length;

  document.getElementById('homeStats').innerHTML = `
    ${statCard(meetings.length, 'Recorded meetings')}
    ${statCard(analyzed, 'AI-summarized')}
    ${statCard(allActionItems.length, 'Action items')}
    ${statCard(syncedToMonday, 'Synced to Monday.com')}
  `;
}

function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${num}</div><div class="label">${escapeHtml(label)}</div></div>`;
}

document.getElementById('homeAskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const q = e.target.value.trim();
    e.target.value = '';
    goToView('ask');
    sendChatMessage(q);
  }
});

document.querySelectorAll('.chip[data-prompt]').forEach(chip => {
  chip.addEventListener('click', () => {
    goToView('ask');
    sendChatMessage(chip.dataset.prompt);
  });
});

// ---------------- Ask Ombeni ----------------

const chatThread = document.getElementById('chatThread');
const chatInput = document.getElementById('chatInput');
const chatFileInput = document.getElementById('chatFileInput');
const chatAttachmentChip = document.getElementById('chatAttachmentChip');
document.getElementById('chatSendBtn').addEventListener('click', () => sendChatMessage());
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

document.getElementById('chatAttachBtn').addEventListener('click', () => chatFileInput.click());
chatFileInput.addEventListener('change', async () => {
  const file = chatFileInput.files[0];
  if (!file) return;
  chatFileInput.value = '';

  chatAttachmentChip.hidden = false;
  chatAttachmentChip.innerHTML = `Uploading ${escapeHtml(file.name)}…`;

  const fd = new FormData();
  fd.append('file', file);
  try {
    const { data } = await api('/chat/attachment', { method: 'POST', body: fd });
    state.pendingAttachment = data;
    renderAttachmentChip();
  } catch (err) {
    chatAttachmentChip.hidden = true;
    alert(`Couldn't read that file: ${err.message}`);
  }
});

function renderAttachmentChip() {
  if (!state.pendingAttachment) { chatAttachmentChip.hidden = true; return; }
  chatAttachmentChip.hidden = false;
  chatAttachmentChip.innerHTML = `📎 ${escapeHtml(state.pendingAttachment.filename)} <button id="clearAttachmentBtn" type="button">✕</button>`;
  document.getElementById('clearAttachmentBtn').addEventListener('click', () => {
    state.pendingAttachment = null;
    renderAttachmentChip();
  });
}

function appendMessage(sender, text, sources) {
  const div = document.createElement('div');
  div.className = `msg ${sender}`;

  if (sender === 'bot') {
    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = 'zawadie-logo.png';
    avatar.alt = 'Ombeni AI';
    div.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  div.appendChild(bubble);

  chatThread.appendChild(div);

  if (sources && sources.length) {
    const srcWrap = document.createElement('div');
    srcWrap.className = 'msg-sources';
    sources.forEach(s => {
      const tag = document.createElement('span');
      tag.className = 'tag tag-neutral';
      tag.textContent = s.title;
      srcWrap.appendChild(tag);
    });
    chatThread.appendChild(srcWrap);
  }

  chatThread.scrollTop = chatThread.scrollHeight;
}

async function sendChatMessage(prefilled) {
  const message = (prefilled !== undefined ? prefilled : chatInput.value).trim();
  const attachment = state.pendingAttachment;
  if (!message && !attachment) return;

  appendMessage('user', message || `Sent a file: ${attachment.filename}`);
  chatInput.value = '';
  state.pendingAttachment = null;
  renderAttachmentChip();

  let content = message;
  if (attachment) {
    const truncated = attachment.text.slice(0, 12000);
    content = `[Attached file: ${attachment.filename}]\n"""\n${truncated}\n"""\n\n${message || 'Please review the attached file and summarize or answer based on it.'}`;
  }
  state.chatHistory.push({ role: 'user', content });

  const thinkingBubble = document.createElement('div');
  thinkingBubble.className = 'msg bot';
  thinkingBubble.innerHTML = '<div class="msg-bubble">Thinking…</div>';
  chatThread.appendChild(thinkingBubble);
  chatThread.scrollTop = chatThread.scrollHeight;

  try {
    const { reply, sourcesUsed } = await api('/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: state.chatHistory })
    });
    thinkingBubble.remove();
    appendMessage('bot', reply, sourcesUsed);
    state.chatHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    thinkingBubble.remove();
    appendMessage('bot', `Sorry, something went wrong: ${err.message}`);
  }
}

// ---------------- Knowledge ----------------

async function refreshKnowledge() {
  const { data } = await api('/knowledge');
  state.knowledge = data;

  document.getElementById('knowledgeDocsList').innerHTML = data.length
    ? data.map(d => `
        <div class="knowledge-section-item ${d.id === state.currentKnowledgeDocId ? 'active' : ''}" data-kb-doc="${d.id}">
          <span class="kb-doc-title">${escapeHtml(d.title)}</span>
          ${state.isAdmin ? `<button class="kb-doc-delete" data-kb-doc-delete="${d.id}" title="Delete">✕</button>` : ''}
        </div>`).join('')
    : `<div class="empty-state">No documents yet.</div>`;

  const meetings = state.meetings.length ? state.meetings : (await api('/meetings')).data;
  state.meetings = meetings;
  const recentMeetings = dedupeMeetings(meetings)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 4);
  document.getElementById('knowledgeMeetingsList').innerHTML = recentMeetings.map(m =>
    `<div class="knowledge-section-item" data-kb-meeting="${m.id}"><span class="kb-doc-title">${escapeHtml(m.title)}</span></div>`
  ).join('');

  document.querySelectorAll('[data-kb-doc]').forEach(el => {
    el.addEventListener('click', () => openKnowledgeDoc(el.dataset.kbDoc));
  });
  document.querySelectorAll('[data-kb-doc-delete]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteKnowledgeDoc(el.dataset.kbDocDelete);
    });
  });
  document.querySelectorAll('[data-kb-meeting]').forEach(el => {
    el.addEventListener('click', () => openMeeting(el.dataset.kbMeeting));
  });
}

async function openKnowledgeDoc(id) {
  state.currentKnowledgeDocId = id;
  document.querySelectorAll('#knowledgeDocsList .knowledge-section-item').forEach(el =>
    el.classList.toggle('active', el.dataset.kbDoc === id)
  );
  const { data } = await api(`/knowledge/${id}`);
  renderKnowledgeReader(data);
}

function renderKnowledgeReader(doc) {
  const reader = document.getElementById('knowledgeReader');
  reader.innerHTML = `
    <h3>${escapeHtml(doc.title)}</h3>
    <div class="knowledge-reader-meta">${doc.charCount || doc.body.length} characters · updated ${new Date(doc.updatedAt).toLocaleString()}</div>
    ${state.isAdmin ? `
      <div class="knowledge-reader-actions">
        <button class="btn btn-secondary btn-sm" id="editKbDocBtn">Edit</button>
        <button class="btn btn-danger btn-sm" id="deleteKbDocBtn">Delete</button>
      </div>
    ` : ''}
    <div class="knowledge-reader-body" id="kbDocBody">${escapeHtml(doc.body)}</div>
  `;

  if (state.isAdmin) {
    document.getElementById('editKbDocBtn').addEventListener('click', () => renderKnowledgeEditor(doc));
    document.getElementById('deleteKbDocBtn').addEventListener('click', () => deleteKnowledgeDoc(doc.id));
  }
}

function renderKnowledgeEditor(doc) {
  const reader = document.getElementById('knowledgeReader');
  reader.innerHTML = `
    <input type="text" id="kbEditTitle" class="kb-edit-title" value="${escapeHtml(doc.title)}" style="width:100%;font-size:16px;font-weight:700;padding:8px 10px;border:1px solid var(--ombeni-border);border-radius:6px;margin-bottom:10px;">
    <textarea id="kbEditBody" class="kb-edit-textarea">${escapeHtml(doc.body)}</textarea>
    <div class="knowledge-reader-actions" style="margin-top:12px;">
      <button class="btn btn-primary btn-sm" id="saveKbDocBtn">Save changes</button>
      <button class="btn btn-ghost btn-sm" id="cancelKbEditBtn">Cancel</button>
    </div>
  `;

  document.getElementById('cancelKbEditBtn').addEventListener('click', () => renderKnowledgeReader(doc));
  document.getElementById('saveKbDocBtn').addEventListener('click', async () => {
    const title = document.getElementById('kbEditTitle').value.trim();
    const body = document.getElementById('kbEditBody').value;
    try {
      const { data } = await api(`/knowledge/${doc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, body })
      });
      renderKnowledgeReader(data);
      refreshKnowledge();
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
    }
  });
}

async function deleteKnowledgeDoc(id) {
  if (!confirm('Delete this knowledge document? This cannot be undone.')) return;
  try {
    await api(`/knowledge/${id}`, { method: 'DELETE' });
    if (state.currentKnowledgeDocId === id) {
      state.currentKnowledgeDocId = null;
      document.getElementById('knowledgeReader').innerHTML = '<div class="empty-state">Select a document to read it.</div>';
    }
    refreshKnowledge();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

const showAddKnowledgeBtn = document.getElementById('showAddKnowledgeBtn');
const addKnowledgeForm = document.getElementById('addKnowledgeForm');
showAddKnowledgeBtn.addEventListener('click', () => { addKnowledgeForm.hidden = !addKnowledgeForm.hidden; });
document.getElementById('cancelAddKnowledgeBtn').addEventListener('click', () => {
  addKnowledgeForm.hidden = true;
  addKnowledgeForm.reset();
});

addKnowledgeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('kbTitleInput').value.trim();
  const file = document.getElementById('kbFileInput').files[0];
  const text = document.getElementById('kbTextInput').value.trim();

  if (!file && !text) { alert('Upload a file or paste some text first.'); return; }

  const fd = new FormData();
  if (title) fd.append('title', title);
  if (file) fd.append('file', file);
  else fd.append('body', text);

  try {
    const { data } = await api('/knowledge', { method: 'POST', body: fd });
    addKnowledgeForm.reset();
    addKnowledgeForm.hidden = true;
    await refreshKnowledge();
    openKnowledgeDoc(data.id);
  } catch (err) {
    alert(`Couldn't add document: ${err.message}`);
  }
});

// ---------------- Meetings ----------------

async function refreshMeetings() {
  const [{ data }, upcoming] = await Promise.all([
    api('/meetings'),
    api('/meetings/upcoming').then(r => r.data).catch(err => {
      console.error('meetings/upcoming request failed:', err);
      return { calendarAvailable: false, today: [], tomorrow: [], error: err.message };
    })
  ]);
  state.meetings = data;
  state.upcomingCalendar = upcoming;
  renderMeetingTabs();
  renderMeetingsList();
}

function upcomingCountForBucket(key) {
  if (key !== 'today' && key !== 'tomorrow') return 0;
  return (state.upcomingCalendar[key] || []).filter(e => !e.recordedMeetingId).length;
}

function renderMeetingTabs() {
  document.getElementById('meetingTabs').innerHTML = MEETING_TABS.map(t => {
    const count = state.meetings.filter(m => meetingBucket(m) === t.key).length + upcomingCountForBucket(t.key);
    return `<button class="chip ${state.meetingTab === t.key ? 'active' : ''}" data-meeting-tab="${t.key}">${t.label} (${count})</button>`;
  }).join('');
  document.querySelectorAll('[data-meeting-tab]').forEach(el => {
    el.addEventListener('click', () => {
      state.meetingTab = el.dataset.meetingTab;
      state.selectedMeetings.clear();
      renderMeetingTabs();
      renderMeetingsList();
    });
  });
}

// Four statuses, matching what's actually knowable: a calendar event with no
// matching recording is "Upcoming" (hasn't started), "Live" (happening now),
// or — once its scheduled end time has passed with still no recording —
// "Not Recorded" (Notetaker likely wasn't admitted to the call, or recording
// otherwise failed; this is also the state a still-processing recording
// briefly shows before it appears). Recorded meetings render separately via
// meetingListCard(), tagged "Recorded".
const EVENT_STATUS_TAGS = {
  upcoming: ['tag-gold', 'Upcoming'],
  live: ['tag-green', '● Live'],
  'not-recorded': ['tag-red', 'Not Recorded']
};
const EVENT_STATUS_NOTES = {
  upcoming: 'Not yet recorded',
  live: 'In progress — not yet recorded',
  'not-recorded': "Notetaker may not have joined, or the recording hasn't synced yet"
};

function eventStatus(e) {
  if (e.isAllDay) return 'upcoming';
  const now = Date.now();
  if (now < new Date(e.start).getTime()) return 'upcoming';
  if (now <= new Date(e.end).getTime()) return 'live';
  return 'not-recorded';
}

function upcomingEventCard(e) {
  const time = e.isAllDay
    ? 'All day'
    : new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const status = eventStatus(e);
  const [tagClass, tagLabel] = EVENT_STATUS_TAGS[status];
  return `
    <div class="list-card" style="cursor:default;">
      <div class="list-card-row">
        <div class="list-card-title">${escapeHtml(e.title)}</div>
        <span class="tag ${tagClass}">${tagLabel}</span>
      </div>
      <div class="list-card-meta">${escapeHtml(time)}${e.attendees && e.attendees.length ? ` · ${e.attendees.length} attendees` : ''}</div>
      <div class="list-card-stats"><span>${EVENT_STATUS_NOTES[status]}</span></div>
    </div>`;
}

function renderMeetingsList() {
  const filtered = state.meetings.filter(m => meetingBucket(m) === state.meetingTab);
  const upcoming = (state.upcomingCalendar[state.meetingTab] || []).filter(e => !e.recordedMeetingId);

  const html = filtered.map(meetingListCard).join('') + upcoming.map(upcomingEventCard).join('');

  let emptyNote = '';
  if (!html) {
    if ((state.meetingTab === 'today' || state.meetingTab === 'tomorrow') && !state.upcomingCalendar.calendarAvailable) {
      if (state.upcomingCalendar.reason === 'no_refresh_token') {
        emptyNote = ' <a href="auth/google">Connect Google Calendar</a> in Settings to see upcoming meetings here.';
      } else if (state.upcomingCalendar.error) {
        emptyNote = ` Calendar lookup failed: ${escapeHtml(state.upcomingCalendar.error)}`;
      }
    }
    document.getElementById('meetingsList').innerHTML = `<div class="empty-state">Nothing for this period.${emptyNote}</div>`;
  } else {
    document.getElementById('meetingsList').innerHTML = html;
  }

  document.querySelectorAll('[data-meeting-id]').forEach(el => {
    el.addEventListener('click', () => openMeeting(el.dataset.meetingId));
  });
  document.querySelectorAll('[data-meeting-select]').forEach(cb => {
    // Stop the click (and its bubble to the card's open-meeting handler
    // above) before it fires, so checking the box never opens the meeting.
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.meetingSelect;
      if (e.target.checked) state.selectedMeetings.add(id);
      else state.selectedMeetings.delete(id);
      renderMeetingBulkActions();
    });
  });

  renderMeetingBulkActions();
}

function renderMeetingBulkActions() {
  const bar = document.getElementById('meetingBulkActions');
  if (!bar) return;

  const count = state.selectedMeetings.size;
  if (!state.isAdmin || state.meetingTab !== 'earlier' || count === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.hidden = false;
  if (count === 1) {
    const id = [...state.selectedMeetings][0];
    bar.innerHTML = `
      <span class="muted">1 meeting selected</span>
      <button class="btn btn-secondary btn-sm" id="meetingSelectOpenBtn">Open</button>
      <button class="btn btn-danger btn-sm" id="meetingSelectDeleteBtn">Delete</button>
      <button class="btn btn-secondary btn-sm" id="meetingDeselectBtn">Deselect</button>
    `;
    document.getElementById('meetingSelectOpenBtn').addEventListener('click', () => openMeeting(id));
    document.getElementById('meetingSelectDeleteBtn').addEventListener('click', () => deleteSelectedMeetings([id]));
  } else {
    bar.innerHTML = `
      <span class="muted">${count} meetings selected</span>
      <button class="btn btn-danger btn-sm" id="meetingBulkDeleteBtn">Delete selected (${count})</button>
      <button class="btn btn-secondary btn-sm" id="meetingDeselectBtn">Deselect all</button>
    `;
    document.getElementById('meetingBulkDeleteBtn').addEventListener('click', () => deleteSelectedMeetings([...state.selectedMeetings]));
  }
  document.getElementById('meetingDeselectBtn').addEventListener('click', clearMeetingSelection);
}

function clearMeetingSelection() {
  state.selectedMeetings.clear();
  renderMeetingsList();
}

async function deleteSelectedMeetings(ids) {
  const label = ids.length === 1 ? 'this meeting' : `these ${ids.length} meetings`;
  if (!confirm(`Delete ${label}? This can't be undone.`)) return;

  try {
    if (ids.length === 1) {
      await api(`/meetings/${ids[0]}`, { method: 'DELETE' });
    } else {
      await api('/meetings/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
    }
    ids.forEach(id => state.selectedMeetings.delete(id));
    await refreshMeetings();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

document.getElementById('refreshMeetingsBtn').addEventListener('click', async (e) => {
  e.target.textContent = 'Refreshing…';
  e.target.disabled = true;
  try {
    await api('/meetings/refresh', { method: 'POST' });
    await refreshMeetings();
  } catch (err) {
    alert(`Couldn't refresh: ${err.message}`);
  }
  e.target.textContent = 'Refresh from Notetaker';
  e.target.disabled = false;
});

function meetingListCard(m) {
  const actionCount = m.analysis && m.analysis.actionItems ? m.analysis.actionItems.length : 0;
  const summaryLabel = m.analysis ? 'Summary available' : 'Not yet analyzed';
  const selectable = state.isAdmin && state.meetingTab === 'earlier';
  return `
    <div class="list-card" data-meeting-id="${m.id}">
      <div class="list-card-row">
        <div style="display:flex;align-items:flex-start;gap:10px;min-width:0;">
          ${selectable ? `<input type="checkbox" class="meeting-select-checkbox" data-meeting-select="${m.id}" ${state.selectedMeetings.has(m.id) ? 'checked' : ''}>` : ''}
          <div class="list-card-title">${escapeHtml(m.title)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <span class="tag tag-blue">Recorded</span>
          ${m.project ? `<span class="tag tag-neutral">${escapeHtml(m.project)}</span>` : ''}
        </div>
      </div>
      <div class="list-card-meta">${escapeHtml(m.date || '')}${m.durationMinutes ? ` · ${m.durationMinutes} min` : ''}${(m.participants || []).length ? ` · ${(m.participants || []).length} participants` : ''}</div>
      <div class="list-card-stats">
        <span>${summaryLabel}</span>
        <span>${actionCount} action items</span>
      </div>
    </div>`;
}

async function openMeeting(id) {
  state.currentMeetingId = id;
  goToView('meeting-detail');
  try {
    await renderMeetingDetail();
  } catch (err) {
    if (err.status === 403) {
      goToView('meeting-restricted');
    } else {
      alert(`Couldn't open meeting: ${err.message}`);
      goToView('meetings');
    }
  }
}

async function renderMeetingDetail() {
  const { data: m } = await api(`/meetings/${state.currentMeetingId}`);
  const container = document.getElementById('meetingDetail');

  document.getElementById('pageTitle').textContent = m.title;
  document.getElementById('pageSubtitle').textContent = [m.date, m.project, m.durationMinutes ? `${m.durationMinutes} min` : null].filter(Boolean).join(' · ');

  let html = `<div class="card">`;

  if (m.transcript) {
    html += `
      <div class="detail-section-title">Transcript</div>
      <div class="detail-body muted" style="white-space:pre-wrap;">${escapeHtml(m.transcript)}</div>
    `;
  }

  if (m.mondayLink) {
    html += `<div style="margin-bottom:16px;"><a href="${escapeHtml(m.mondayLink)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View in Monday.com Notetaker &rarr;</a></div>`;
  }

  html += `<div style="margin-bottom:16px;"><button class="btn btn-secondary btn-sm" id="askOmbeniMeetingBtn">Ask Ombeni about this meeting</button></div>`;

  if (!m.analysis) {
    html += `<div style="margin-top:18px;"><button class="btn btn-primary" id="analyzeBtn">Analyze with Ombeni AI</button></div>`;
  } else {
    const a = m.analysis;
    html += `
      <div class="detail-section-title">Gist</div>
      <div class="detail-body">${escapeHtml(a.summary)}</div>

      ${a.fullSummary ? `
        <div class="detail-section-title">Full summary</div>
        <div class="detail-body">${formatMarkdownLite(a.fullSummary)}</div>
      ` : ''}

      ${(a.keyPoints || []).length ? `
        <div class="detail-section-title">Key discussion points</div>
        <ul class="bullet-list">${a.keyPoints.map(kp => `<li>${escapeHtml(kp)}</li>`).join('')}</ul>
      ` : ''}

      ${(a.decisions || []).length ? `
        <div class="detail-section-title">Decisions</div>
        <ul class="bullet-list">${a.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
      ` : ''}

      <div class="detail-section-title">Action items</div>
      <div id="actionItemsList">
        ${(a.actionItems || []).map(ai => `
          <div class="action-item-row">
            <div style="flex:1;">
              <div class="ai-task">${escapeHtml(ai.task)}</div>
              <div class="ai-meta">${escapeHtml(ai.owner || 'Unassigned')} · Due ${escapeHtml(ai.due || 'n/a')}${ai.priority ? ` · ${escapeHtml(ai.priority)}` : ''}${ai.completed ? ' · Already done' : ''}</div>
            </div>
            ${actionItemSyncTag(ai)}
          </div>`).join('')}
      </div>

      ${(a.unresolved || []).length ? `
        <div class="detail-section-title">Unresolved questions</div>
        <ul class="bullet-list">${a.unresolved.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
      ` : ''}
    `;
  }

  html += `</div>`;

  html += `
    <div class="card meeting-chat-card" id="meetingChatCard" style="margin-top:16px;" hidden>
      <div class="section-label" style="display:flex;align-items:center;gap:8px;">
        <img src="zawadie-logo.png" alt="" style="width:18px;height:18px;border-radius:4px;">
        Ask Ombeni about this meeting
      </div>
      <div id="meetingChatThread" class="chat-thread meeting-chat-thread"></div>
      <div class="chat-input-area">
        <input type="text" id="meetingChatInput" placeholder="Ask about this meeting...">
        <button class="btn btn-primary btn-sm" id="meetingChatSendBtn">Send</button>
      </div>
    </div>
  `;

  container.innerHTML = html;

  const askOmbeniMeetingBtn = document.getElementById('askOmbeniMeetingBtn');
  const meetingChatCard = document.getElementById('meetingChatCard');
  if (askOmbeniMeetingBtn) {
    askOmbeniMeetingBtn.addEventListener('click', () => {
      meetingChatCard.hidden = !meetingChatCard.hidden;
      if (!meetingChatCard.hidden) {
        renderMeetingChatThread(m);
        document.getElementById('meetingChatInput').focus();
      }
    });
  }

  const meetingChatInput = document.getElementById('meetingChatInput');
  const meetingChatSendBtn = document.getElementById('meetingChatSendBtn');
  if (meetingChatSendBtn) {
    meetingChatSendBtn.addEventListener('click', () => sendMeetingChatMessage(m));
    meetingChatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMeetingChatMessage(m); });
  }

  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.textContent = 'Analyzing…';
      analyzeBtn.disabled = true;
      try {
        await api(`/meetings/${state.currentMeetingId}/analyze`, { method: 'POST' });
        await renderMeetingDetail();
      } catch (err) {
        alert(`Analysis failed: ${err.message}`);
        analyzeBtn.textContent = 'Analyze with Ombeni AI';
        analyzeBtn.disabled = false;
      }
    });
  }

}

// Action items are pushed to Monday.com automatically (see
// store.syncActionItemsToMonday server-side) — this just reflects whatever
// that process has already recorded on the item, no user action needed.
function actionItemSyncTag(ai) {
  if (ai.completed) return '';
  if (ai.mondayResult && ai.mondayResult.created) return '<span class="tag tag-green">Added to Monday.com</span>';
  return '<span class="tag tag-gold">Pending Monday.com sync</span>';
}

function renderMeetingChatThread(m) {
  const thread = document.getElementById('meetingChatThread');
  if (!thread) return;
  const history = state.meetingChatHistories[m.id] || [];

  thread.innerHTML = `
    <div class="msg bot">
      <img class="chat-avatar" src="zawadie-logo.png" alt="Ombeni AI">
      <div class="msg-bubble">Ask me anything about "${escapeHtml(m.title)}" — I'll answer using its transcript and summary.</div>
    </div>
  ` + history.map(h => `
    <div class="msg ${h.role === 'user' ? 'user' : 'bot'}">
      ${h.role === 'user' ? '' : '<img class="chat-avatar" src="zawadie-logo.png" alt="Ombeni AI">'}
      <div class="msg-bubble">${escapeHtml(h.content)}</div>
    </div>
  `).join('');

  thread.scrollTop = thread.scrollHeight;
}

async function sendMeetingChatMessage(m) {
  const input = document.getElementById('meetingChatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  if (!state.meetingChatHistories[m.id]) state.meetingChatHistories[m.id] = [];
  const history = state.meetingChatHistories[m.id];
  history.push({ role: 'user', content: message });
  renderMeetingChatThread(m);

  const thread = document.getElementById('meetingChatThread');
  const thinking = document.createElement('div');
  thinking.className = 'msg bot';
  thinking.innerHTML = '<div class="msg-bubble">Thinking…</div>';
  thread.appendChild(thinking);
  thread.scrollTop = thread.scrollHeight;

  try {
    const { reply } = await api('/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: history, meetingId: m.id })
    });
    history.push({ role: 'assistant', content: reply });
    renderMeetingChatThread(m);
  } catch (err) {
    thinking.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'msg bot';
    errDiv.innerHTML = `<div class="msg-bubble">Sorry, something went wrong: ${escapeHtml(err.message)}</div>`;
    thread.appendChild(errDiv);
  }
}

// ---------------- Activity ----------------

async function refreshActivity() {
  const { data } = await api('/activity');
  state.activity = data;
  document.getElementById('activityTableBody').innerHTML = data.length
    ? data.map(a => `
        <tr>
          <td>${escapeHtml(a.user)}</td>
          <td>${escapeHtml(a.action)}</td>
          <td class="muted">${escapeHtml(a.source)}</td>
          <td class="muted">${new Date(a.time).toLocaleString()}</td>
          <td><span class="tag ${a.result === 'Success' ? 'tag-green' : a.result === 'Error' ? 'tag-red' : 'tag-gold'}">${escapeHtml(a.result)}</span></td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="muted">No activity yet.</td></tr>`;
}

// ---------------- Settings ----------------

async function refreshSettings() {
  const status = await loadStatus();
  const rows = [
    ['OpenAI', status.openai, 'Powers meeting analysis and Ask Ombeni.'],
    ['Monday.com', status.monday, status.monday ? 'Connected — tasks sync automatically.' : 'Not connected yet — tasks are stored locally as "Pending Monday.com sync" until MONDAY_API_KEY and MONDAY_BOARD_ID are set.'],
    ['Monday Notetaker', status.notetaker, status.notetaker ? 'Meetings are pulled live from your recorded Notetaker calls.' : 'Not active — showing demo meeting data instead of real recordings.'],
    ['Slack', status.slack, status.slack ? 'Connected — Ombeni AI can post notifications.' : 'Not connected yet — set SLACK_BOT_TOKEN and SLACK_CHANNEL to enable notifications.'],
    [
      'Google Calendar',
      state.calendarConnected,
      state.calendarConnected
        ? 'Connected — meeting notes can be matched against your calendar.'
        : status.google
          ? 'Not connected yet — connect your calendar to match meeting notes against it.'
          : 'Not configured — ask an admin to set GOOGLE_CLIENT_ID/SECRET to enable this.'
    ]
  ];
  document.getElementById('settingsIntegrations').innerHTML = rows.map(([name, on, desc]) => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
      <div>
        <div style="font-weight:600;">${escapeHtml(name)}</div>
        <div class="muted">${escapeHtml(desc)}</div>
      </div>
      ${name === 'Google Calendar' && !on && status.google
        ? '<a class="btn btn-sm btn-secondary" href="auth/google">Connect</a>'
        : `<span class="tag ${on ? 'tag-green' : 'tag-neutral'}">${on ? 'Connected' : 'Not connected'}</span>`}
    </div>
  `).join('');

  const { data } = await api('/knowledge');
  document.getElementById('settingsKbInfo').textContent = `${data.length} document(s) loaded — editable from the Knowledge page and used to ground every Ombeni AI answer.`;

  const section = document.getElementById('systemInstructionsSection');
  if (state.isAdmin) {
    section.hidden = false;
    const { data: instructions } = await api('/system-instructions');
    document.getElementById('systemInstructionsInput').value = instructions.body || '';
    updateSystemInstructionsMeta(instructions);
  } else {
    section.hidden = true;
  }

  const mondayBoardSection = document.getElementById('mondayBoardSection');
  if (state.isAdmin) {
    mondayBoardSection.hidden = false;
    await refreshMondayBoardSettings();
  } else {
    mondayBoardSection.hidden = true;
  }

  const adminsSection = document.getElementById('adminsSection');
  if (state.isAdmin) {
    adminsSection.hidden = false;
    await refreshAdminsList();
  } else {
    adminsSection.hidden = true;
  }
}

async function refreshMondayBoardSettings() {
  const select = document.getElementById('mondayBoardSelect');
  const meta = document.getElementById('mondayBoardMeta');
  try {
    const { data } = await api('/settings/monday-board');
    if (!data.boards.length) {
      select.innerHTML = '<option value="">Monday.com not connected</option>';
      select.disabled = true;
      meta.textContent = 'Set MONDAY_API_KEY on the server to choose a board here.';
      return;
    }
    select.disabled = false;
    select.innerHTML = data.boards.map(b =>
      `<option value="${escapeHtml(b.id)}" ${String(b.id) === String(data.boardId) ? 'selected' : ''}>${escapeHtml(b.name)}</option>`
    ).join('');
    meta.textContent = data.boardId
      ? `Currently creating tasks on board id ${data.boardId}.`
      : 'No board selected yet — tasks will be stored as "pending sync" until one is chosen.';
  } catch (err) {
    meta.textContent = `Couldn't load boards: ${err.message}`;
  }
}

document.getElementById('saveMondayBoardBtn').addEventListener('click', async (e) => {
  const boardId = document.getElementById('mondayBoardSelect').value;
  if (!boardId) return;
  e.target.disabled = true;
  e.target.textContent = 'Saving…';
  try {
    await api('/settings/monday-board', { method: 'PUT', body: JSON.stringify({ boardId }) });
    await refreshMondayBoardSettings();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  }
  e.target.disabled = false;
  e.target.textContent = 'Save';
});

async function refreshAdminsList() {
  const { data } = await api('/admins');
  const myEmail = state.currentUser ? state.currentUser.email : null;
  document.getElementById('adminsList').innerHTML = data.map(email => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;">
      <span style="font-size:13.5px;">${escapeHtml(email)}${email === myEmail ? ' <span class="muted">(you)</span>' : ''}</span>
      <button class="kb-doc-delete" data-remove-admin="${escapeHtml(email)}" title="Remove admin">✕</button>
    </div>
  `).join('');
  document.querySelectorAll('[data-remove-admin]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm(`Remove ${el.dataset.removeAdmin} as an admin?`)) return;
      try {
        await api(`/admins/${encodeURIComponent(el.dataset.removeAdmin)}`, { method: 'DELETE' });
        await refreshAdminsList();
      } catch (err) {
        alert(`Couldn't remove admin: ${err.message}`);
      }
    });
  });
}

document.getElementById('addAdminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('adminEmailInput');
  const email = input.value.trim();
  if (!email) return;
  try {
    await api('/admins', { method: 'POST', body: JSON.stringify({ email }) });
    input.value = '';
    await refreshAdminsList();
  } catch (err) {
    alert(`Couldn't add admin: ${err.message}`);
  }
});

function updateSystemInstructionsMeta(instructions) {
  const el = document.getElementById('systemInstructionsMeta');
  el.textContent = instructions.updatedAt
    ? `Last updated ${new Date(instructions.updatedAt).toLocaleString()} by ${instructions.updatedBy || 'unknown'}`
    : 'Not set yet — Ombeni AI is using its default behavior only.';
}

document.getElementById('saveSystemInstructionsBtn').addEventListener('click', async (e) => {
  const body = document.getElementById('systemInstructionsInput').value;
  e.target.disabled = true;
  e.target.textContent = 'Saving…';
  try {
    const { data } = await api('/system-instructions', { method: 'PUT', body: JSON.stringify({ body }) });
    updateSystemInstructionsMeta(data);
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  }
  e.target.disabled = false;
  e.target.textContent = 'Save instructions';
});

// ---------------- Utilities ----------------

// Very small, deliberately limited markdown-to-HTML pass for Notetaker's
// "### Heading\n* bullet" style summaries — not a general markdown parser.
function formatMarkdownLite(text) {
  const lines = String(text ?? '').split('\n');
  let html = '';
  let inList = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{2,3}\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<div style="font-weight:700;margin:14px 0 6px;">${escapeHtml(line.replace(/^#{2,3}\s+/, ''))}</div>`;
    } else if (/^[*-]\s+/.test(line)) {
      if (!inList) { html += '<ul class="bullet-list">'; inList = true; }
      html += `<li>${escapeHtml(line.replace(/^[*-]\s+/, ''))}</li>`;
    } else if (line === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<div style="margin:4px 0;">${escapeHtml(line)}</div>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------------- Meeting notifications ----------------
// Client-side only: fires a browser notification ~15 minutes before a meeting
// on today's calendar starts, and re-renders the Meetings page periodically
// so "Live" status turns on right as a meeting starts. This only works while
// the app tab is open — true background alerts (tab closed) would need a
// service worker + push subscriptions, which isn't wired up.

let notifiedMeetingIds;
try {
  notifiedMeetingIds = new Set(JSON.parse(localStorage.getItem('ombeni_notified_meetings') || '[]'));
} catch {
  notifiedMeetingIds = new Set();
}

function saveNotifiedIds() {
  try { localStorage.setItem('ombeni_notified_meetings', JSON.stringify([...notifiedMeetingIds])); } catch {}
}

function maybeRequestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

async function checkUpcomingMeetingNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const { data } = await api('/meetings/upcoming');
    const now = Date.now();
    (data.today || []).forEach(e => {
      if (e.isAllDay || notifiedMeetingIds.has(e.id)) return;
      const minsUntil = (new Date(e.start).getTime() - now) / 60000;
      if (minsUntil > 0 && minsUntil <= 15) {
        new Notification('Meeting starting soon', {
          body: `${e.title} starts at ${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
          icon: 'zawadie-logo.png'
        });
        notifiedMeetingIds.add(e.id);
        saveNotifiedIds();
      }
    });
  } catch {
    // Silent — this is a background poller, not a user-initiated action.
  }
}

function meetingNotificationTick() {
  checkUpcomingMeetingNotifications();
  const meetingsView = document.getElementById('view-meetings');
  const onLiveTab = meetingsView && !meetingsView.hidden && (state.meetingTab === 'today' || state.meetingTab === 'tomorrow');
  if (onLiveTab) {
    // Re-fetch (not just re-render) so a meeting that just finished recording
    // shows up without the user having to manually click refresh.
    refreshMeetings().catch(() => {});
  }
}

// ---------------- Init ----------------

initAuth().then(signedIn => {
  if (!signedIn) return;
  loadStatus();
  goToView('home');
  maybeRequestNotificationPermission();
  setInterval(meetingNotificationTick, 60000);
});
