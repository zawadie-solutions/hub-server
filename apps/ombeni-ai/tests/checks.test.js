const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementsFor, explainPrompt, normalizeExplain, workPrompt, normalizeWork } = require('../services/checks');

const assignment = {
  meetingTitle: 'Department Huddle',
  statement: {
    outcome: "You've succeeded when every new client gets one checklist.",
    mustHaves: [
      { text: 'One page, in a Google Doc', quote: 'keep it to one page' },
      { text: 'Workspace access within 2 days', quote: '' }
    ],
    avoid: [{ text: 'No pricing', quote: 'leave pricing out' }],
    due: '2026-11-20',
    dueSaid: 'by Friday',
    deliverTo: 'Tyler Clark',
    unclear: []
  }
};

test('requirements are numbered; deadline and recipient only for explaining back', () => {
  assert.deepEqual(requirementsFor(assignment).map(r => `${r.id}:${r.kind}`),
    ['R1:outcome', 'R2:must', 'R3:must', 'R4:avoid', 'R5:due', 'R6:deliver']);
  assert.match(requirementsFor(assignment)[4].text, /Friday, November 20/);
  assert.deepEqual(requirementsFor(assignment, { forWork: true }).map(r => r.kind), ['outcome', 'must', 'must', 'avoid']);
});

test('the prompts carry every requirement and the person\'s words', () => {
  const p = explainPrompt(assignment, 'I will write a two-page doc for Tyler.');
  assert.match(p, /R4 \[Must NOT do\] No pricing {2}\(said in the meeting: "leave pricing out"\)/);
  assert.match(p, /R5 \[Deadline\] Due Friday, November 20 \(said as "by Friday"\)/);
  assert.match(p, /R6 \[Deliver to\] Goes to Tyler Clark/);
  assert.match(p, /I will write a two-page doc for Tyler\./);
  const w = workPrompt(assignment, 'DRAFT TEXT');
  assert.doesNotMatch(w, /Deliver to\]/);
  assert.match(w, /THE WORK:\nDRAFT TEXT/);
});

test('explaining back: every requirement gets a verdict, and skipped ones count as missed', () => {
  const r = normalizeExplain({
    items: [
      { id: 'R1', status: 'covered' },
      { id: 'R2', status: 'different', note: 'You said two pages; one page was asked.' },
      { id: 'R4', status: 'nonsense' },
      { id: 'R6', status: 'covered', note: 'should be dropped' }
    ],
    extra: ['Adding a pricing table', '', 7]
  }, assignment);
  assert.deepEqual(r.items.map(i => i.status), ['covered', 'different', 'missed', 'ok', 'missed', 'covered']);
  assert.equal(r.items[1].note, 'You said two pages; one page was asked.');
  assert.equal(r.items[2].note, "You didn't mention this.");
  assert.equal(r.items[5].note, '');
  assert.deepEqual(r.extra, ['Adding a pricing table']);
  assert.equal(r.ready, false);
});

test('explaining back is ready only when nothing is missed, different or in conflict', () => {
  const all = (status, avoid) => ({ items: requirementsFor(assignment).map(r => ({ id: r.id, status: r.kind === 'avoid' ? avoid : status })) });
  assert.equal(normalizeExplain(all('covered', 'ok'), assignment).ready, true);
  assert.equal(normalizeExplain(all('covered', 'conflict'), assignment).ready, false);
});

test('checking work: skipped requirements are unclear, and evidence must really be in the work', () => {
  const work = 'Client checklist. Workspace access is set up within two days of signing.';
  const r = normalizeWork({
    items: [
      { id: 'R1', status: 'met', evidence: 'Client checklist', fix: 'ignored' },
      { id: 'R2', status: 'not_met', evidence: 'one page only', fix: 'Cut it to one page.' },
      { id: 'R3', status: 'met', evidence: 'Workspace access is set up within two days' }
    ]
  }, assignment, work);
  assert.deepEqual(r.items.map(i => i.status), ['met', 'not_met', 'met', 'unclear']);
  assert.equal(r.items[0].evidence, 'Client checklist');
  assert.equal(r.items[0].fix, '');
  assert.equal(r.items[1].evidence, '', 'made-up evidence is dropped');
  assert.equal(r.items[1].fix, 'Cut it to one page.');
  assert.match(r.items[3].fix, /couldn't confirm/);
  assert.equal(r.ready, false);
  assert.equal(r.truncated, false);
});
