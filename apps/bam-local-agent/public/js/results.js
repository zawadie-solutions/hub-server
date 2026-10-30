// Cards for the non-plan results, shared by the marketing planner (ask.js), the admin sandbox (app.js) and the event plan
// card (eventPlan.js): written pieces (emails, social posts, flyers, texts...), direct answers, and follow-up suggestions.
window.BAMResults = (() => {
  'use strict';

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  // Any [Bracketed placeholder] is highlighted so nobody sends a draft with one still in it.
  const PH = /(\[[^\]\n]{1,60}\])/;
  const rich = (text) => String(text ?? '').split(PH).map((part, i) => (i % 2 ? h('mark', { class: 'ph', text: part }) : part));
  /** Paragraphs on blank lines, line breaks kept inside a paragraph (sign-offs, flyer lines). */
  const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => h('p', {}, p.split('\n').flatMap((line, i) => (i ? [h('br'), ...rich(line)] : rich(line)))));

  async function copyText(text, ok, toast) {
    try { await navigator.clipboard.writeText(text); toast?.(ok, 'ok', 2500); }
    catch { toast?.('Your browser blocked copying. Select the text and copy it manually.', 'error'); }
  }

  const KIND = {
    email: 'Email', social_post: 'Social post', sms: 'Text message', flyer: 'Flyer', newsletter: 'Newsletter',
    press_release: 'Press release', letter: 'Letter', script: 'Script', other: 'Draft'
  };
  const title = (p) => p.label || KIND[p.kind] || 'Draft';

  /** Plain text of one piece, the way it is pasted into an email client or social app (same as pieceText on the server). */
  function pieceText(p) {
    const head = [p.to && `To: ${p.to}`, p.subject && `Subject: ${p.subject}`, p.platform && `Platform: ${p.platform}`].filter(Boolean).join('\n');
    return [head, p.headline, p.body, (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
  }
  const piecesText = (pieces) => pieces.map((p) => `${title(p).toUpperCase()}\n\n${pieceText(p)}`).join('\n\n---\n\n');

  function piece(p, { toast } = {}) {
    // An email's subject goes in its own field, so its body is copied on its own; other pieces copy as posted (no "Platform:" line).
    const copyBody = p.kind === 'email' ? p.body : pieceText({ ...p, platform: '' });
    const fields = [['To', p.to], ['Subject', p.subject]].filter(([, v]) => v);
    return h('article', { class: `piece piece--${p.kind}` },
      h('header', { class: 'piece__head' },
        h('div', { class: 'piece__titles' },
          h('span', { class: 'piece__kind', text: p.platform ? `${KIND[p.kind] || 'Draft'} · ${p.platform}` : KIND[p.kind] || 'Draft' }),
          h('h3', { class: 'piece__title', text: title(p) })),
        h('div', { class: 'piece__actions' },
          p.subject && h('button', { type: 'button', class: 'btn btn--sm', onclick: () => copyText(p.subject, 'Subject line copied', toast) }, 'Copy subject'),
          h('button', { type: 'button', class: 'btn btn--sm', onclick: () => copyText(copyBody, p.kind === 'email' ? 'Email body copied' : 'Copied to clipboard', toast) }, p.kind === 'email' ? 'Copy body' : 'Copy'))),
      fields.length && h('dl', { class: 'piece__fields' }, fields.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', {}, rich(v))))),
      h('div', { class: 'piece__body' },
        p.headline && h('p', { class: 'piece__headline' }, rich(p.headline)),
        paragraphs(p.body),
        p.hashtags?.length && h('p', { class: 'piece__tags', text: p.hashtags.join(' ') })));
  }

  /** The written pieces plus what to check before sending. */
  function pieceList(pieces, notes, opts) {
    return h('div', { class: 'pieces' },
      pieces.map((p) => piece(p, opts)),
      notes?.length && h('div', { class: 'callout pieces__notes' }, h('strong', {}, 'Before you send'), h('ul', { class: 'ep-list' }, notes.map((n) => h('li', {}, rich(n))))));
  }

  /** "Keep going" suggestions; picking one asks it straight away, building on this result. */
  function followUps(list, onPick) {
    if (!list?.length || !onPick) return null;
    return h('nav', { class: 'follow', 'aria-label': 'Suggested next requests' },
      h('span', { class: 'follow__label', text: 'Keep going' }),
      h('div', { class: 'chips' }, list.map((t) => h('button', { type: 'button', class: 'chip chip--next', text: t, onclick: () => onPick(t) }))));
  }

  function head(meta, actions) {
    return h('div', { class: 'result__head' }, h('span', { class: 'muted', text: meta || '' }), h('div', { class: 'result__actions' }, actions));
  }
  const btn = (label, onclick, title) => h('button', { type: 'button', class: 'btn btn--sm', onclick, title }, label);

  /** Content result ({ content: { intro, pieces, notes, raw? } }): one card per email / post / flyer. */
  function content(res, { meta, toast, regenerate, extra, onFollowUp } = {}) {
    const c = res.content;
    const body = c.pieces.length
      ? h('div', { class: 'result__body' }, c.intro && h('p', { class: 'result__lead', text: c.intro }), pieceList(c.pieces, c.notes, { toast }))
      : h('div', { class: 'result__body' }, paragraphs(c.raw || 'Nothing was written. Please try again.'));
    return h('article', { class: 'result', 'aria-label': 'Your draft' },
      head(meta, [regenerate && btn('Regenerate', regenerate), c.pieces.length > 1 && btn('Copy all', () => copyText(piecesText(c.pieces), 'All drafts copied', toast))]),
      body, followUps(res.follow_ups, onFollowUp), extra);
  }

  /** Answer result ({ reply: { answer, points, caveat } }): the direct answer first, then the details that support it. */
  function answer(res, { meta, toast, regenerate, extra, onFollowUp } = {}) {
    const r = res.reply;
    return h('article', { class: 'result', 'aria-label': 'Answer' },
      head(meta, [regenerate && btn('Regenerate', regenerate), btn('Copy', () => copyText(res.text, 'Answer copied', toast))]),
      h('div', { class: 'result__body' },
        h('p', { class: 'answer__lead' }, rich(r.answer)),
        r.points.length && h('ul', { class: 'answer__points' }, r.points.map((p) => h('li', {}, p.label && h('strong', { text: `${p.label}: ` }), rich(p.text)))),
        r.caveat && h('div', { class: 'callout' }, h('strong', {}, 'To confirm: '), rich(r.caveat))),
      followUps(res.follow_ups, onFollowUp), extra);
  }

  return { content, answer, pieceList, piecesText, followUps };
})();
