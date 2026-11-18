const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
const { classifyMeeting, isCompanyEmail } = require('../services/meetingKind');
const { buildPrompt, normalizeStatements, resolveDue, slackMessage, mondayUpdateText, transcriptText, clock } = require('../services/statements');

test('a meeting with only zawadie.com attendees is a company meeting', () => {
  assert.deepEqual(classifyMeeting(['kit@zawadie.com', 'ASTRID@Zawadie.com']), { kind: 'company', externalDomains: [] });
});

test('any other domain makes it a client meeting and names the client', () => {
  assert.deepEqual(
    classifyMeeting(['kit@zawadie.com', 'wendy@kenect.com', 'jess@kenect.com', 'someone@gmail.com']),
    { kind: 'client', externalDomains: ['gmail.com', 'kenect.com'] }
  );
});

test('people on a personal email can be listed as company people', () => {
  const company = ['zawadie.com', 'partner@gmail.com'];
  assert.equal(isCompanyEmail('Partner@Gmail.com', company), true);
  assert.equal(isCompanyEmail('stranger@gmail.com', company), false);
  assert.deepEqual(classifyMeeting(['kit@zawadie.com', 'partner@gmail.com'], company), { kind: 'company', externalDomains: [] });
  assert.deepEqual(classifyMeeting(['partner@gmail.com', 'stranger@gmail.com'], company), { kind: 'client', externalDomains: ['gmail.com'] });
});

test('isCompanyEmail only accepts the company domain', () => {
  assert.equal(isCompanyEmail('a@zawadie.com'), true);
  assert.equal(isCompanyEmail('a@notzawadie.com'), false);
  assert.equal(isCompanyEmail('zawadie.com'), false);
});

test('transcript lines carry speaker and m:ss time', () => {
  assert.equal(clock(75.4), '1:15');
  assert.equal(clock(3725), '1:02:05');
  assert.equal(transcriptText([{ speaker: 'Kit', at: 61, text: 'Two pages max.' }]), '[1:01] Kit: Two pages max.');
});

test('the prompt lists the allowed people and the meeting weekday', () => {
  const prompt = buildPrompt(
    { title: 'Kenect sync', date: '2026-11-04', kind: 'client', externalDomains: ['kenect.com'], transcriptEntries: [{ speaker: 'Wendy', at: 5, text: 'Hi' }], analysis: null },
    [{ name: 'Kit Alimasi', email: 'kit@zawadie.com' }]
  );
  assert.match(prompt, /Kit Alimasi — kit@zawadie\.com/);
  assert.match(prompt, /Wednesday 2026-11-04/);
  assert.match(prompt, /client meeting \(outside attendees from kenect\.com\)/);
  assert.match(prompt, /promised to do or send FOR ZAWADIE/);
  const internal = buildPrompt({ title: 'Huddle', date: '2026-11-04', kind: 'company', externalDomains: [], transcriptEntries: [] }, []);
  assert.match(internal, /internal meeting: leave waiting_on_client empty/);
});

test('an assignee email that is not an allowed Zawadie person becomes unassigned', () => {
  const { assignments } = normalizeStatements({
    assignments: [
      { title: 'Draft proposal', assignee_email: 'KIT@zawadie.com', outcome: 'x' },
      { title: 'Invented email', assignee_email: 'kit.alimasi@zawadie.com' },
      { title: 'Client person', assignee_email: 'wendy@kenect.com' },
      { title: 'Team task', assignee_email: null, assignee_name: 'BAM team' }
    ]
  }, ['kit@zawadie.com']);
  assert.deepEqual(assignments.map(a => a.ownerEmail), ['kit@zawadie.com', null, null, null]);
  assert.equal(assignments[3].ownerName, 'BAM team');
});

test('bad or missing parts are cleaned, not trusted', () => {
  const { assignments, waitingOnClient } = normalizeStatements({
    assignments: [
      { title: '' },
      null,
      {
        title: 'Report',
        due: 'next Friday',
        must_haves: ['Two pages', { text: 'Per shipment pricing', quote: 'per shipment', speaker: 'Wendy', time: '3:10' }, { quote: 'no text' }],
        unclear: ['Insurance included?', 42]
      }
    ],
    waiting_on_client: [{ who: 'Wendy', what: 'Send the logo' }, { who: 'x' }]
  }, []);
  assert.equal(assignments.length, 1);
  const s = assignments[0].statement;
  assert.equal(s.due, null);
  assert.deepEqual(s.mustHaves.map(p => p.text), ['Two pages', 'Per shipment pricing']);
  assert.deepEqual(s.unclear, ['Insurance included?']);
  assert.deepEqual(s.avoid, []);
  assert.equal(waitingOnClient.length, 1);
});

test('only quotes really in the transcript are kept, spliced ones too', () => {
  const meeting = {
    kind: 'client',
    date: '2026-11-04',
    transcriptEntries: [
      { speaker: 'Wendy', at: 10, text: 'Keep it to two pages, please.' },
      { speaker: 'Wendy', at: 30, text: 'And price it per shipment.' }
    ]
  };
  const { assignments, waitingOnClient } = normalizeStatements({
    assignments: [{
      title: 'Proposal',
      must_haves: [
        { text: 'Two pages', quote: 'keep it to two pages' },
        { text: 'Both', quote: 'Keep it to two pages... price it per shipment' },
        { text: 'Reworded', quote: 'make it two pages long' },
        { text: 'Spliced with a made-up part', quote: 'two pages... and in blue' }
      ]
    }],
    waiting_on_client: [{ who: 'Wendy', what: 'Logo', quote: 'we will send the logo' }]
  }, [], meeting);
  assert.deepEqual(assignments[0].statement.mustHaves.map(p => p.quote),
    ['keep it to two pages', 'Keep it to two pages... price it per shipment', '', '']);
  assert.equal(waitingOnClient[0].quote, '');
});

test('a company meeting has nothing waiting on a client', () => {
  const { waitingOnClient } = normalizeStatements({ waiting_on_client: [{ who: 'Command 7', what: 'x' }] }, [], { kind: 'company' });
  assert.deepEqual(waitingOnClient, []);
});

test('plain spoken deadlines become dates, counted from the meeting day', () => {
  // 2026-11-04 is a Wednesday.
  assert.equal(resolveDue('by tomorrow', '2026-11-04'), '2026-11-05');
  assert.equal(resolveDue('today', '2026-11-04'), '2026-11-04');
  assert.equal(resolveDue('by Friday', '2026-11-04'), '2026-11-06');
  assert.equal(resolveDue('on Monday', '2026-11-04'), '2026-11-09');
  assert.equal(resolveDue('by Wednesday', '2026-11-04'), '2026-11-11', 'same weekday means next week');
  assert.equal(resolveDue('end of the week', '2026-11-04'), '2026-11-06');
  assert.equal(resolveDue('end of the month', '2026-11-04'), '2026-11-30');
  assert.equal(resolveDue('next week', '2026-11-04'), null);
  assert.equal(resolveDue('Tuesday next week', '2026-11-04'), null);
  assert.equal(resolveDue('soon', '2026-11-04'), null);
  const { assignments } = normalizeStatements({ assignments: [{ title: 'x', due: null, due_said: 'tomorrow' }] }, [], { date: '2026-11-04' });
  assert.equal(assignments[0].statement.due, '2026-11-05');
});

test('a valid due date is kept', () => {
  const { assignments } = normalizeStatements({ assignments: [{ title: 'x', due: '2026-11-20' }] }, []);
  assert.equal(assignments[0].statement.due, '2026-11-20');
});

const sample = {
  id: 'abc-123',
  title: 'Review <proposal> & pricing',
  meetingTitle: 'Kenect sync',
  meetingDate: '2026-11-04',
  assignedBy: 'Wendy',
  statement: {
    outcome: 'It covers all 3 <routes> with clear pricing & gets approved by David.',
    mustHaves: [{ text: 'Covers 3 routes', quote: 'those three <routes>', speaker: 'Wendy', time: '3:10' }],
    avoid: [{ text: 'No warehousing', quote: '', speaker: '', time: '' }],
    due: '2026-11-18',
    dueSaid: 'by Wednesday',
    deliverTo: 'David',
    unclear: ['Is insurance included?']
  }
};

test('the Slack message is short: the task, what success looks like in quotes, when and to whom', () => {
  const { text, blocks } = slackMessage(sample, 'https://ai.zawadie.com/ombeni-ai/#work/abc-123');
  assert.match(text, /Review <proposal>/); // plain fallback text isn't mrkdwn
  assert.equal(blocks[0].text.text, 'Review <proposal> & pricing', 'the task is the header');
  const sections = blocks.filter(b => b.type === 'section').map(b => b.text.text);
  assert.equal(sections[0], '*What does success look like?*\n>_"It covers all 3 &lt;routes&gt; with clear pricing &amp; gets approved by David."_');
  assert.equal(sections[1], '*Due:* Wednesday, November 18    *Deliver to:* David');
  assert.equal(sections.length, 2, 'no long lists in the message');
  const all = JSON.stringify(blocks);
  assert.doesNotMatch(all, /Must have|those three|Is insurance included/, 'the details stay in Ombeni');
  assert.match(all, /In Ombeni: 1 must-have · 1 thing to avoid · 1 question to ask before you start, with the exact words from the meeting\./);
  const button = blocks.find(b => b.type === 'actions').elements[0];
  assert.equal(button.url, 'https://ai.zawadie.com/ombeni-ai/#work/abc-123');
});

test('Ombeni is asked for success in one short sentence about the finished work, and quotes are tidied', () => {
  const prompt = buildPrompt({ title: 'AI huddle', date: '2026-11-16', externalDomains: [], participants: [], transcriptEntries: [] }, []);
  assert.match(prompt, /answer to "What does success look like\?": ONE short sentence \(at most 25 words\)/);
  assert.match(prompt, /"It completes real tasks end-to-end with accurate tool calls, grounded\s+answers, and minimal repeat contacts\."/);
  assert.match(prompt, /Never "You've succeeded when\.\.\."/);
  const { assignments } = normalizeStatements({ assignments: [{ title: 'Voice agent', assignee_email: 'kit@zawadie.com', outcome: '"It answers callers accurately."' }] }, ['kit@zawadie.com']);
  assert.equal(assignments[0].statement.outcome, 'It answers callers accurately.');
});

test('the Monday update holds the whole statement', () => {
  const text = mondayUpdateText(sample);
  assert.match(text, /^Success statement from Kenect sync \(2026-11-04\)\n\nWhat does success look like\?\n"It covers all 3 <routes> with clear pricing & gets approved by David\."/);
  assert.match(text, /Must have:\n- Covers 3 routes \("those three <routes>" \(Wendy, 3:10\)\)/);
  assert.match(text, /Avoid:\n- No warehousing/);
  assert.match(text, /Deliver to: David/);
  assert.match(text, /Still unclear:\n- Is insurance included\?/);
});
