// Runs on the profile page when the reviewer uses the side panel (injected on demand, never on every page).
// It does three things: list the page's photos, let the reviewer click the profile photo, and draw a small
// badge on each gallery photo. It stores nothing and sends nothing anywhere: the side panel does the talking.
(() => {
  if (window.__faceMatchContent) return; // injected twice: keep the first one
  window.__faceMatchContent = true;

  const srcOf = (img) => img.currentSrc || img.src || '';
  let host = null;
  let shadow = null;
  let badges = [];
  let layoutTimer = null;
  let pick = null;

  // One shadow-DOM host holds everything we draw, so the page's own styles can't touch it and ours can't leak.
  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-facematch-extension', '');
    host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      .badge { position:absolute; font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif; padding:4px 8px;
        border-radius:999px; color:#fff; box-shadow:0 1px 4px rgba(0,0,0,.45); white-space:nowrap; max-width:240px;
        overflow:hidden; text-overflow:ellipsis; border:1px solid rgba(255,255,255,.7); }
      .match { background:#047857 } .possible { background:#b45309 } .no_match { background:#b91c1c }
      .no_face, .unreadable { background:#475569 }
      .flash { outline:3px solid #f0538b; outline-offset:2px; }
      .frame { position:absolute; border:3px solid #f0538b; border-radius:6px; background:rgba(240,83,139,.12); }
    </style>`;
    document.documentElement.appendChild(host);
  }

  function listImages() {
    const out = [];
    for (const img of document.images) {
      if (!img.complete || !img.naturalWidth) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue; // not displayed, or a tiny icon
      out.push({ url: srcOf(img), width: img.naturalWidth, height: img.naturalHeight });
    }
    return out;
  }

  // The image under the pointer, even when a transparent overlay (common in galleries) covers it.
  function imageAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLImageElement && el.naturalWidth) return el;
    }
    return null;
  }

  function stopPick() {
    if (!pick) return;
    document.removeEventListener('mousemove', pick.move, true);
    document.removeEventListener('click', pick.click, true);
    document.removeEventListener('keydown', pick.key, true);
    document.documentElement.style.cursor = pick.cursor;
    pick.frame.remove();
    pick = null;
  }

  function startPick() {
    stopPick();
    ensureHost();
    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.style.display = 'none';
    shadow.appendChild(frame);
    const cursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
    const move = (e) => {
      const img = imageAt(e.clientX, e.clientY);
      if (!img) { frame.style.display = 'none'; return; }
      const r = img.getBoundingClientRect();
      Object.assign(frame.style, { display: '', left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const click = (e) => {
      const img = imageAt(e.clientX, e.clientY);
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // the photo's own click (open a lightbox, follow a link) must not fire
      stopPick();
      chrome.runtime.sendMessage({ type: 'picked', url: srcOf(img), width: img.naturalWidth, height: img.naturalHeight });
    };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      stopPick();
      chrome.runtime.sendMessage({ type: 'pick-cancelled' });
    };
    pick = { move, click, key, frame, cursor };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  }

  function layout() {
    for (const { img, el } of badges) {
      const r = img.getBoundingClientRect();
      el.style.display = r.width > 0 && r.height > 0 ? '' : 'none';
      el.style.left = `${r.left + scrollX + 6}px`;
      el.style.top = `${r.top + scrollY + 6}px`;
    }
  }

  function clearBadges() {
    clearInterval(layoutTimer);
    layoutTimer = null;
    for (const { el } of badges) el.remove();
    badges = [];
  }

  function showBadges(items) {
    clearBadges();
    ensureHost();
    const byUrl = new Map(items.map((i) => [i.url, i]));
    for (const img of document.images) {
      const item = byUrl.get(srcOf(img));
      if (!item) continue;
      const el = document.createElement('div');
      el.className = `badge ${item.kind}`;
      el.textContent = item.text;
      el.title = item.title || '';
      shadow.appendChild(el);
      badges.push({ img, el });
    }
    layout();
    layoutTimer = setInterval(layout, 400); // photos move when the page lays out or lazy-loads
    return badges.length;
  }

  function scrollToImage(url) {
    const img = [...document.images].find((i) => srcOf(i) === url);
    if (!img) return false;
    img.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const entry = badges.find((b) => b.img === img);
    if (entry) {
      entry.el.classList.add('flash');
      setTimeout(() => entry.el.classList.remove('flash'), 1800);
    }
    return true;
  }

  // blob: URLs only work inside the page that made them, so the page has to read those itself.
  async function readBlobUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'ping': sendResponse({ ok: true }); break;
      case 'list-images': sendResponse({ images: listImages() }); break;
      case 'pick-start': startPick(); sendResponse({ ok: true }); break;
      case 'pick-cancel': stopPick(); sendResponse({ ok: true }); break;
      case 'badges': sendResponse({ shown: showBadges(msg.items) }); break;
      case 'clear-badges': clearBadges(); sendResponse({ ok: true }); break;
      case 'scroll-to': sendResponse({ found: scrollToImage(msg.url) }); break;
      case 'read-blob':
        readBlobUrl(msg.url).then(sendResponse, (err) => sendResponse({ error: String(err) }));
        return true; // answer asynchronously
      default: return false;
    }
    return false;
  });
})();
