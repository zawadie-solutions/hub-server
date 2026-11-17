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
  selectedMeetings: new Set(), // ids checked in the "Earlier" meetings tab (admin bulk actions)
  work: null,                  // GET /api/work: { mine, unassigned, waitingOnClient, mondayConnected }
  workBoards: null,            // the person's own Monday.com boards, loaded when first needed
  workExpanded: new Set(),     // assignment ids opened on My Work
  workFocusId: null,           // opened from a Slack link (#work/<id>)
  workAsks: {},                // { [assignmentId]: [{ role, content }] } "Ask about this" threads
  workPanel: {},               // { [assignmentId]: 'explain' | 'check' } the open Phase 2 panel
  currentClient: null          // the client key open on the Clients page
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
  work: { title: 'My Work', subtitle: 'What you were asked to do in meetings, and what success looks like' },
  clients: { title: 'Clients', subtitle: 'What each client has asked for, from the meetings you attended' },
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
  if (name === 'work') refreshWork();
  if (name === 'clients') refreshClients();
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
  await loadWork().catch(() => {});
  const openWork = state.work ? state.work.mine.filter(a => a.status !== 'done').length : 0;

  document.getElementById('homeStats').innerHTML = `
    ${statCard(meetings.length, 'Recorded meetings')}
    ${statCard(analyzed, 'AI-summarized')}
    ${statCard(allActionItems.length, 'Action items')}
    ${statCard(openWork, 'Open in My Work')}
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

  html += `<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <button class="btn btn-secondary btn-sm" id="askOmbeniMeetingBtn">Ask Ombeni about this meeting</button>
    ${m.kind === 'client' ? '<button class="btn btn-secondary btn-sm" id="recapDraftBtn">Draft recap email to the client</button><span id="recapDraftResult" class="work-note" style="margin:0;"></span>' : ''}
  </div>`;

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

  const recapBtn = document.getElementById('recapDraftBtn');
  if (recapBtn) {
    recapBtn.addEventListener('click', async () => {
      const result = document.getElementById('recapDraftResult');
      recapBtn.disabled = true;
      recapBtn.textContent = 'Writing the recap…';
      try {
        const { data } = await api(`/meetings/${m.id}/recap-draft`, { method: 'POST' });
        result.innerHTML = `Saved in your Gmail drafts, to ${escapeHtml(data.to.join(', '))}. Nothing was sent. <a href="${escapeHtml(data.link)}" target="_blank" rel="noopener">Open the draft</a>`;
      } catch (err) {
        if (err.status === 409 && confirm('To save drafts in your Gmail, Ombeni needs your permission once. Ombeni can only create drafts: it never sends email. Continue to Google?')) {
          window.location.href = 'auth/google?gmail=1';
          return;
        }
        result.textContent = err.message;
      }
      recapBtn.disabled = false;
      recapBtn.textContent = 'Draft recap email to the client';
    });
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

// ---------------- My Work ----------------
// Each person's own success statements (see routes/work.js). Nothing here is
// visible to anyone else, admins included.

async function loadWork() {
  const { data } = await api('/work');
  state.work = data;
  updateWorkBadge();
  return data;
}

function updateWorkBadge() {
  const badge = document.getElementById('workBadge');
  const count = state.work ? state.work.mine.filter(a => a.status === 'new').length : 0;
  badge.hidden = count === 0;
  badge.textContent = count;
}

async function refreshWork() {
  const container = document.getElementById('workContent');
  try {
    await loadWork();
  } catch (err) {
    container.innerHTML = `<div class="card empty-state">Couldn't load your work: ${escapeHtml(err.message)}</div>`;
    return;
  }
  // New work starts open, so the statement is the first thing you read.
  state.work.mine.filter(a => a.status === 'new').forEach(a => state.workExpanded.add(a.id));
  if (state.workFocusId) state.workExpanded.add(state.workFocusId);
  renderWork();

  if (state.workFocusId) {
    const el = document.querySelector(`[data-work-id="${CSS.escape(state.workFocusId)}"]`);
    if (el) {
      el.classList.add('is-focus');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      alert("That assignment isn't on your list. It may have been passed to someone else.");
    }
    state.workFocusId = null;
  }
}

function formatDueDate(iso) {
  if (!iso) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dueLabel(statement) {
  return formatDueDate(statement.due) || statement.dueSaid || null;
}

function workPoints(points, cls) {
  return `<ul class="work-points ${cls || ''}">${points.map(p => `
    <li>${escapeHtml(p.text)}${p.quote ? `<span class="work-quote">"${escapeHtml(p.quote)}"${p.speaker ? ` (${escapeHtml(p.speaker)}${p.time ? `, ${escapeHtml(p.time)}` : ''})` : ''}</span>` : ''}</li>`).join('')}
  </ul>`;
}

function statementHtml(a) {
  const s = a.statement;
  const due = dueLabel(s);
  return `
    ${s.outcome ? `<div class="work-outcome">${escapeHtml(s.outcome)}</div>` : ''}
    ${s.mustHaves.length ? `<div class="detail-section-title">Must have</div>${workPoints(s.mustHaves)}` : ''}
    ${s.avoid.length ? `<div class="detail-section-title">Avoid</div>${workPoints(s.avoid, 'avoid')}` : ''}
    <div class="work-facts">
      ${due ? `<div><b>Due:</b> ${escapeHtml(due)}</div>` : ''}
      ${s.deliverTo ? `<div><b>Deliver to:</b> ${escapeHtml(s.deliverTo)}</div>` : ''}
      ${a.assignedBy ? `<div><b>Asked by:</b> ${escapeHtml(a.assignedBy === 'self' ? 'You volunteered' : a.assignedBy)}</div>` : ''}
    </div>
    ${s.unclear.length ? `<div class="detail-section-title">Still unclear: ask before you start</div>${workPoints(s.unclear.map(u => ({ text: u })), 'unclear')}` : ''}`;
}

function mondayControls(a) {
  if (a.monday) return `<span class="tag tag-green">On Monday.com: ${escapeHtml(a.monday.boardName)}</span>`;
  if (a.status === 'done') return '';
  // Tasks go to Monday as the person, on their own board, so they connect their own Monday first.
  if (!state.work.mondayConnected) return '<a class="btn btn-ghost btn-sm" href="auth/monday">Connect Monday to send this</a>';
  if (!state.workBoards) return `<button class="btn btn-ghost btn-sm" data-act="load-boards" data-id="${a.id}">Send to Monday.com…</button>`;
  if (!state.workBoards.length) return `<span class="work-note">Your Monday account has no boards to send to.</span>`;
  return `
    <select data-board-for="${a.id}">
      ${state.workBoards.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}${b.workspace ? ` (${escapeHtml(b.workspace)})` : ''}</option>`).join('')}
    </select>
    <button class="btn btn-secondary btn-sm" data-act="send-monday" data-id="${a.id}">Send to Monday.com</button>`;
}

function askPanel(a) {
  const thread = state.workAsks[a.id];
  if (!thread) return '';
  return `
    <div class="work-ask">
      <div class="chat-thread">
        <div class="msg bot"><div class="msg-bubble">Ask me anything about this assignment. I'll answer from what was said in the meeting, with quotes.</div></div>
        ${thread.map(h => `<div class="msg ${h.role === 'user' ? 'user' : 'bot'}"><div class="msg-bubble">${escapeHtml(h.content)}</div></div>`).join('')}
      </div>
      <div class="chat-input-area">
        <input type="text" data-ask-input="${a.id}" placeholder="e.g. What exactly did they say about the format?">
        <button class="btn btn-primary btn-sm" data-act="ask-send" data-id="${a.id}">Ask</button>
      </div>
    </div>`;
}

// ---- Explain it back / Check my work ----

const EXPLAIN_LABEL = {
  covered: ['tag-green', 'Covered'],
  ok: ['tag-green', 'OK'],
  missed: ['tag-gold', 'Missed'],
  different: ['tag-red', 'Different'],
  conflict: ['tag-red', 'Goes against this']
};

const WORK_LABEL = {
  met: ['tag-green', 'Met'],
  not_met: ['tag-red', 'Not met'],
  unclear: ['tag-gold', "Can't tell"]
};

function resultRows(items, labels, detail) {
  return `<div class="check-list">${items.map(i => {
    const [cls, label] = labels[i.status] || ['tag-neutral', i.status];
    return `
      <div class="check-row">
        <span class="tag ${cls}">${escapeHtml(label)}</span>
        <div>
          <div>${i.kind === 'avoid' ? '<b>Don\'t:</b> ' : ''}${escapeHtml(i.text)}</div>
          ${detail(i)}
        </div>
      </div>`;
  }).join('')}</div>`;
}

function explainPanel(a) {
  const done = a.explained;
  const r = done && done.result;
  return `
    <div class="work-panel">
      <div class="work-panel-title">Explain it back</div>
      <div class="work-note" style="margin:0 0 8px;">In your own words: what will you deliver, by when, and to whom? Ombeni checks it against what was asked, so a misunderstanding shows up now, not after the work is done.</div>
      <textarea data-explain-input="${a.id}" rows="3" placeholder="e.g. I'll write a one-page Google Doc checklist for new clients, with Workspace access done in 2 days, and send it to Tyler by Friday.">${escapeHtml(done ? done.text : '')}</textarea>
      <div class="work-actions" style="margin-top:8px;"><button class="btn btn-primary btn-sm" data-act="explain-send" data-id="${a.id}">${done ? 'Check again' : 'Check my understanding'}</button></div>
      ${r ? `
        <div class="check-verdict ${r.ready ? 'good' : 'warn'}">${r.ready
          ? 'You\'ve got it. Everything that was asked is in your explanation.'
          : `${r.items.filter(i => !['covered', 'ok'].includes(i.status)).length} thing(s) to look at before you start.`}</div>
        ${resultRows(r.items, EXPLAIN_LABEL, i => (i.note ? `<div class="work-note" style="margin-top:2px;">${escapeHtml(i.note)}</div>` : ''))}
        ${r.extra.length ? `<div class="detail-section-title">Not asked for</div>${workPoints(r.extra.map(e => ({ text: e })), 'unclear')}` : ''}` : ''}
    </div>`;
}

function checkPanel(a) {
  const last = (a.checks || [])[0];
  const r = last && last.result;
  return `
    <div class="work-panel">
      <div class="work-panel-title">Check my work</div>
      <div class="work-note" style="margin:0 0 8px;">Before you deliver: upload your draft (.docx, .pdf, .txt, .md), paste it, or describe what you did. Ombeni checks it against every requirement. Your work itself isn't saved, only the result.</div>
      <textarea data-check-input="${a.id}" rows="4" placeholder="Paste your draft, or describe what you did..."></textarea>
      <div class="work-actions" style="margin-top:8px;">
        <input type="file" data-check-file="${a.id}" accept=".txt,.md,.docx,.pdf">
        <button class="btn btn-primary btn-sm" data-act="check-send" data-id="${a.id}">Check it</button>
      </div>
      ${r ? `
        <div class="check-verdict ${r.ready ? 'good' : 'warn'}">${r.ready
          ? 'Ready to deliver: every requirement is met.'
          : `${r.items.filter(i => i.status !== 'met').length} requirement(s) to fix or confirm before you deliver.`}
          <span class="work-note" style="display:block;margin-top:2px;">Checked ${escapeHtml(new Date(last.at).toLocaleString())} · ${escapeHtml(last.source)}${r.truncated ? ' · only the first part of a very long draft was checked' : ''}</span>
        </div>
        ${resultRows(r.items, WORK_LABEL, i => `
          ${i.evidence ? `<span class="work-quote">"${escapeHtml(i.evidence)}"</span>` : ''}
          ${i.fix ? `<div class="work-note" style="margin-top:2px;">${escapeHtml(i.fix)}</div>` : ''}`)}` : ''}
    </div>`;
}

function phase2Tag(a) {
  const last = (a.checks || [])[0];
  if (last) {
    const open = last.result.items.filter(i => i.status !== 'met').length;
    return open ? `<span class="tag tag-gold">${open} to fix</span>` : '<span class="tag tag-green">Ready to deliver</span>';
  }
  if (a.explained && !a.explained.result.ready) return '<span class="tag tag-gold">Check your understanding</span>';
  return '';
}

const WORK_STATUS = {
  new: '<span class="tag tag-red">New</span>',
  confirmed: '<span class="tag tag-blue">Got it</span>',
  done: '<span class="tag tag-green">Done</span>'
};

function workCard(a, mode) {
  const open = state.workExpanded.has(a.id);
  const due = dueLabel(a.statement);
  const me = state.currentUser ? state.currentUser.email.toLowerCase() : '';
  const meta = [`From ${a.meetingTitle}`, a.meetingDate, due ? `Due ${due}` : null].filter(Boolean).join(' · ');

  let actions;
  if (mode === 'unassigned') {
    actions = `<button class="btn btn-primary btn-sm" data-act="claim" data-id="${a.id}">I'll take it</button>`;
  } else if (a.status === 'new') {
    actions = `
      <button class="btn btn-primary btn-sm" data-act="panel" data-panel="explain" data-id="${a.id}">Explain it back</button>
      <button class="btn btn-secondary btn-sm" data-act="got_it" data-id="${a.id}">Got it</button>
      <button class="btn btn-ghost btn-sm" data-act="ask" data-id="${a.id}">Ask about this</button>
      <button class="btn btn-ghost btn-sm" data-act="not_mine" data-id="${a.id}">Not mine</button>
      ${mondayControls(a)}`;
  } else if (a.status === 'confirmed') {
    actions = `
      <button class="btn btn-primary btn-sm" data-act="panel" data-panel="check" data-id="${a.id}">Check my work</button>
      <button class="btn btn-secondary btn-sm" data-act="done" data-id="${a.id}">Mark done</button>
      <button class="btn btn-ghost btn-sm" data-act="panel" data-panel="explain" data-id="${a.id}">Explain it back</button>
      <button class="btn btn-ghost btn-sm" data-act="ask" data-id="${a.id}">Ask about this</button>
      <button class="btn btn-ghost btn-sm" data-act="not_mine" data-id="${a.id}">Not mine</button>
      ${mondayControls(a)}`;
  } else {
    actions = `<button class="btn btn-ghost btn-sm" data-act="reopen" data-id="${a.id}">Reopen</button>${a.monday ? mondayControls(a) : ''}`;
  }

  const notes = [];
  if (mode === 'unassigned') {
    notes.push(a.ownerName ? `Said to: ${a.ownerName}. Ombeni couldn't tell for sure which Zawadie person that is.` : 'Nobody in particular was named for this.');
    if ((a.declinedBy || []).includes(me)) notes.push("You said earlier this isn't yours.");
  } else if (a.slack && a.slack.status === 'not_sent') {
    notes.push(`Not sent to your Slack: ${a.slack.reason}.`);
  }

  return `
    <div class="work-card ${a.status === 'new' && mode === 'mine' ? 'is-new' : ''} ${a.status === 'done' ? 'is-done' : ''}" data-work-id="${a.id}">
      <div class="work-card-head" data-act="toggle" data-id="${a.id}">
        <div style="min-width:0;">
          <div class="work-card-title">${escapeHtml(a.title)}</div>
          <div class="list-card-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="work-tags">${a.sample ? '<span class="tag tag-neutral">Sample</span>' : ''}${mode === 'mine' ? `${a.status !== 'done' ? phase2Tag(a) : ''}${WORK_STATUS[a.status] || ''}` : '<span class="tag tag-gold">Unassigned</span>'}</div>
      </div>
      ${open ? `
        <div class="work-body">
          ${statementHtml(a)}
          <div class="work-actions">${actions}${a.sample && mode === 'mine' ? `<button class="btn btn-ghost btn-sm" data-act="delete-sample" data-id="${a.id}">Delete sample</button>` : ''}</div>
          ${notes.map(n => `<div class="work-note">${escapeHtml(n)}</div>`).join('')}
          ${mode === 'mine' && state.workPanel[a.id] === 'explain' ? explainPanel(a) : ''}
          ${mode === 'mine' && state.workPanel[a.id] === 'check' ? checkPanel(a) : ''}
          ${mode === 'mine' ? askPanel(a) : ''}
        </div>` : ''}
    </div>`;
}

function renderWork() {
  const { mine, unassigned, waitingOnClient } = state.work;
  const open = mine.filter(a => a.status !== 'done').sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1));
  const done = mine.filter(a => a.status === 'done');
  const section = (label, body) => `<div class="work-section"><div class="section-label">${label}</div>${body}</div>`;
  const cards = (items, mode) => `<div class="stack-list">${items.map(a => workCard(a, mode)).join('')}</div>`;

  let html = section('Your work', open.length
    ? cards(open, 'mine')
    : '<div class="card empty-state">Nothing open. When you\'re given work in a recorded meeting, it shows up here and in your Slack.</div>');

  if (unassigned.length) html += section('Unassigned, from meetings you attended', cards(unassigned, 'unassigned'));

  if (waitingOnClient.length) {
    html += section('Waiting on the client', `<div class="stack-list">${waitingOnClient.map(w => `
      <div class="work-card">
        <div class="work-card-title">${escapeHtml(w.meetingTitle)}</div>
        <div class="list-card-meta" style="margin-bottom:10px;">${escapeHtml([w.meetingDate, w.clients.join(', ')].filter(Boolean).join(' · '))}</div>
        ${workPoints(w.items.map(i => ({ text: `${i.who ? `${i.who}: ` : ''}${i.what}`, quote: i.quote, time: i.time })))}
      </div>`).join('')}</div>`);
  }

  if (done.length) html += section('Done', cards(done, 'mine'));
  document.getElementById('workContent').innerHTML = html;
}

function replaceWorkItem(updated, id) {
  state.work.mine = state.work.mine.filter(a => a.id !== id);
  state.work.unassigned = state.work.unassigned.filter(a => a.id !== id);
  if (updated) state.work.mine.push(updated);
  updateWorkBadge();
  renderWork();
}

async function sendWorkQuestion(id) {
  const input = document.querySelector(`[data-ask-input="${CSS.escape(id)}"]`);
  const question = input && input.value.trim();
  if (!question) return;
  const thread = state.workAsks[id];
  thread.push({ role: 'user', content: question });
  thread.push({ role: 'assistant', content: 'Thinking…', pending: true });
  renderWork();
  try {
    const { reply } = await api(`/work/${id}/ask`, {
      method: 'POST',
      body: JSON.stringify({ messages: thread.filter(h => !h.pending) })
    });
    thread.pop();
    thread.push({ role: 'assistant', content: reply });
  } catch (err) {
    thread.pop();
    thread.push({ role: 'assistant', content: `Sorry, something went wrong: ${err.message}` });
  }
  renderWork();
  const next = document.querySelector(`[data-ask-input="${CSS.escape(id)}"]`);
  if (next) next.focus();
}

document.getElementById('workContent').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;

  if (act === 'toggle') {
    if (state.workExpanded.has(id)) state.workExpanded.delete(id);
    else state.workExpanded.add(id);
    return renderWork();
  }
  if (act === 'ask') {
    if (!state.workAsks[id]) state.workAsks[id] = [];
    renderWork();
    const input = document.querySelector(`[data-ask-input="${CSS.escape(id)}"]`);
    if (input) input.focus();
    return;
  }
  if (act === 'ask-send') return sendWorkQuestion(id);
  if (act === 'panel') {
    state.workPanel[id] = state.workPanel[id] === el.dataset.panel ? null : el.dataset.panel;
    renderWork();
    const input = document.querySelector(`[data-${el.dataset.panel}-input="${CSS.escape(id)}"]`);
    if (input) input.focus();
    return;
  }
  if (act === 'explain-send' || act === 'check-send') return sendPhase2Check(act, id, el);
  if (act === 'delete-sample') {
    if (!confirm('Delete this sample?')) return;
    try {
      await api(`/work/${id}`, { method: 'DELETE' });
      replaceWorkItem(null, id);
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  if (act === 'not_mine' && !confirm('Give this back? It goes to the other Zawadie people from that meeting, so one of them can take it.')) return;

  el.disabled = true;
  try {
    if (act === 'load-boards') {
      el.textContent = 'Loading your boards…';
      state.workBoards = (await api('/work/boards')).data;
      return renderWork();
    }
    if (act === 'send-monday') {
      const select = document.querySelector(`[data-board-for="${CSS.escape(id)}"]`);
      el.textContent = 'Sending…';
      const { data } = await api(`/work/${id}/monday`, { method: 'POST', body: JSON.stringify({ boardId: select.value }) });
      return replaceWorkItem(data, id);
    }
    if (act === 'claim') {
      const { data } = await api(`/work/${id}/claim`, { method: 'POST' });
      state.workExpanded.add(id);
      return replaceWorkItem(data, id);
    }
    const { data } = await api(`/work/${id}/respond`, { method: 'POST', body: JSON.stringify({ response: act }) });
    if (act === 'got_it' || act === 'done') state.workExpanded.delete(id);
    replaceWorkItem(data, id);
  } catch (err) {
    alert(err.message);
    renderWork();
  }
});

async function sendPhase2Check(act, id, button) {
  let body;
  if (act === 'explain-send') {
    const text = document.querySelector(`[data-explain-input="${CSS.escape(id)}"]`).value.trim();
    if (!text) return;
    body = JSON.stringify({ text });
  } else {
    const file = document.querySelector(`[data-check-file="${CSS.escape(id)}"]`).files[0];
    const text = document.querySelector(`[data-check-input="${CSS.escape(id)}"]`).value.trim();
    if (!file && !text) return alert('Add your draft, or describe what you did.');
    body = new FormData();
    if (file) body.append('file', file);
    body.append('text', text);
  }
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const { data } = await api(`/work/${id}/${act === 'explain-send' ? 'explain' : 'check'}`, { method: 'POST', body });
    replaceWorkItem(data, id);
  } catch (err) {
    alert(err.message);
    renderWork();
  }
}

document.getElementById('workContent').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.askInput) sendWorkQuestion(e.target.dataset.askInput);
});

// ---------------- Clients ----------------
// Each person's own view of the clients they've met: only the meetings they
// attended, and only their own work (see routes/clients.js).

async function refreshClients() {
  const list = document.getElementById('clientsList');
  try {
    const { data } = await api('/clients');
    list.innerHTML = data.length
      ? data.map(c => `
          <div class="knowledge-section-item ${c.key === state.currentClient ? 'active' : ''}" data-client="${escapeHtml(c.key)}">
            <span class="kb-doc-title">${escapeHtml(c.key)}<span class="work-note" style="display:block;margin:0;">${c.meetings} meeting(s) · last ${escapeHtml(c.lastDate)}</span></span>
          </div>`).join('')
      : '<div class="empty-state">No client meetings yet. Meetings with people from outside zawadie.com show up here.</div>';
  } catch (err) {
    list.innerHTML = `<div class="empty-state">Couldn't load clients: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('clientsList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-client]');
  if (item) openClient(item.dataset.client);
});

async function openClient(key) {
  state.currentClient = key;
  document.querySelectorAll('[data-client]').forEach(el => el.classList.toggle('active', el.dataset.client === key));
  const box = document.getElementById('clientDetail');
  box.innerHTML = '<div class="muted">Loading…</div>';
  try {
    const { data } = await api(`/clients/${encodeURIComponent(key)}`);
    renderClient(data);
  } catch (err) {
    box.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderClientSummary(s) {
  if (!s) return '<button class="btn btn-primary btn-sm" id="clientSummaryBtn">Summarize what they\'ve asked for</button>';
  return `
    ${s.askedFor.length ? `<div class="detail-section-title">What they've asked for</div>${workPoints(s.askedFor.map(a => ({ text: a.date ? `${a.text} (${a.date})` : a.text })))}` : ''}
    ${s.changes.length ? `<div class="detail-section-title">Changed their mind</div>${workPoints(s.changes.map(c => ({ text: `${c.what}: was "${c.before}" (${c.from}), now "${c.after}" (${c.to})` })), 'avoid')}` : ''}
    ${s.preferences.length ? `<div class="detail-section-title">How they like to work</div>${workPoints(s.preferences.map(t => ({ text: t })))}` : ''}
    ${s.open.length ? `<div class="detail-section-title">Still open</div>${workPoints(s.open.map(t => ({ text: t })), 'unclear')}` : ''}
    <div class="work-note">Written by Ombeni from the meetings below. Check the meeting itself before relying on a detail.</div>`;
}

function renderClient(c) {
  const box = document.getElementById('clientDetail');
  box.innerHTML = `
    <div class="detail-title">${escapeHtml(c.key)}</div>
    <div class="detail-meta">From the ${c.meetings.length} meeting(s) with them that you attended. Only you see this view.</div>
    <div id="clientSummary">${renderClientSummary(c.summary)}</div>
    ${c.mine.length ? `<div class="detail-section-title">Your work for them</div>
      <div class="stack-list">${c.mine.map(a => `<div class="work-card" style="cursor:pointer;" data-open-work="${a.id}"><div class="work-card-title" style="font-size:14px;">${escapeHtml(a.title)}</div><div class="list-card-meta">${escapeHtml([a.meetingDate, a.status === 'done' ? 'Done' : null, a.statement.due ? `Due ${formatDueDate(a.statement.due)}` : null].filter(Boolean).join(' · '))}</div></div>`).join('')}</div>` : ''}
    ${c.waiting.length ? `<div class="detail-section-title">Waiting on them</div>${workPoints(c.waiting.map(w => ({ text: `${w.who ? `${w.who}: ` : ''}${w.what}`, quote: w.quote })))}` : ''}
    <div class="detail-section-title">Meetings</div>
    <div class="stack-list">${c.meetings.map(m => `
      <div class="list-card" data-open-meeting="${m.id}">
        <div class="list-card-title" style="font-size:14px;">${escapeHtml(m.title)}</div>
        <div class="list-card-meta">${escapeHtml(m.date || '')}</div>
        ${m.summary ? `<div class="muted" style="margin-top:6px;">${escapeHtml(m.summary)}</div>` : ''}
      </div>`).join('')}</div>`;

  const btn = document.getElementById('clientSummaryBtn');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Reading the meetings…';
    try {
      const { data } = await api(`/clients/${encodeURIComponent(c.key)}/summary`, { method: 'POST' });
      document.getElementById('clientSummary').innerHTML = renderClientSummary(data);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = 'Summarize what they\'ve asked for';
    }
  });
}

document.getElementById('clientDetail').addEventListener('click', (e) => {
  const meeting = e.target.closest('[data-open-meeting]');
  if (meeting) return openMeeting(meeting.dataset.openMeeting);
  const work = e.target.closest('[data-open-work]');
  if (work) {
    state.workFocusId = work.dataset.openWork;
    goToView('work');
  }
});

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

// ---- Your co-worker (morning message, meeting prep) ----

async function refreshCoworkerSettings() {
  const box = document.getElementById('coworkerSettings');
  let c;
  try {
    c = (await api('/me/coworker')).data;
  } catch (err) {
    box.innerHTML = `<div class="muted">Couldn't load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  let google;
  if (!c.canStore) {
    google = '<div class="work-note">Not available yet: an admin needs to set OMBENI_TOKEN_KEY on the server.</div>';
  } else if (c.google && c.google.connected) {
    google = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="muted">Google connected${c.google.connectedAt ? ` since ${escapeHtml(new Date(c.google.connectedAt).toLocaleDateString())}` : ''}${c.timeZone ? ` · your time zone: ${escapeHtml(c.timeZone)}` : ''}</div>
        <button class="btn btn-ghost btn-sm" id="disconnectGoogleBtn">Disconnect Google</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px;">
        <div class="muted">${c.google.gmailDrafts
          ? 'Gmail drafts allowed: Ombeni can save recap and follow-up emails in your drafts. It never sends.'
          : 'Gmail drafts: let Ombeni save recap and follow-up emails in your Gmail drafts for you to review. It never sends.'}</div>
        ${c.google.gmailDrafts ? '<span class="tag tag-green">Allowed</span>' : '<a class="btn btn-secondary btn-sm" href="auth/google?gmail=1">Allow Gmail drafts</a>'}
      </div>`;
  } else {
    google = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="muted">${c.google && c.google.broken ? 'Your Google connection stopped working. Connect again to keep getting messages.' : 'Connect your Google Calendar so Ombeni can prepare your day.'}</div>
        <a class="btn btn-primary btn-sm" href="auth/google">${c.google && c.google.broken ? 'Reconnect Google' : 'Connect Google'}</a>
      </div>`;
  }

  let monday = '';
  if (c.mondayReady) {
    monday = c.monday && c.monday.connected
      ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px;">
          <div class="muted">Monday connected as ${escapeHtml(c.monday.name || 'you')}: you send work to your own boards. Nothing goes to Monday on its own.</div>
          <button class="btn btn-ghost btn-sm" id="disconnectMondayBtn">Disconnect Monday</button>
        </div>`
      : `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px;">
          <div class="muted">${c.monday && c.monday.broken ? 'Your Monday connection stopped working. Connect again to send work to your boards.' : 'Connect your Monday account to send work to your own boards, as you. Nothing goes to Monday on its own.'}</div>
          <a class="btn btn-secondary btn-sm" href="auth/monday">${c.monday && c.monday.broken ? 'Reconnect Monday' : 'Connect Monday'}</a>
        </div>`;
  }

  const toggle = (name, label, hint) => `
    <label class="coworker-toggle">
      <input type="checkbox" data-coworker-pref="${name}" ${c.prefs[name] ? 'checked' : ''}>
      <span><b>${label}</b><span class="work-note" style="display:block;margin-top:2px;">${hint}</span></span>
    </label>`;

  box.innerHTML = `
    <div class="muted" style="margin-bottom:12px;">Ombeni sends these to your Slack DM. They're built only from your calendar, the meetings you attended, and your own work. Nobody else sees them.</div>
    ${google}
    ${monday}
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px;">
      ${toggle('morning', 'Morning message', 'Weekdays at 7:30 your time: today\'s meetings, and work that\'s due, new or needs fixing.')}
      ${toggle('prep', 'Notes before meetings', 'About 30 minutes before each meeting: what happened last time, what\'s still open, and what to ask.')}
    </div>
    ${c.slackReady ? '' : '<div class="work-note">Slack isn\'t connected on the server yet, so nothing can be sent.</div>'}
    <div class="coworker-try" ${state.isAdmin ? '' : 'hidden'}>
      <div>
        <b>Try it in Slack</b> <span class="tag tag-gold">Admin only</span>
        <span class="work-note" style="display:block;margin-top:2px;">Ombeni makes a sample assignment from your latest recorded meeting and sends it to your Slack DM, like a real one. Press its buttons and reply in its thread to try everything. Delete it from My Work when you're done.</span>
      </div>
      <button class="btn btn-secondary btn-sm" id="sendSampleBtn">Send me a sample</button>
    </div>
    <div class="work-note" id="sampleResult"></div>`;

  box.querySelectorAll('[data-coworker-pref]').forEach(input => input.addEventListener('change', async () => {
    try {
      await api('/me/coworker', { method: 'PUT', body: JSON.stringify({ [input.dataset.coworkerPref]: input.checked }) });
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
      input.checked = !input.checked;
    }
  }));
  const sampleBtn = document.getElementById('sendSampleBtn');
  if (state.isAdmin) sampleBtn.addEventListener('click', async () => {
    const result = document.getElementById('sampleResult');
    sampleBtn.disabled = true;
    sampleBtn.textContent = 'Making your sample…';
    result.textContent = '';
    try {
      const { data } = await api('/work/sample', { method: 'POST' });
      result.textContent = data.slack && data.slack.status === 'sent'
        ? `Sent to your Slack DM: "${data.title}". It's in My Work too.`
        : `Created in My Work, but not sent to Slack${data.slack && data.slack.reason ? `: ${data.slack.reason}` : ''}.`;
      loadWork().catch(() => {});
    } catch (err) {
      result.textContent = err.message;
    }
    sampleBtn.disabled = false;
    sampleBtn.textContent = 'Send me a sample';
  });

  const disconnectMonday = document.getElementById('disconnectMondayBtn');
  if (disconnectMonday) disconnectMonday.addEventListener('click', async () => {
    if (!confirm('Disconnect Monday? Ombeni deletes its stored access, and you can\'t send work to your boards until you connect again.')) return;
    await api('/me/monday', { method: 'DELETE' });
    state.workBoards = null;
    refreshSettings();
  });

  const disconnect = document.getElementById('disconnectGoogleBtn');
  if (disconnect) disconnect.addEventListener('click', async () => {
    if (!confirm('Disconnect Google? Ombeni stops reading your calendar and deletes its stored access.')) return;
    await api('/me/google', { method: 'DELETE' });
    state.calendarConnected = false;
    refreshSettings();
  });
}

async function refreshSettings() {
  refreshCoworkerSettings();
  const status = await loadStatus();
  const rows = [
    ['OpenAI', status.openai, 'Powers meeting analysis and Ask Ombeni.'],
    ['Monday.com', status.monday, status.monday ? 'Ready. Each person connects their own Monday account in Your co-worker above, and sends work to their own boards. Nothing is sent automatically.' : 'Not set up yet. An admin needs to add OMBENI_MONDAY_CLIENT_ID and OMBENI_MONDAY_CLIENT_SECRET on the server.'],
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

  const adminsSection = document.getElementById('adminsSection');
  if (state.isAdmin) {
    adminsSection.hidden = false;
    await refreshAdminsList();
  } else {
    adminsSection.hidden = true;
  }
}

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
  // Slack messages link to My Work (<app>/#work) or straight to one
  // assignment (<app>/#work/<id>).
  const workLink = window.location.hash.match(/^#work(?:\/([\w-]+))?$/);
  if (window.location.hash === '#settings') {
    // Back from Connect Monday.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    goToView('settings');
  } else if (workLink) {
    state.workFocusId = workLink[1] || null;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    goToView('work');
  } else {
    goToView('home'); // also loads My Work, for the badge
  }
  maybeRequestNotificationPermission();
  setInterval(meetingNotificationTick, 60000);
});
