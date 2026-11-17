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

test('checking a picture: the AI writes down what it can read, and evidence must be in that', () => {
  const prompt = workPrompt(assignment, 'Here is my mock-up', { hasImage: true });
  assert.match(prompt, /IMAGE of the work/);
  assert.match(prompt, /"seen_text"/);
  assert.match(prompt, /THEIR NOTES \(the work itself is the attached image\):\nHere is my mock-up/);

  const r = normalizeWork({
    seen_text: 'New client checklist. Workspace access within two days.',
    items: [
      { id: 'R1', status: 'met', evidence: 'New client checklist' },
      { id: 'R3', status: 'met', evidence: 'access within two days' },
      { id: 'R2', status: 'not_met', evidence: 'one page only', fix: 'Fit it on one page.' }
    ]
  }, assignment, 'Here is my mock-up', { hasImage: true });
  assert.equal(r.items[0].evidence, 'New client checklist');
  assert.equal(r.items[2].evidence, 'access within two days');
  assert.equal(r.items[1].evidence, '', 'not in the picture: dropped');
});

test('images are recognised by what they are, not their name', () => {
  const { imageOf, sniffImage } = require('../services/fileParser');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  assert.equal(sniffImage(png), 'image/png');
  assert.equal(imageOf({ originalname: 'Shot.PNG', buffer: png }).mimetype, 'image/png');
  assert.equal(imageOf({ originalname: 'photo.jpeg', buffer: jpg }).mimetype, 'image/jpeg');
  assert.equal(imageOf({ originalname: 'draft.docx', buffer: png }), null, 'not named as an image: treated as a document');
  assert.throws(() => imageOf({ originalname: 'fake.png', buffer: Buffer.from('<html>not an image</html>') }), /isn't a readable/);
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
