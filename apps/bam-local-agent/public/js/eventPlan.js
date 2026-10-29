// Event plan card shared by the marketing planner (ask.js) and the admin sandbox (app.js):
// title + 5 W's + How Much, Next Steps and Store Action Items, with Copy, Print and Download (and Copy Slack blocks in the admin).
window.BAMEventPlan = (() => {
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
    for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(kid));   // skips `list.length && …` zeros too
    return el;
  }

  // [Confirm with Store] / [TBD Partner] are highlighted so nobody prints the plan with them still in it.
  const PH = /(\[(?:Confirm with Store|TBD Partner)\])/;
  const rich = (text) => String(text ?? '').split(PH).map((part, i) => (i % 2 ? h('mark', { class: 'ph', text: part }) : part));
  const list = (items, tag = 'ul') => (items.length ? h(tag, { class: 'ep-list' }, items.map((i) => h('li', {}, rich(i)))) : null);
  const dl = (rows) => h('dl', { class: 'ep-dl' }, rows.filter(([, v]) => v).map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', {}, typeof v === 'string' ? rich(v) : v))));
  const sec = (title, wide, ...kids) =>
    h('section', { class: `ep-sec${wide ? ' ep-sec--wide' : ''}` }, h('h3', { class: 'ep-sec__title', text: title }), ...kids);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event-plan';

  function body(res) {
    const p = res.plan, s = res.store;
    return h('div', { class: 'ep' },
      h('header', { class: 'ep-hero' },
        h('p', { class: 'ep-kicker', text: `Event plan · ${s.name} · ${s.city}, ${s.state}${res.playbook ? ` · Playbook ${res.playbook.label}` : ''}` }),
        h('h2', { class: 'ep-title', text: p.title }),
        p.summary && h('p', { class: 'ep-summary' }, rich(p.summary))),
      h('div', { class: 'ep-grid' },
        sec('What', true, h('p', {}, rich(p.what.concept)), list(p.what.activities),
          (p.what.bam_provides.length || p.what.partner_provides.length) && h('div', { class: 'ep-split' },
            h('div', {}, h('div', { class: 'ep-label', text: 'BAM provides' }), list(p.what.bam_provides) || h('p', { class: 'muted', text: '—' })),
            h('div', {}, h('div', { class: 'ep-label', text: 'Partner provides' }), list(p.what.partner_provides) || h('p', { class: 'muted', text: '—' })))),
        sec('When', false, dl([['Dates', p.when.dates], ['Time', p.when.time], ['Time slots', list(p.when.time_slots)], ['Why these dates', p.when.rationale]])),
        sec('Where', false, dl([['Location', p.where.location], ['Address', p.where.address], ['Space & layout', p.where.space], ['Tables & chairs', p.where.tables_chairs]])),
        sec('Who', false, list(p.who.audience), dl([['Store contact', p.who.store_contact], ['Partner contact', p.who.partner_contact]])),
        sec('Why', false, list(p.why.goals), p.why.playbook_tie_in && h('p', { class: 'ep-note' }, h('strong', {}, 'Playbook: '), rich(p.why.playbook_tie_in))),
        sec('How much', true,
          dl([['Ticket price', p.how_much.ticket_price], ['Estimated total', p.how_much.estimated_total], ['Partner fees', p.how_much.partner_fees]]),
          p.how_much.budget.length && h('table', { class: 'ep-budget' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Budget item' }), h('th', { scope: 'col', text: 'Cost' }))),
            h('tbody', {}, p.how_much.budget.map((b) => h('tr', {}, h('td', {}, rich(b.item)), h('td', {}, rich(b.cost)))))),
          p.how_much.supplies.length && h('div', {}, h('div', { class: 'ep-label', text: 'Store supplies' }), list(p.how_much.supplies)))),
      p.next_steps.length && sec('Next steps for coordination', true,
        h('ol', { class: 'ep-steps' }, p.next_steps.map((n) => h('li', {}, h('span', { class: 'ep-when', text: n.timing }), h('span', {}, rich(n.task)), h('span', { class: 'ep-owner' }, rich(n.owner)))))),
      p.store_action_items.length && sec('Action items needed from store', true,
        h('ul', { class: 'ep-checks' }, p.store_action_items.map((a) => h('li', {}, h('span', { class: 'ep-box', 'aria-hidden': 'true' }), h('span', {}, rich(a.task)),
          h('span', { class: 'ep-owner' }, rich(a.owner), ' · due ', rich(a.due)))))),
      p.open_items.length && h('div', { class: 'callout ep-open' }, h('strong', {}, 'To confirm before publishing'), list(p.open_items)));
  }

  /** Prints only the plan: a copy goes into #printRoot and the print stylesheet hides everything else. */
  function print(card) {
    document.getElementById('printRoot')?.remove();
    const root = h('div', { id: 'printRoot' }, card.cloneNode(true));
    document.body.append(root); document.body.classList.add('is-printing');
    const done = () => { document.body.classList.remove('is-printing'); root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Card for an event plan response ({ plan, text, store, playbook, slack? } from the API).
   * opts: { meta: header text, toast(msg, type, ms), regenerate(), extra: element appended under the plan (admin context) }.
   */
  function render(res, { meta, toast, regenerate, extra } = {}) {
    if (!res.plan) {
      return h('article', { class: 'result' }, h('div', { class: 'result__head' }, h('span', { class: 'muted', text: meta || '' })),
        h('div', { class: 'result__body' }, h('p', { text: res.raw || 'The plan could not be generated. Please try again.' })), extra);
    }
    const copyText = async (text, ok) => {
      try { await navigator.clipboard.writeText(text); toast?.(ok, 'ok', 2500); }
      catch { toast?.('Your browser blocked copying. Select the text and copy it manually.', 'error'); }
    };
    const planEl = body(res);
    const btn = (label, onclick, title) => h('button', { type: 'button', class: 'btn btn--sm', onclick, title }, label);
    return h('article', { class: 'result event-plan', 'aria-label': 'Event plan' },
      h('div', { class: 'result__head' },
        h('span', { class: 'muted', text: meta || '' }),
        h('div', { class: 'result__actions' },
          regenerate && btn('Regenerate', regenerate),
          btn('Copy plan', () => copyText(res.text, 'Event plan copied to clipboard')),
          btn('Print', () => print(planEl), 'Print or save as PDF'),
          btn('Download', () => download(`${slug(res.plan.title)}-${res.store.location_id}.txt`, res.text), 'Download as a text file'),
          res.slack && btn('Copy Slack blocks', () => copyText(JSON.stringify({ blocks: res.slack.blocks }, null, 2), 'Slack Block Kit JSON copied (paste into Block Kit Builder)')))),
      planEl, extra);
  }

  return { render };
})();
