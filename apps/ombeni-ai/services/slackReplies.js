// What Ombeni says back in an assignment's Slack thread. Pure text building,
// so it can be tested directly.
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } });

const EXPLAIN_MARK = { covered: ':white_check_mark:', ok: ':white_check_mark:', missed: ':warning:', different: ':x:', conflict: ':x:' };
const WORK_MARK = { met: ':white_check_mark:', not_met: ':x:', unclear: ':warning:' };

const line = (mark, item, extra) => `${mark}  ${item.kind === 'avoid' ? '*Don\'t:* ' : ''}${esc(item.text)}${extra ? `\n        _${esc(extra)}_` : ''}`;

function explainReply(result, { confirmedNow = false } = {}) {
  if (result.ready) {
    return {
      text: 'You\'ve got it.',
      blocks: [section(`:white_check_mark: *You've got it.* Everything that was asked is in your explanation.${confirmedNow ? ' I\'ve marked this as *Got it*.' : ''}\nWhen your draft is ready, attach it here and I'll check it before you deliver.`)]
    };
  }
  const gaps = result.items.filter(i => !['covered', 'ok'].includes(i.status));
  const blocks = [
    section(`*${gaps.length} thing(s) to look at before you start:*\n${gaps.map(i => line(EXPLAIN_MARK[i.status] || ':warning:', i, i.note)).join('\n')}`)
  ];
  if (result.extra && result.extra.length) blocks.push(section(`*Not asked for:*\n${result.extra.map(e => `•  ${esc(e)}`).join('\n')}`));
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Reply again with your corrected version and I\'ll check it again.' }] });
  return { text: `${gaps.length} thing(s) to look at before you start.`, blocks };
}

function workReply(check) {
  const r = check.result;
  if (r.ready) {
    return { text: 'Ready to deliver.', blocks: [section(`:white_check_mark: *Ready to deliver.* Every requirement is met in _${esc(check.source)}_.`)] };
  }
  const open = r.items.filter(i => i.status !== 'met');
  const blocks = [
    section(`*${open.length} requirement(s) to fix or confirm in _${esc(check.source)}_:*\n${open.map(i => line(WORK_MARK[i.status], i, [i.evidence ? `"${i.evidence}"` : '', i.fix].filter(Boolean).join(' · '))).join('\n')}`)
  ];
  const met = r.items.filter(i => i.status === 'met');
  if (met.length) blocks.push(section(`*Already met:* ${met.length}`));
  if (r.truncated) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Your draft is very long, so only its first part was checked.' }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Fix these and attach the new version here to check again.' }] });
  return { text: `${open.length} requirement(s) to fix before you deliver.`, blocks };
}

const plain = (text) => ({ text, blocks: [section(esc(text))] });

const HELP = (link) => ({
  text: 'Reply under an assignment',
  blocks: [section(`I answer in the thread under each assignment I send you: explain what you'll deliver, ask a question (end with *?*), or attach your draft to check it.\nAll your work is in <${link}|My Work>.`)]
});

/** Slack's message text, back to what the person typed. */
function cleanSlackText(text) {
  return String(text || '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

/** A reply that says which assignment it's about (for messages outside an assignment's thread). */
function about(title, message) {
  const note = { type: 'context', elements: [{ type: 'mrkdwn', text: `About *${esc(title)}*, your latest assignment. For a different one, reply in its own thread.` }] };
  return { text: message.text, blocks: [note, ...(message.blocks || [])] };
}

module.exports = { explainReply, workReply, plain, HELP, cleanSlackText, about };
