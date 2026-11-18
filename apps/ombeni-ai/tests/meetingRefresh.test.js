// Refreshing recordings from Monday: when one Monday account doesn't answer
// (e.g. a timeout), the recordings already loaded are kept, so meetings,
// clients and prep notes don't vanish until the next refresh.
const test = require('node:test');
const assert = require('node:assert/strict');

const notetakerService = require('../services/notetakerService');
const store = require('../data/store');

let next = null; // what Monday answers on the next refresh
notetakerService.isConfigured = () => true;
notetakerService.listMeetingsReport = async () => next;

const m = (id, date) => ({ id, title: id, date, participants: ['kit@zawadie.com', 'anna@tideyocean.org'] });
const ids = () => store.getMeetings().map(x => x.id);

test('a full refresh replaces the list', async () => {
  next = { meetings: [m('tidey-1', '2026-11-03'), m('ted-1', '2026-11-02')], failedAccounts: 0 };
  await store.refreshMeetings();
  assert.deepEqual(ids(), ['tidey-1', 'ted-1']);
});

test('a Monday account timing out keeps the recordings already loaded', async () => {
  next = { meetings: [m('new-1', '2026-11-18')], failedAccounts: 1 };
  await store.refreshMeetings();
  assert.deepEqual(ids(), ['new-1', 'tidey-1', 'ted-1'], 'nothing dropped; newest first');

  next = { meetings: [], failedAccounts: 2 };
  await store.refreshMeetings();
  assert.deepEqual(ids(), ['new-1', 'tidey-1', 'ted-1'], 'every account down: the list stays as it was');
});

test('once every account answers again, the list is exactly what Monday has', async () => {
  next = { meetings: [m('new-1', '2026-11-18'), m('ted-1', '2026-11-02')], failedAccounts: 0 };
  await store.refreshMeetings();
  assert.deepEqual(ids(), ['new-1', 'ted-1']);
});
