// Links in Ombeni's chat replies: clickable, labelled, and never a way to
// put HTML or script into the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { replyHtml, DRAFT_LINK_TEXT } = require('../public/replyLinks');

const DRAFT = 'https://mail.google.com/mail/#drafts?compose=1a1ee0fcf182b3f5';
const anchor = (url, label) => `<a class="reply-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

test('the Gmail draft link reads "Click here to see the draft" and opens in a new tab', () => {
  assert.equal(DRAFT_LINK_TEXT, 'Click here to see the draft');
  assert.equal(replyHtml(`Saved.\n[Click here to see the draft](${DRAFT})`), `Saved.\n${anchor(DRAFT, 'Click here to see the draft')}`);
});

test('the reply from the screenshot, "[link](url)", becomes a real link with a proper label', () => {
  const html = replyHtml(`You can review and send it by following this [link](${DRAFT}). Please make sure to review it before sending.`);
  assert.equal(html, `You can review and send it by following this ${anchor(DRAFT, 'Click here to see the draft')}. Please make sure to review it before sending.`);
});

test('a bare draft URL is labelled too; trailing punctuation stays outside the link', () => {
  assert.equal(replyHtml(`It's here: ${DRAFT}.`), `It&#39;s here: ${anchor(DRAFT, 'Click here to see the draft')}.`);
  assert.equal(replyHtml(`Link: (${DRAFT})`), `Link: (${anchor(DRAFT, 'Click here to see the draft')})`);
});

test('other links keep their own text; a real label on the draft link is kept', () => {
  assert.equal(replyHtml('See [the board](https://zawadie.monday.com/boards/1)'), `See ${anchor('https://zawadie.monday.com/boards/1', 'the board')}`);
  assert.equal(replyHtml('Docs: https://example.com/a?b=1&c=2'), `Docs: ${anchor('https://example.com/a?b=1&amp;c=2', 'https://example.com/a?b=1&amp;c=2')}`);
  assert.equal(replyHtml(`[Open your Jeremy draft](${DRAFT})`), anchor(DRAFT, 'Open your Jeremy draft'));
});

test('nothing in a reply can add HTML or script', () => {
  assert.equal(replyHtml('<img src=x onerror=alert(1)> & "quotes"'), '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
  assert.equal(replyHtml('[click](javascript:alert(1))'), '[click](javascript:alert(1))', 'only http(s) links');
  assert.equal(replyHtml('[<b>x</b>](https://example.com/"onmouseover="alert(1))'),
    `${anchor('https://example.com/&quot;onmouseover=&quot;alert(1', '&lt;b&gt;x&lt;/b&gt;')})`);
  assert.equal(replyHtml(null), '');
});
