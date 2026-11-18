// Ombeni's replies as safe HTML with working links. Everything is escaped
// first; only http(s) links, written as Markdown ([text](url)) or bare, become
// <a> tags, so nothing in a reply can run code or point at javascript:.
// A Gmail draft link always reads "Click here to see the draft" unless Ombeni
// gave it a real label. Loaded by index.html before app.js; exported for tests.
(function (root) {
  const DRAFT_LINK_TEXT = 'Click here to see the draft';
  const GENERIC_LABEL = /^(?:link|here|click here|this link|the link|draft|the draft|draft link|open draft|open the draft)$/i;
  // A Markdown link, or a bare URL (without trailing punctuation that ends the sentence).
  const LINK_RE = /\[([^\]\n]+)\]\s*\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])/g;

  const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const isGmailDraft = (url) => /^https:\/\/mail\.google\.com\/mail\/[^\s]*#drafts/.test(url);

  function replyHtml(text) {
    const src = String(text ?? '');
    const out = [];
    let last = 0;
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(src))) {
      out.push(escapeHtml(src.slice(last, m.index)));
      const url = m[2] || m[3];
      let label = (m[1] || '').trim() || url;
      if (isGmailDraft(url) && (label === url || GENERIC_LABEL.test(label))) label = DRAFT_LINK_TEXT;
      out.push(`<a class="reply-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
      last = LINK_RE.lastIndex;
    }
    out.push(escapeHtml(src.slice(last)));
    return out.join('');
  }

  root.replyHtml = replyHtml;
  if (typeof module !== 'undefined' && module.exports) module.exports = { replyHtml, DRAFT_LINK_TEXT };
})(typeof window !== 'undefined' ? window : globalThis);
